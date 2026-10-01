import { describe, expect, it } from "vitest";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_INSTANCE_BATCH_SIZE,
  MAX_DELETE_BATCH_SIZE,
  MAX_INCIDENT_BATCH_SIZE,
  MAX_INSTANCE_BATCH_SIZE,
} from "../../constants.js";
import { parseBatchSize } from "../actions.routes.js";

describe("parseBatchSize", () => {
  it("uses the fallback when the client sends nothing", () => {
    expect(parseBatchSize(undefined, 10, 100)).toBe(10);
    expect(parseBatchSize(null, 10, 100)).toBe(10);
  });

  it("accepts an integer inside the range", () => {
    expect(parseBatchSize(25, 10, 100)).toBe(25);
  });

  it("accepts both boundaries", () => {
    expect(parseBatchSize(1, 10, 100)).toBe(1);
    expect(parseBatchSize(100, 10, 100)).toBe(100);
  });

  // Zero is the dangerous one: the services advance with `i += batchSize`, so a
  // zero would loop forever and take the event loop down with it.
  it("rejects zero rather than letting it reach a batching loop", () => {
    expect(parseBatchSize(0, 10, 100)).toBeNull();
  });

  it.each([
    ["a negative number", -1],
    ["just past the ceiling", 101],
    ["far past the ceiling", 100000],
    ["a fractional number", 1.5],
    ["a numeric string", "10"],
    ["a boolean", true],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["an object", {}],
    ["an array", [10]],
  ])("rejects %s", (_label, value) => {
    expect(parseBatchSize(value, 10, 100)).toBeNull();
  });

  it("applies whichever ceiling the caller passes", () => {
    expect(parseBatchSize(50, 10, MAX_INCIDENT_BATCH_SIZE)).toBe(50);
    expect(parseBatchSize(50, 10, MAX_DELETE_BATCH_SIZE)).toBeNull();
  });

  describe("against the real route ceilings", () => {
    it("allows an incident batch up to its maximum but no further", () => {
      expect(parseBatchSize(MAX_INCIDENT_BATCH_SIZE, DEFAULT_BATCH_SIZE, MAX_INCIDENT_BATCH_SIZE))
        .toBe(MAX_INCIDENT_BATCH_SIZE);
      expect(parseBatchSize(MAX_INCIDENT_BATCH_SIZE + 1, DEFAULT_BATCH_SIZE, MAX_INCIDENT_BATCH_SIZE))
        .toBeNull();
    });

    it("allows an instance batch up to its maximum but no further", () => {
      expect(parseBatchSize(MAX_INSTANCE_BATCH_SIZE, DEFAULT_INSTANCE_BATCH_SIZE, MAX_INSTANCE_BATCH_SIZE))
        .toBe(MAX_INSTANCE_BATCH_SIZE);
      expect(parseBatchSize(MAX_INSTANCE_BATCH_SIZE + 1, DEFAULT_INSTANCE_BATCH_SIZE, MAX_INSTANCE_BATCH_SIZE))
        .toBeNull();
    });

    it("holds the delete strategy to the tighter blast-radius cap", () => {
      expect(MAX_DELETE_BATCH_SIZE).toBeLessThan(MAX_INCIDENT_BATCH_SIZE);
      expect(parseBatchSize(MAX_DELETE_BATCH_SIZE, DEFAULT_BATCH_SIZE, MAX_DELETE_BATCH_SIZE))
        .toBe(MAX_DELETE_BATCH_SIZE);
      expect(parseBatchSize(MAX_DELETE_BATCH_SIZE + 1, DEFAULT_BATCH_SIZE, MAX_DELETE_BATCH_SIZE))
        .toBeNull();
    });

    it("keeps the default delete fallback within the delete cap", () => {
      const fallback = Math.min(DEFAULT_BATCH_SIZE, MAX_DELETE_BATCH_SIZE);
      expect(parseBatchSize(undefined, fallback, MAX_DELETE_BATCH_SIZE)).toBeLessThanOrEqual(
        MAX_DELETE_BATCH_SIZE
      );
    });
  });
});
