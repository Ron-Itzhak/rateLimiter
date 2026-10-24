import type { ServiceConfig } from './models';

export function loadConfig(): ServiceConfig {
  return { tenants: ['org-acme-prod', 'org-beta-prod'].map(id => ({
    id, maxTrackedKeys: 1000,
    policies: [
      { id: 'tenant', tenantId: id, name: 'Tenant burst quota', scope: 'tenant',
        algorithm: 'token-bucket', capacity: 100, refillRatePerSecond: 10, keyStrategy: {} },
      { id: 'client', tenantId: id, name: 'Client rolling quota', scope: 'client',
        algorithm: 'sliding-window', capacity: 10, windowSizeSeconds: 60,
        keyStrategy: { fallbackUserToIp: true, ipv6SubnetMask: 64 } },
    ],
  })) };
}

export function validateConfig(config: ServiceConfig): void {
  const validId = (value: string) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
  const boundedInteger = (value: number, max: number) => Number.isSafeInteger(value) && value > 0 && value <= max;
  const fail = () => { throw new Error('Invalid startup configuration'); };
  if (!Array.isArray(config.tenants) || !boundedInteger(config.tenants.length, 100)) fail();
  const tenants = new Set<string>();
  for (const tenant of config.tenants) {
    if (!validId(tenant.id) || tenants.has(tenant.id) || !boundedInteger(tenant.maxTrackedKeys, 1000)) fail();
    tenants.add(tenant.id);
    if (!Array.isArray(tenant.policies) || !boundedInteger(tenant.policies.length, 32)) fail();
    const ids = new Set<string>();
    let global = 0;
    let client = 0;
    for (const policy of tenant.policies) {
      if (!validId(policy.id) || ids.has(policy.id) || policy.tenantId !== tenant.id || !boundedInteger(policy.capacity, 10_000)) fail();
      ids.add(policy.id);
      if (policy.algorithm === 'token-bucket') {
        if (!Number.isFinite(policy.refillRatePerSecond) || policy.refillRatePerSecond < 0.001 || policy.refillRatePerSecond > 1_000_000) fail();
      } else if (policy.algorithm === 'sliding-window') {
        if (!Number.isFinite(policy.windowSizeSeconds) || policy.windowSizeSeconds < 0.001 || policy.windowSizeSeconds > 86400) fail();
      } else fail();
      const key = policy.keyStrategy;
      if (!key || (key.ipv6SubnetMask !== undefined && (!Number.isInteger(key.ipv6SubnetMask) || key.ipv6SubnetMask < 0 || key.ipv6SubnetMask > 128))) fail();
      if (policy.scope === 'tenant') {
        if (policy.match || key.fallbackUserToIp || key.dimensions?.length) fail();
        global++;
      } else if (policy.scope === 'client') {
        if (key.fallbackUserToIp) {
          if (key.dimensions?.length) fail();
        } else {
          if (!key.dimensions?.length || key.dimensions.length > 4 || new Set(key.dimensions).size !== key.dimensions.length ||
              key.dimensions.some(d => !['ip', 'userId', 'route', 'header'].includes(d))) fail();
          if (key.dimensions?.includes('header') && (!key.headerName || !/^[a-zA-Z0-9-]{1,64}$/.test(key.headerName))) fail();
        }
        if (!policy.match) client++;
      } else fail();
      if (policy.match && (typeof policy.match.route !== 'string' || !policy.match.route.startsWith('/') || policy.match.route.length > 256 ||
          (policy.match.method !== undefined && !/^[A-Z]{1,20}$/.test(policy.match.method)))) fail();
    }
    if (global === 0 || client === 0) fail();
  }
}
