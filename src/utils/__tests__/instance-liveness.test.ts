import { describe, expect, it, vi } from "vitest";
import {
  UNCONFIRMED_END_STATE,
  classifyEndedInstances,
  classifyInstance,
  describeProcessed,
  isInstanceGoneError,
} from "../instance-liveness.js";

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } });

const transportError = () => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });

/** Minimal stand-in for the subset of the Camunda client the utility touches. */
function mockClient(opts: {
  runtime?: Record<string, "ok" | Error>;
  history?: Record<string, { state: string; endTime?: string | null } | Error>;
  historyPostFails?: boolean;
} = {}) {
  const get = vi.fn(async (url: string) => {
    const runtime = url.match(/^\/process-instance\/(.+)$/);
    if (runtime) {
      const row = opts.runtime?.[runtime[1]];
      if (row instanceof Error) throw row;
      if (row === "ok") return { data: { id: runtime[1] } };
      throw httpError(404);
    }
    const historic = url.match(/^\/history\/process-instance\/(.+)$/);
    if (historic) {
      const row = opts.history?.[historic[1]];
      if (row instanceof Error) throw row;
      if (!row) throw httpError(404);
      return { data: { id: historic[1], state: row.state, endTime: row.endTime ?? null } };
    }
    throw new Error(`Unexpected GET ${url}`);
  });

  const post = vi.fn(async (url: string, body: unknown) => {
    if (url !== "/history/process-instance") throw new Error(`Unexpected POST ${url}`);
    if (opts.historyPostFails) throw httpError(500);
    const ids = (body as { processInstanceIds: string[] }).processInstanceIds;
    const rows = ids
      .map((id) => {
        const row = opts.history?.[id];
        if (!row || row instanceof Error) return null;
        return { id, state: row.state, endTime: row.endTime ?? null };
      })
      .filter(Boolean);
    return { data: rows };
  });

  return { client: { get, post }, get, post };
}

describe("isInstanceGoneError", () => {
  it("recognises a 404 as the instance being gone", () => {
    expect(isInstanceGoneError(httpError(404))).toBe(true);
  });

  it.each([
    ["a 500", httpError(500)],
    ["a 409", httpError(409)],
    ["a transport failure with no response", transportError()],
    ["a plain error", new Error("boom")],
    ["undefined", undefined],
    ["null", null],
  ])("does not treat %s as gone", (_label, error) => {
    expect(isInstanceGoneError(error)).toBe(false);
  });
});

