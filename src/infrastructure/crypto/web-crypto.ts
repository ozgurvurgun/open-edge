import type { Checksum, PasswordHasher, TokenHasher } from "../../application/ports.js";
import { PBKDF2_ITERATIONS } from "../../domain/identity/password.js";

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function createPasswordHasher(): PasswordHasher {
  return {
    async hash(password: string) {
      const saltBytes = randomBytes(16);
      const key = await pbkdf2(password, saltBytes);
      return { hash: toHex(key), salt: toHex(saltBytes) };
    },
    async verify(password: string, hash: string, salt: string) {
      const key = await pbkdf2(password, fromHex(salt));
      const actual = toHex(key);
      if (actual.length !== hash.length) {
        return false;
      }
      let diff = 0;
      for (let i = 0; i < actual.length; i += 1) {
        diff |= actual.charCodeAt(i) ^ hash.charCodeAt(i);
      }
      return diff === 0;
    },
  };
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const saltCopy = new Uint8Array(salt);
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltCopy,
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    256,
  );
}

export function createTokenHasher(): TokenHasher {
  return {
    async hash(token: string) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      return toHex(digest);
    },
    randomToken() {
      return toHex(randomBytes(32));
    },
  };
}

export function createChecksum(): Checksum {
  return {
    async sha256Hex(data: Uint8Array) {
      const digest = await crypto.subtle.digest("SHA-256", data);
      return toHex(digest);
    },
  };
}

export function createIdGenerator() {
  return {
    id() {
      return crypto.randomUUID();
    },
  };
}

export function systemClock() {
  return { now: () => Date.now() };
}
