import { describe, expect, it } from "vitest";
import { MemoryWorld, memoryCache, memoryObjects } from "../../src/infrastructure/memory/world.js";

describe("memory adapters", () => {
  it("expires cache entries", async () => {
    let now = 1000;
    const world = new MemoryWorld();
    const cache = memoryCache(world, () => now);
    await cache.put("k", "v", 1);
    expect(await cache.get("k")).toBe("v");
    now = 3000;
    expect(await cache.get("k")).toBeNull();
  });

  it("stores objects by key", async () => {
    const world = new MemoryWorld();
    const objects = memoryObjects(world);
    await objects.put("t/x", new Uint8Array([1, 2]));
    expect((await objects.get("t/x"))?.[1]).toBe(2);
    await objects.delete("t/x");
    expect(await objects.get("t/x")).toBeNull();
  });
});
