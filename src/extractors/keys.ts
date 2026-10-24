import { createHash } from 'node:crypto';
import { ServiceError, type RateLimitPolicy, type RequestContext } from '../models';
import { normalizeIp } from './ip';

export function buildKey(policy: RateLimitPolicy, context: RequestContext): string {
  const key: unknown[] = [context.tenantId, policy.id];
  if (policy.scope === 'tenant') return JSON.stringify(key);
  const strategy = policy.keyStrategy;
  const required = (value: string | undefined): string => {
    if (!value || value.length > 256) throw new ServiceError(400, 'MISSING_DIMENSION', 'Required key dimension missing or too long');
    return value;
  };
  const ip = () => normalizeIp(context.clientIp, strategy.ipv6SubnetMask ?? 64);
  if (strategy.fallbackUserToIp) {
    key.push(context.userId ? ['user', required(context.userId)] : ['ip', ip()]);
  } else for (const dimension of strategy.dimensions ?? []) {
    switch (dimension) {
      case 'ip': key.push(['ip', ip()]); break;
      case 'userId': key.push(['user', required(context.userId)]); break;
      case 'route': key.push(['route', required(context.route), context.method]); break;
      case 'header': {
        const matches = Object.entries(context.headers).filter(([name]) => name.toLowerCase() === strategy.headerName!.toLowerCase());
        if (matches.length !== 1 || typeof matches[0]![1] !== 'string') {
          throw new ServiceError(400, 'MISSING_DIMENSION', 'Header key must have one string value');
        }
        // Store a fingerprint instead of raw API keys/authorization material.
        key.push(['header', createHash('sha256').update(required(matches[0]![1])).digest('hex')]);
        break;
      }
    }
  }
  return JSON.stringify(key);
}
