import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import express from "express";
import { createRateLimitMiddleware } from "../src/http/middleware";
import { RateLimiter } from "../src/engine/limiter";
import { loadConfig } from "../src/config";
import { FakeClock } from "./helpers/fake-clock";
import { startServer } from "../src/server";

test("middleware passes admitted requests and stops denied requests", async (t) => {
  const limiter = new RateLimiter(loadConfig(), new FakeClock());
  const app = express();
  let reached = 0;
  app.use(
    createRateLimitMiddleware(limiter, () => ({
      tenantId: "org-acme-prod",
      userId: "alice",
      clientIp: "192.0.2.1",
      route: "/demo",
      method: "GET",
      headers: {},
      cost: 10,
    })),
  );
  app.get("/demo", (_req, res) => {
    reached++;
    res.json({ ok: true });
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/demo`;
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url)).status, 429);
  assert.equal(reached, 1);
});

test("server lifecycle closes its listener after health responds", async () => {
  const { server, stop } = startServer(0);
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/health`)).status, 200);
  } finally {
    await stop();
  }
  assert.equal(server.listening, false);
});
