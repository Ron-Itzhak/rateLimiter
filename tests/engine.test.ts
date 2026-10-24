import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RateLimiter } from '../src/engine/limiter';
import { loadConfig } from '../src/config';
import { FakeClock } from './helpers/fake-clock';

const context = { tenantId: 'org-acme-prod', clientIp: '192.0.2.1', userId: 'alice', route: '/test', method: 'GET', headers: {} };
test('noisy client denials do not consume tenant quota or affect another tenant', () => {
  const config = loadConfig();
  const limiter = new RateLimiter(config, new FakeClock());
  assert.equal(limiter.check({ ...context, cost: 10 }).allowed, true);
  for (let i = 0; i < 200; i++) assert.equal(limiter.check(context).allowed, false);
  assert.equal(limiter.check({ ...context, userId: 'bob', cost: 10 }).allowed, true);
  assert.equal(limiter.check({ ...context, tenantId: 'org-beta-prod', cost: 10 }).allowed, true);
  assert.equal(limiter.getMetrics(context.tenantId).noisyNeighborsIsolated, 1);
});
test('tenant failure neither consumes client quota nor allocates a key', () => {
  const config = loadConfig();
  config.tenants[0]!.policies[0]!.capacity = 1;
  const clock = new FakeClock();
  const limiter = new RateLimiter(config, clock);
  assert.equal(limiter.check(context).allowed, true);
  assert.equal(limiter.check({ ...context, userId: 'bob' }).reason, 'TENANT_QUOTA_EXCEEDED');
  assert.equal(limiter.getMetrics(context.tenantId).activeTrackedKeys, 1);
  clock.advance(100);
  assert.equal(limiter.check({ ...context, userId: 'bob' }).remaining, 0);
});
test('tracking cap rejects new identities but keeps existing ones usable', () => {
  const config = loadConfig(); config.tenants[0]!.maxTrackedKeys = 1;
  config.tenants[0]!.policies[0]!.capacity = 2;
  const limiter = new RateLimiter(config, new FakeClock());
  limiter.check(context);
  assert.throws(() => limiter.check({ ...context, userId: 'bob' }), { code: 'TRACKING_CAPACITY' });
  assert.equal(limiter.check(context).allowed, true);
});

test('later client denial does not commit an existing sliding log preview', () => {
  const config = loadConfig(); const tenant = config.tenants[0]!;
  tenant.policies.push({ ...tenant.policies[1]!, id: 'strict', capacity: 1 });
  const limiter = new RateLimiter(config, new FakeClock());
  assert.equal(limiter.check(context).allowed, true);
  for (let i = 0; i < 20; i++) assert.equal(limiter.check(context).allowed, false);
  assert.equal(limiter.getMetrics(context.tenantId).activeTrackedKeys, 2);
  limiter.reset(context.tenantId, { policyId: 'strict', context });
  assert.equal(limiter.check(context).allowed, true);
});
test('multiple client policies allocate all or none', () => {
  const config = loadConfig(); const tenant = config.tenants[0]!;
  tenant.maxTrackedKeys = 1;
  tenant.policies.push({ ...tenant.policies[1]!, id: 'second' });
  const limiter = new RateLimiter(config, new FakeClock());
  assert.throws(() => limiter.check(context), { code: 'TRACKING_CAPACITY' });
  assert.equal(limiter.getMetrics(context.tenantId).activeTrackedKeys, 0);
});
test('both algorithms can be used at either hierarchy level', () => {
  const config = loadConfig(); const tenant = config.tenants[0]!;
  tenant.policies[0] = { ...tenant.policies[0]!, algorithm: 'sliding-window', windowSizeSeconds: 60, capacity: 2 };
  tenant.policies[1] = { ...tenant.policies[1]!, algorithm: 'token-bucket', refillRatePerSecond: 1, capacity: 1 };
  const limiter = new RateLimiter(config, new FakeClock());
  assert.equal(limiter.check(context).allowed, true);
  assert.equal(limiter.check(context).reason, 'CLIENT_KEY_EXCEEDED');
  assert.equal(limiter.check({ ...context, userId: 'bob' }).allowed, true);
  assert.equal(limiter.check({ ...context, userId: 'charlie' }).reason, 'TENANT_QUOTA_EXCEEDED');
});
test('invalid contexts and impossible costs do not create state', () => {
  const limiter = new RateLimiter(loadConfig(), new FakeClock());
  for (const cost of [0, -1, 0.5, 11]) assert.throws(() => limiter.check({ ...context, cost }), { status: 400 });
  assert.throws(() => limiter.check({ ...context, userId: 'a'.repeat(257) }), { status: 400 });
  assert.throws(() => limiter.check({ ...context, tenantId: 'unknown' }), { status: 404 });
  assert.equal(limiter.getMetrics(context.tenantId).activeTrackedKeys, 0);
});
