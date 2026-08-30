#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const dir = path.resolve(process.cwd(), "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

if (files.length === 0) {
  console.error("No migrations found.");
  process.exit(1);
}

const seen = new Set();
for (const file of files) {
  const match = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(file);
  if (!match) {
    console.error(`Invalid migration name: ${file}`);
    process.exit(1);
  }
  if (seen.has(match[1])) {
    console.error(`Duplicate migration version: ${match[1]}`);
    process.exit(1);
  }
  seen.add(match[1]);
  const sql = await readFile(path.join(dir, file), "utf8");
  if (sql.trim().length === 0) {
    console.error(`Empty migration: ${file}`);
    process.exit(1);
  }
  if (/drop\s+table/i.test(sql) && !/safe|rebuild/i.test(file)) {
    console.warn(`Warning: ${file} contains DROP TABLE`);
  }
}

console.log(`Validated ${files.length} migration(s).`);
