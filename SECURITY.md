# Security

## Threat model (summary)

| Threat                             | Control                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Tenant escape via query/header     | Tenant id from session/API key only; every repository filters `tenant_id` |
| Privilege escalation               | Central deny-by-default policies                                          |
| SQL injection                      | Prepared statements, no string-built SQL                                  |
| Query injection / ReDoS            | Parser + regex budget + complexity reject                                 |
| Cache poisoning / leakage          | Cache keys include tenant + scopes                                        |
| API key abuse                      | Hashed storage, scopes, revoke, last-used, rate limits                    |
| Brute force / stuffing             | Attempt table + Rate Limit binding                                        |
| Session fixation / replay          | New session on login, hashed tokens, revoke                               |
| CSRF                               | Origin allow-list + CSRF header for cookie mutations                      |
| Path traversal / malicious R2 keys | Server-generated keys only                                                |
| Oversized requests                 | Body limits at Hono middleware                                            |
| XSS via API                        | JSON-only responses, no reflected HTML                                    |
| SSRF                               | No user-controlled outbound fetch                                         |
| Secret leakage in errors           | Stable error codes; no stack/SQL/keys                                     |

## Password hashing

PBKDF2-SHA-256 via Web Crypto (available on Workers). 210_000 iterations. Not a home-grown cipher.

## Data in errors

Responses never include stack traces, SQL, R2 keys, or Cloudflare internals.

## Email

Tokens hashed at rest. Email adapter must not log raw tokens in production.
