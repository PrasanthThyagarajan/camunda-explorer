import { describe, expect, it, vi } from "vitest";
import { processInstanceTools } from "../process-instances.js";

type Handler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
}>;

const httpError = (status: number, message?: string) =>
  Object.assign(new Error(message || `HTTP ${status}`), {
    response: { status, data: message ? { message } : undefined },
  });

/**
 * Registers the real tool module against a stub server so the registered
 * handler can be invoked directly, and returns the modify handler.
 */
function registerTools(client: Record<string, unknown>) {
  const handlers = new Map<string, Handler>();
  const server = {
    tool: (name: string, _desc: string, _schema: unknown, handler: Handler) => {
      handlers.set(name, handler);
    },
  };
  processInstanceTools.register(
    server as unknown as Parameters<typeof processInstanceTools.register>[0],
    client as unknown as Parameters<typeof processInstanceTools.register>[1]
  );
  const modify = handlers.get("camunda_modify_process_instance");
  if (!modify) throw new Error("modify tool was not registered");
  return { modify, handlers };
}

const instructions = [{ type: "startBeforeActivity", activityId: "Task_A" }];

function textOf(result: { content: Array<{ text: string }> }) {
  return result.content.map((c) => c.text).join("\n");
}

describe("camunda_modify_process_instance — already-processed handling", () => {
  it("reports the end state instead of a raw 404 when the instance has finished", async () => {
    const post = vi.fn(async (url: string) => {
      if (url.endsWith("/modification")) throw httpError(404);
      throw new Error(`Unexpected POST ${url}`);
    });
    const get = vi.fn(async (url: string) => {
      if (url === "/process-instance/p1") throw httpError(404);
      if (url === "/history/process-instance/p1") {
        return { data: { id: "p1", state: "COMPLETED", endTime: "2026-04-01T12:00:00Z" } };
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    const { modify } = registerTools({ get, post });
    const text = textOf(await modify({ processInstanceId: "p1", instructions }));

    expect(text).toContain("No modification applied to p1");
    expect(text).toContain("COMPLETED");
    expect(text).toContain("2026-04-01T12:00:00Z");
    expect(text).not.toMatch(/404/);
  });

  it("does not swallow a 404 when the instance is unknown to history too", async () => {
    const post = vi.fn(async () => { throw httpError(404); });
    const get = vi.fn(async () => { throw httpError(404); });

    const { modify } = registerTools({ get, post });
    const text = textOf(await modify({ processInstanceId: "ghost", instructions }));

    expect(text).not.toContain("No modification applied");
    expect(text.toLowerCase()).toMatch(/error|fail|404/);
  });

  it("surfaces a genuine engine failure rather than calling it processed", async () => {
    const post = vi.fn(async () => { throw httpError(500, "engine exploded"); });
    const get = vi.fn();

    const { modify } = registerTools({ get, post });
    const text = textOf(await modify({ processInstanceId: "p1", instructions }));

    expect(text).toContain("engine exploded");
    expect(text).not.toContain("No modification applied");
    // A non-404 must not trigger a liveness lookup at all.
    expect(get).not.toHaveBeenCalled();
  });

  it("does not claim the instance is processed when history says it is still active", async () => {
    const post = vi.fn(async () => { throw httpError(404); });
    const get = vi.fn(async (url: string) => {
      if (url === "/process-instance/p1") throw httpError(404);
      return { data: { id: "p1", state: "ACTIVE", endTime: null } };
    });

    const { modify } = registerTools({ get, post });
    const text = textOf(await modify({ processInstanceId: "p1", instructions }));

    expect(text).not.toContain("No modification applied");
  });

  it("reports success normally when the modification goes through", async () => {
    const post = vi.fn(async () => ({ data: {} }));
    const get = vi.fn();

    const { modify } = registerTools({ get, post });
    const text = textOf(await modify({ processInstanceId: "p1", instructions }));

    expect(text).toContain("modified successfully");
    expect(text).toContain("Instructions executed: 1");
    expect(get).not.toHaveBeenCalled();
  });

  it("sends the documented default annotation and skip flags", async () => {
    const post = vi.fn(async () => ({ data: {} }));
    const { modify } = registerTools({ get: vi.fn(), post });

    await modify({ processInstanceId: "p1", instructions });

    expect(post).toHaveBeenCalledWith("/process-instance/p1/modification", {
      skipCustomListeners: false,
      skipIoMappings: false,
      instructions,
      annotation: "Modified via Camunda Explorer",
    });
  });
});
