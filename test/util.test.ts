import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateId } from "../src/util.js";

describe("generateId", () => {
  it("returns MMDD-HHMMSS-mmm-XXXX format", () => {
    const id = generateId();
    assert.match(id, /^\d{4}-\d{6}-\d{3}-[a-f0-9]{4}$/);
  });

  it("produces nearly all unique ids under tight bursts", () => {
    // 65k random tail + ms timestamp; in a tight loop the random suffix
    // is the only differentiator within the same millisecond. We allow a
    // tiny number of collisions across a 1000-id burst rather than chase
    // perfect uniqueness; the property we care about is that it does not
    // collapse.
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(generateId());
    assert.ok(ids.size > 990, `expected >990 unique ids, got ${ids.size}`);
  });
});
