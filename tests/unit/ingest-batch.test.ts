import { describe, expect, it } from "vitest";
import { mapPool } from "../../src/shared/map-pool.js";
import { MemoryWorld, memoryDedup } from "../../src/infrastructure/memory/world.js";
import { asEventId, asTenantId } from "../../src/shared/ids.js";

describe("mapPool", () => {
  it("preserves order with limited concurrency", async () => {
    const seen: number[] = [];
    const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
      await new Promise((r) => setTimeout(r, 5));
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(seen).toHaveLength(5);
  });
});

describe("memory dedup batch", () => {
  it("filters and remembers many", async () => {
    const w = new MemoryWorld();
    const dedup = memoryDedup(w);
    const tenant = asTenantId("t1");
    const a = asEventId("a");
    const b = asEventId("b");
    const c = asEventId("c");
    await dedup.remember(tenant, a, 1);
    const unseen = await dedup.filterUnseen(tenant, [a, b, c]);
    expect(unseen).toEqual([b, c]);
    await dedup.rememberMany(tenant, unseen, 2);
    expect(await dedup.filterUnseen(tenant, [a, b, c])).toEqual([]);
  });
});
