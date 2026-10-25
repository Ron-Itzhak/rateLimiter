import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createApp } from "../src/app";
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
test("HTTP exposes quota headers, validation, metrics and reset", async (t) => {
  const limiter = new RateLimiter(loadConfig(), new FakeClock());
  const server = createApp(limiter).listen(0, "127.0.0.1");
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown) =>
    fetch(url + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const allowed = await post("/v1/rate-limit/check", { ...context, cost: 10 });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("x-ratelimit-remaining"), "0");
  assert.equal(allowed.headers.get("retry-after"), null);
  const denied = await post("/v1/rate-limit/check", context);
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("retry-after"), "60");
  assert.equal(denied.headers.get("ratelimit"), '"client";r=0');
  assert.equal(
    (await post("/v1/rate-limit/check", { ...context, tenantId: "unknown" })).status,
    404,
  );
  assert.equal((await post("/v1/rate-limit/check", [])).status, 400);
  assert.equal(
    (await post("/v1/rate-limit/check", { ...context, userId: "x".repeat(20_000) })).status,
    413,
  );
  const metrics = (await (await fetch(url + "/v1/tenants/org-acme-prod/metrics")).json()) as {
    allowedCount: number;
  };
  assert.equal(metrics.allowedCount, 1);
  assert.equal((await post("/v1/tenants/org-acme-prod/reset", {})).status, 200);
  assert.equal((await post("/v1/rate-limit/check", context)).status, 200);
  assert.equal((await fetch(url + "/health")).status, 200);
  assert.equal((await fetch(url + "/missing")).status, 404);
});
test("HTTP tracking exhaustion is 503, not quota 429", async (t) => {
  const config = loadConfig();
  config.tenants[0]!.maxTrackedKeys = 1;
  const server = createApp(new RateLimiter(config, new FakeClock())).listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const post = (userId: string) =>
    fetch(`http://127.0.0.1:${address.port}/v1/rate-limit/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...context, userId }),
    });
  assert.equal((await post("alice")).status, 200);
  const full = await post("bob");
  assert.equal(full.status, 503);
  assert.equal(full.headers.get("retry-after"), null);
});
