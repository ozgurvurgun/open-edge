import { describe, expect, it } from "vitest";
import { validatePasswordPlaintext } from "../../src/domain/identity/password.js";
import { apiKeyHasPermission, roleHasPermission } from "../../src/domain/identity/permissions.js";
import { createLabelSet, fingerprintLabels, labelSetError } from "../../src/domain/logs/labels.js";
import { isValidRetentionDays } from "../../src/domain/retention/policy.js";
import { compareThreshold } from "../../src/domain/alerting/alert.js";
import { slugify, tenantAcceptsWrites } from "../../src/domain/tenant/tenant.js";
import { asTenantId } from "../../src/shared/ids.js";
import { isDangerousRegex } from "../../src/domain/query/query-limits.js";
import { errorRate } from "../../src/domain/apm/stats.js";

describe("password policy", () => {
  it("rejects short passwords", () => {
    expect(validatePasswordPlaintext("short")).toBeTruthy();
  });
  it("accepts long passwords", () => {
    expect(validatePasswordPlaintext("correct horse")).toBeNull();
  });
});

describe("rbac", () => {
  it("denies viewer writes", () => {
    expect(roleHasPermission("viewer", "logs:write")).toBe(false);
    expect(roleHasPermission("editor", "logs:write")).toBe(true);
    expect(roleHasPermission("owner", "tenant:admin")).toBe(true);
  });
  it("api key admin cannot delete tenant", () => {
    expect(apiKeyHasPermission(["admin"], "tenant:admin")).toBe(false);
  });
});

describe("labels", () => {
  it("rejects high-cardinality stream labels", () => {
    expect(labelSetError(createLabelSet({ user_id: "1" }))).toMatch(/high-cardinality/);
  });
  it("fingerprints stably", () => {
    expect(fingerprintLabels(createLabelSet({ b: "2", a: "1" }))).toBe("a=1,b=2");
  });
});

describe("retention", () => {
  it("allows presets and custom bounds", () => {
    expect(isValidRetentionDays(30)).toBe(true);
    expect(isValidRetentionDays(14)).toBe(true);
    expect(isValidRetentionDays(0)).toBe(false);
    expect(isValidRetentionDays(800)).toBe(false);
  });
});

describe("alerts and apm", () => {
  it("compares thresholds", () => {
    expect(compareThreshold(5, "gt", 4)).toBe(true);
    expect(compareThreshold(5, "lt", 4)).toBe(false);
  });
  it("computes error rate", () => {
    expect(
      errorRate({
        tenantId: asTenantId("t"),
        service: "api",
        operation: "GET /",
        periodStart: 0,
        requestCount: 10,
        errorCount: 2,
        durationSumMs: 100,
        durationMaxMs: 20,
      }),
    ).toBe(0.2);
  });
});

describe("tenant", () => {
  it("slugifies names", () => {
    expect(slugify("Acme Corp!")).toBe("acme-corp");
  });
  it("blocks writes when disabled", () => {
    expect(
      tenantAcceptsWrites({
        id: asTenantId("t"),
        name: "t",
        slug: "t",
        status: "disabled",
        createdAt: 0,
        updatedAt: 0,
      }),
    ).toBe(false);
  });
});

describe("regex safety", () => {
  it("rejects nested unbounded quantifiers", () => {
    expect(isDangerousRegex("(a+)+b")).toBe(true);
    expect(isDangerousRegex("error")).toBe(false);
  });
});
