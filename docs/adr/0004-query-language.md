# ADR 0004: LogQL-inspired language with staged engine

## Status

Accepted

## Context

Clients need a compact log selector language. Full Loki LogQL is too large for v1.

## Decision

Implement a documented subset with lexer, parser, AST, semantic checks, planner, executor. Reject dangerous regex.

## Consequences

Frontend must not re-implement the grammar for execution. Autocomplete may tokenize loosely; the backend is authoritative.
