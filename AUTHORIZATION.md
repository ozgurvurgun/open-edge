# Authorization

Default: **DENY**.

Roles are convenience labels. Enforcement is permission-based in application policies.

| Role   | Permissions                                                                                   |
| ------ | --------------------------------------------------------------------------------------------- |
| Viewer | `logs:read`, `metrics:read`, `traces:read`, `dashboards:read`, `alerts:read`, `usage:read`    |
| Editor | Viewer + `logs:write`, `metrics:write`, `traces:write`, `dashboards:write`, `alerts:write`    |
| Admin  | Editor + `api-keys:write`, `retention:write`, `deletion:write`, `members:write`, `audit:read` |
| Owner  | Admin + `tenant:admin`                                                                        |

API keys carry explicit scopes. `admin` on a key is not Owner; it cannot delete the tenant.

Client-supplied role headers are ignored.

## Policy location

`src/application/authorization/policies.ts` is the only authorization decision point. Handlers ask for a permission; they do not compare role strings.
