export interface TokenBucketPolicy {
  algorithm: "token-bucket";
  capacity: number;
  refillRatePerSecond: number;
}

export interface SlidingWindowPolicy {
  algorithm: "sliding-window";
  capacity: number;
  windowSizeSeconds: number;
}

export type AlgorithmPolicy = TokenBucketPolicy | SlidingWindowPolicy;

export interface TokenBucketState {
  algorithm: "token-bucket";
  tokens: number;
  updatedAtMs: number;
}

export interface SlidingWindowState {
  algorithm: "sliding-window";
  events: Array<{ atMs: number; cost: number }>;
  head: number;
  totalCost: number;
}

export type QuotaState = TokenBucketState | SlidingWindowState;

export interface KeyStrategy {
  dimensions?: Array<"ip" | "userId" | "route" | "header">;
  fallbackUserToIp?: boolean;
  headerName?: string;
  ipv6SubnetMask?: number;
}
export type RateLimitPolicy = AlgorithmPolicy & {
  id: string;
  tenantId: string;
  name: string;
  scope: "tenant" | "client";
  keyStrategy: KeyStrategy;
  match?: { route: string; method?: string };
};
export interface RequestContext {
  tenantId: string;
  clientIp: string;
  userId?: string;
  route: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  cost?: number;
  priority?: "critical" | "standard" | "background";
}
export interface ServiceConfig {
  tenants: Array<{ id: string; maxTrackedKeys: number; policies: RateLimitPolicy[] }>;
}
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  resetAfterSeconds: number;
  policyId: string;
  retryAfterSeconds?: number;
  reason?: "TENANT_QUOTA_EXCEEDED" | "CLIENT_KEY_EXCEEDED";
}
export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
