import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeIp } from '../src/extractors/ip';
import { buildKey } from '../src/extractors/keys';
import { resolveClientIp } from '../src/extractors/proxy';
import { loadConfig, validateConfig } from '../src/config';
import { resolvePolicies } from '../src/engine/policies';

const context = { tenantId: 'org-acme-prod', clientIp: '192.0.2.1', userId: 'alice', route: '/test', method: 'GET', headers: {} };
test('startup config supplies hierarchy and rejects invalid policies', () => {
  const config = loadConfig();
  assert.equal(config.tenants[0]!.policies.length, 2);
  config.tenants[0]!.policies[0]!.capacity = 0;
  assert.throws(() => validateConfig(config));
});
test('IPv6 groups by /64 and mapped IPv4 normalizes consistently', () => {
  assert.equal(normalizeIp('2001:db8:1:2::1', 64), normalizeIp('2001:db8:1:2::abcd', 64));
  assert.notEqual(normalizeIp('2001:db8:1:2::1', 64), normalizeIp('2001:db8:1:3::1', 64));
  assert.equal(normalizeIp('::ffff:192.0.2.1', 64), normalizeIp('192.0.2.1', 64));
  assert.throws(() => normalizeIp('not-an-ip', 64));
});
test('fallback identity prefers users; explicit dimensions require their inputs', () => {
  const policy = loadConfig().tenants[0]!.policies[1]!;
  assert.equal(buildKey(policy, context), buildKey(policy, { ...context, clientIp: '192.0.2.2' }));
  assert.notEqual(buildKey(policy, context), buildKey(policy, { ...context, userId: undefined }));
  policy.keyStrategy = { dimensions: ['userId', 'route'] };
  assert.throws(() => buildKey(policy, { ...context, userId: undefined }));
  assert.notEqual(buildKey(policy, { ...context, userId: 'a|b', route: 'c' }), buildKey(policy, { ...context, userId: 'a', route: 'b|c' }));
  policy.keyStrategy = { dimensions: ['header'], headerName: 'X-Api-Key' };
  assert.equal(buildKey(policy, { ...context, headers: { 'x-api-key': 'abc' } }), buildKey(policy, { ...context, headers: { 'X-API-KEY': 'abc' } }));
});
test('proxy resolution ignores untrusted forwarding and stops at first untrusted hop', () => {
  assert.equal(resolveClientIp('192.0.2.1', 'spoof', []), '192.0.2.1');
  assert.equal(resolveClientIp('127.0.0.1', 'spoof, 192.0.2.8, 10.0.0.1', ['127.0.0.1/32', '10.0.0.0/8']), '192.0.2.8');
  assert.throws(() => resolveClientIp('127.0.0.1', 'invalid', ['127.0.0.1/32']));
  assert.equal(resolveClientIp('::ffff:127.0.0.1', '192.0.2.8', ['::ffff:127.0.0.1/128']), '192.0.2.8');
});

test('invalid startup policy combinations cannot disable the hierarchy', () => {
  for (const mutate of [
    (c: ReturnType<typeof loadConfig>) => { c.tenants[0]!.policies[1]!.id = 'tenant'; },
    (c: ReturnType<typeof loadConfig>) => { c.tenants[0]!.policies[1]!.keyStrategy.ipv6SubnetMask = 129; },
    (c: ReturnType<typeof loadConfig>) => { c.tenants[0]!.policies[0]!.capacity = Infinity; },
    (c: ReturnType<typeof loadConfig>) => { c.tenants[0]!.policies.pop(); },
  ]) {
    const config = loadConfig(); mutate(config); assert.throws(() => validateConfig(config));
  }
});

test('route policy matches method and path without replacing baseline limits', () => {
  const config = loadConfig(); const tenant = config.tenants[0]!;
  tenant.policies.push({ ...tenant.policies[1]!, id: 'checkout', match: { route: '/checkout', method: 'POST' } });
  assert.equal(resolvePolicies(config, context).length, 2);
  assert.equal(resolvePolicies(config, { ...context, route: '/checkout', method: 'POST' }).length, 3);
  assert.equal(resolvePolicies(config, { ...context, route: '/checkout', method: 'GET' }).length, 2);
});
