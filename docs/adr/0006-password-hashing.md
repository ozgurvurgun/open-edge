# ADR 0006: PBKDF2 via Web Crypto

## Status

Accepted

## Context

Workers expose Web Crypto. Native argon2/bcrypt are not available without WASM cost and supply-chain risk.

## Decision

PBKDF2-SHA-256, 100_000 iterations (Worker CPU budget), random 16-byte salt, 32-byte derived key. Parameters stored with the hash.

## Consequences

Argon2 would be stronger on general-purpose servers. On Workers, using the platform primitive is the correct security engineering choice. Iteration count can be raised by migration.
