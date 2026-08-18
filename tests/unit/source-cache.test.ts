import { describe, expect, it } from "vitest";
import { SourceCache } from "../../src/cache/source-cache.js";

describe("SourceCache", () => {
  it("returns exact inclusive one-based source ranges", () => {
    const cache = new SourceCache(10);
    cache.put("SAH", "/programs/ztest", "one\ntwo\nthree");

    expect(cache.readRange("SAH", "/programs/ztest", 2, 3)).toEqual({
      fromLine: 2,
      toLine: 3,
      lines: ["two", "three"],
    });
  });

  it("evicts the oldest entry when the bounded capacity is reached", () => {
    const cache = new SourceCache(1);
    cache.put("SAH", "/one", "first");
    cache.put("SAH", "/two", "second");

    expect(() => cache.readRange("SAH", "/one", 1, 1)).toThrow(/not cached/i);
    expect(cache.readRange("SAH", "/two", 1, 1).lines).toEqual(["second"]);
  });
});
