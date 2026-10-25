import assert from "node:assert/strict";
import { test } from "node:test";
import { RateLimiter } from "../src/engine/limiter";
import { loadConfig } from "../src/config";
import { FakeClock } from "./helpers/fake-clock";
const context = {
  tenantId: "org-acme-prod",
  clientIp: "192.0.2.1",
  userId: "alice",
  route: "/test",
  method: "GET",
  headers: {},
};
test("bounded sweeps reclaim expired logs across tenants but preserve live quota", () => {
  const clock = new FakeClock();
  const limiter = new RateLimiter(loadConfig(), clock);
  for (let i = 0; i < 10; i++)
    for (const tenantId of ["org-acme-prod", "org-beta-prod"]) {
      limiter.check({ ...context, tenantId, userId: String(i) });
    }
  assert.equal(limiter.sweep(100), 0);
  clock.advance(60_000);
  for (let i = 0; i < 20; i++) assert.ok(limiter.sweep(1) <= 1);
  assert.equal(limiter.getMetrics("org-acme-prod").activeTrackedKeys, 0);
  assert.equal(limiter.getMetrics("org-beta-prod").activeTrackedKeys, 0);
});
test("client reset preserves tenant quota; whole reset preserves metrics and other tenants", () => {
  const config = loadConfig();
  config.tenants[0]!.policies[0]!.capacity = 1;
  const limiter = new RateLimiter(config, new FakeClock());
  limiter.check(context);
  assert.equal(limiter.reset(context.tenantId, { policyId: "client", context }), 1);
  assert.equal(limiter.check(context).reason, "TENANT_QUOTA_EXCEEDED");
  limiter.check({ ...context, tenantId: "org-beta-prod" });
  limiter.reset(context.tenantId);
  assert.equal(limiter.getMetrics(context.tenantId).totalEvaluations, 2);
  assert.equal(limiter.getMetrics("org-beta-prod").activeTrackedKeys, 1);
  assert.equal(limiter.check(context).allowed, true);
});
test("safe reclamation frees capacity without granting early refill", () => {
  const config = loadConfig();
  config.tenants[0]!.maxTrackedKeys = 1;
  const clock = new FakeClock();
  const limiter = new RateLimiter(config, clock);
  limiter.check(context);
  clock.advance(59_999);
  limiter.sweep(10);
  assert.throws(() => limiter.check({ ...context, userId: "bob" }), { status: 503 });
  clock.advance(1);
  limiter.sweep(10);
  assert.equal(limiter.check({ ...context, userId: "bob" }).allowed, true);
});
