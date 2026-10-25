// Repeatable diagnostic, not a benchmark or a production heap guarantee.
const { loadConfig } = require("../dist/config");
const { RateLimiter } = require("../dist/engine/limiter");
if (!global.gc) throw new Error("Run node --expose-gc scripts/memory-profile.cjs");
const config = loadConfig();
// Permit filling every client log at one instant without aggregate quota rejection.
for (const tenant of config.tenants) tenant.policies[0].capacity = 10_000;
global.gc();
const before = process.memoryUsage().heapUsed;
const limiter = new RateLimiter(config, { monotonicMs: () => 0, unixMs: () => 1_800_000_000_000 });
for (const tenant of config.tenants)
  for (let key = 0; key < 1000; key++) {
    for (let event = 0; event < 10; event++) {
      const result = limiter.check({
        tenantId: tenant.id,
        clientIp: "192.0.2.1",
        userId: `user-${key}`,
        route: "/example",
        method: "GET",
        headers: {},
      });
      if (!result.allowed) throw new Error("Unexpected rejection");
    }
  }
global.gc();
const after = process.memoryUsage().heapUsed;
console.log(
  JSON.stringify(
    {
      node: process.version,
      trackedKeys: 2000,
      activeEvents: 20000,
      observedHeapDeltaBytes: after - before,
      modeledStateBytes: config.tenants.reduce(
        (sum, tenant) => sum + limiter.getMetrics(tenant.id).currentMemoryEstimatedBytes,
        0,
      ),
    },
    null,
    2,
  ),
);
