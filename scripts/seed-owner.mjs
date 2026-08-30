#!/usr/bin/env node
/**
 * Seeds the first owner + tenant into D1 (local or remote).
 *
 * Usage:
 *   node scripts/seed-owner.mjs --local \
 *     --email owner@example.com --password 'correct horse staple' \
 *     --name 'Ops Owner' --tenant 'Acme'
 *
 *   node scripts/seed-owner.mjs --remote \
 *     --email owner@example.com --password 'correct horse staple' \
 *     --name 'Ops Owner' --tenant 'Acme'
 */

import { randomBytes, randomUUID, webcrypto } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PBKDF2_ITERATIONS = 100_000;
const DEFAULT_RETENTION_DAYS = 30;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function toHex(buf) {
  return Buffer.from(buf).toString("hex");
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return { hash: toHex(bits), salt: toHex(salt) };
}

async function main() {
  const remote = hasFlag("remote");
  const local = hasFlag("local") || !remote;
  if (hasFlag("remote") && hasFlag("local")) {
    throw new Error("Use either --local or --remote, not both.");
  }

  const email = (arg("email") ?? "").trim().toLowerCase();
  const password = arg("password") ?? "";
  const displayName = (arg("name") ?? "Owner").trim();
  const tenantName = (arg("tenant") ?? "Default").trim();

  if (!email || !email.includes("@")) throw new Error("--email is required");
  if (password.length < 12) throw new Error("--password must be at least 12 characters");

  const now = Date.now();
  const userId = randomUUID();
  const tenantId = randomUUID();
  const slug = slugify(tenantName) || `tenant-${tenantId.slice(0, 8)}`;
  const { hash, salt } = await hashPassword(password);

  const sql = `
BEGIN TRANSACTION;
INSERT INTO tenants (id, name, slug, status, created_at, updated_at)
VALUES (${sqlString(tenantId)}, ${sqlString(tenantName)}, ${sqlString(slug)}, 'active', ${now}, ${now});
INSERT INTO users (id, email, password_hash, password_salt, display_name, created_at, updated_at)
VALUES (${sqlString(userId)}, ${sqlString(email)}, ${sqlString(hash)}, ${sqlString(salt)}, ${sqlString(displayName)}, ${now}, ${now});
INSERT INTO tenant_memberships (tenant_id, user_id, role, created_at)
VALUES (${sqlString(tenantId)}, ${sqlString(userId)}, 'owner', ${now});
INSERT INTO retention_policies (tenant_id, logs_days, metrics_days, traces_days, updated_at, updated_by)
VALUES (${sqlString(tenantId)}, ${DEFAULT_RETENTION_DAYS}, ${DEFAULT_RETENTION_DAYS}, ${DEFAULT_RETENTION_DAYS}, ${now}, ${sqlString(userId)});
COMMIT;
`.trim();

  const file = join(tmpdir(), `open-edge-seed-${tenantId}.sql`);
  writeFileSync(file, sql, "utf8");

  const target = remote ? "--remote" : "--local";
  try {
    execFileSync("npx", ["wrangler", "d1", "execute", "open-edge", target, "--file", file], {
      stdio: "inherit",
    });
  } finally {
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        target: remote ? "remote" : "local",
        userId,
        tenantId,
        email,
        tenantName,
        slug,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
