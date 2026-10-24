import type { RateLimitResult } from '../models';

export function makeRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt),
    // IETF draft-ietf-httpapi-ratelimit-headers-11 syntax; not a published RFC.
    // On denial, Retry-After is authoritative; full recovery may be later.
    'RateLimit': `"${result.policyId}";r=${result.remaining}${result.allowed ? `;t=${result.resetAfterSeconds}` : ''}`,
    'RateLimit-Policy': `"${result.policyId}";q=${result.limit}`,
    'Cache-Control': 'no-store',
    ...(!result.allowed ? { 'Retry-After': String(result.retryAfterSeconds) } : {}),
  };
}
