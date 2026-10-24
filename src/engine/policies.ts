import { ServiceError, type ServiceConfig, type RequestContext, type RateLimitPolicy } from '../models';

export function resolvePolicies(config: ServiceConfig, context: RequestContext): RateLimitPolicy[] {
  const tenant = config.tenants.find(item => item.id === context.tenantId);
  if (!tenant) throw new ServiceError(404, 'UNKNOWN_TENANT', 'Unknown tenant');
  return tenant.policies.filter(policy => !policy.match || (policy.match.route === context.route &&
    (!policy.match.method || policy.match.method === context.method)));
}
