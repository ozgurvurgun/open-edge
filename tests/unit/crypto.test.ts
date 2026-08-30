import { describe, expect, it } from "vitest";
import { createPasswordHasher } from "../../src/infrastructure/crypto/web-crypto.js";
import { PBKDF2_ITERATIONS } from "../../src/domain/identity/password.js";

describe("PBKDF2 hasher", () => {
  it("verifies a derived key and uses the documented iteration count", async () => {
    expect(PBKDF2_ITERATIONS).toBe(100_000);
    const hasher = createPasswordHasher();
    const { hash, salt } = await hasher.hash("correct horse");
    expect(hash).toHaveLength(64);
    expect(salt).toHaveLength(32);
    expect(await hasher.verify("correct horse", hash, salt)).toBe(true);
    expect(await hasher.verify("wrong password", hash, salt)).toBe(false);
  });
});