describe("classifyEndedInstances", () => {
  it("makes no request when there is nothing to classify", async () => {
    const mock = mockClient();
    const verdicts = await classifyEndedInstances(mock.client, []);
    expect(verdicts.size).toBe(0);
    expect(mock.post).not.toHaveBeenCalled();
  });

  it.each(["COMPLETED", "EXTERNALLY_TERMINATED", "INTERNALLY_TERMINATED"])(
    "treats %s as processed and carries the end state through",
    async (state) => {
      const mock = mockClient({ history: { p1: { state, endTime: "2026-02-01T09:00:00Z" } } });
      const verdicts = await classifyEndedInstances(mock.client, ["p1"]);
      expect(verdicts.get("p1")).toEqual({
        state: "processed",
        endState: state,
        endTime: "2026-02-01T09:00:00Z",
      });
    }
  );

  it("normalises a lowercase history state", async () => {
    const mock = mockClient({ history: { p1: { state: "completed" } } });
    const verdicts = await classifyEndedInstances(mock.client, ["p1"]);
    expect(verdicts.get("p1")).toMatchObject({ state: "processed", endState: "COMPLETED" });
  });

  it("marks an id history has never seen as not_found", async () => {
    const mock = mockClient({ history: {} });
    const verdicts = await classifyEndedInstances(mock.client, ["ghost"]);
    expect(verdicts.get("ghost")).toEqual({ state: "not_found" });
  });

  it("refuses to call an ACTIVE history row processed", async () => {
    // Runtime said it was gone but history says it is running: contradictory,
    // so it must not become skippable.
    const mock = mockClient({ history: { p1: { state: "ACTIVE" } } });
    const verdicts = await classifyEndedInstances(mock.client, ["p1"]);
    expect(verdicts.get("p1")).toEqual({ state: "unknown" });
  });

  it("falls back to an unconfirmed end state when history is unavailable", async () => {
    const mock = mockClient({ historyPostFails: true });
    const verdicts = await classifyEndedInstances(mock.client, ["a", "b"]);
    expect(verdicts.get("a")).toEqual({
      state: "processed",
      endState: UNCONFIRMED_END_STATE,
      endTime: null,
    });
    expect(verdicts.get("b")).toMatchObject({ endState: UNCONFIRMED_END_STATE });
  });

  it("separates finished ids from unknown ids in one call", async () => {
    const mock = mockClient({ history: { done: { state: "COMPLETED" } } });
    const verdicts = await classifyEndedInstances(mock.client, ["done", "ghost"]);
    expect(verdicts.get("done")).toMatchObject({ state: "processed" });
    expect(verdicts.get("ghost")).toEqual({ state: "not_found" });
    expect(verdicts.size).toBe(2);
  });

  it("chunks large id lists and still accounts for every id", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `p${i}`);
    const history = Object.fromEntries(ids.map((id) => [id, { state: "COMPLETED" }]));
    const mock = mockClient({ history });

    const verdicts = await classifyEndedInstances(mock.client, ids);

    expect(mock.post).toHaveBeenCalledTimes(3);
    const sizes = mock.post.mock.calls.map(
      (call) => (call[1] as { processInstanceIds: string[] }).processInstanceIds.length
    );
    expect(sizes).toEqual([200, 200, 50]);
    expect(verdicts.size).toBe(450);
    expect([...verdicts.values()].every((v) => v.state === "processed")).toBe(true);
  });

  it("asks for as many results as ids, so the engine default cannot truncate", async () => {
    const mock = mockClient({ history: { p1: { state: "COMPLETED" } } });
    await classifyEndedInstances(mock.client, ["p1", "p2", "p3"]);
    expect(mock.post).toHaveBeenCalledWith(
      "/history/process-instance",
      { processInstanceIds: ["p1", "p2", "p3"] },
      { params: { maxResults: 3 } }
    );
  });

  it("confines a failed chunk to that chunk alone", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `p${i}`);
    const mock = mockClient();
    let call = 0;
    mock.client.post = vi.fn(async (_url: string, body: unknown) => {
      call++;
      if (call === 1) throw httpError(500);
      const chunk = (body as { processInstanceIds: string[] }).processInstanceIds;
      return { data: chunk.map((id) => ({ id, state: "COMPLETED", endTime: null })) };
    }) as typeof mock.client.post;

    const verdicts = await classifyEndedInstances(mock.client, ids);

    expect(verdicts.get("p0")).toMatchObject({ endState: UNCONFIRMED_END_STATE });
    expect(verdicts.get("p200")).toMatchObject({ endState: "COMPLETED" });
    expect(verdicts.size).toBe(250);
  });
});

describe("classifyInstance", () => {
  it("reports a live instance as running without consulting history", async () => {
    const mock = mockClient({ runtime: { p1: "ok" } });
    await expect(classifyInstance(mock.client, "p1")).resolves.toEqual({ state: "running" });
    expect(mock.get).toHaveBeenCalledTimes(1);
  });

  it("falls through to history when the runtime lookup 404s", async () => {
    const mock = mockClient({ history: { p1: { state: "COMPLETED", endTime: "2026-03-03T08:00:00Z" } } });
    await expect(classifyInstance(mock.client, "p1")).resolves.toEqual({
      state: "processed",
      endState: "COMPLETED",
      endTime: "2026-03-03T08:00:00Z",
    });
  });

  it("reports not_found when neither runtime nor history knows the id", async () => {
    const mock = mockClient({ history: {} });
    await expect(classifyInstance(mock.client, "ghost")).resolves.toEqual({ state: "not_found" });
  });

  it("stays unknown when the runtime lookup fails for a reason other than 404", async () => {
    const mock = mockClient({ runtime: { p1: transportError() } });
    await expect(classifyInstance(mock.client, "p1")).resolves.toEqual({ state: "unknown" });
    expect(mock.get).toHaveBeenCalledTimes(1);
  });

  it("stays unknown when the history lookup itself errors", async () => {
    const mock = mockClient({ history: { p1: httpError(503) } });
    await expect(classifyInstance(mock.client, "p1")).resolves.toEqual({ state: "unknown" });
  });

  it("stays unknown when history reports the instance still active", async () => {
    const mock = mockClient({ history: { p1: { state: "ACTIVE" } } });
    await expect(classifyInstance(mock.client, "p1")).resolves.toEqual({ state: "unknown" });
  });
});

describe("describeProcessed", () => {
  it("names the end state and time", () => {
    expect(describeProcessed("COMPLETED", "2026-01-01T10:00:00Z"))
      .toBe("Already processed — finished COMPLETED at 2026-01-01T10:00:00Z");
  });

  it("omits the time when the engine did not supply one", () => {
    expect(describeProcessed("EXTERNALLY_TERMINATED", null))
      .toBe("Already processed — finished EXTERNALLY_TERMINATED");
  });

  it("says so plainly when the end state could not be confirmed", () => {
    expect(describeProcessed(UNCONFIRMED_END_STATE, null))
      .toContain("history unavailable");
  });
});
