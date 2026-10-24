export interface TokenBucketPolicy {
  algorithm: 'token-bucket';
  capacity: number;
  refillRatePerSecond: number;
}

export interface SlidingWindowPolicy {
  algorithm: 'sliding-window';
  capacity: number;
  windowSizeSeconds: number;
}

export type AlgorithmPolicy = TokenBucketPolicy | SlidingWindowPolicy;

export interface TokenBucketState {
  algorithm: 'token-bucket';
  tokens: number;
  updatedAtMs: number;
}

export interface SlidingWindowState {
  algorithm: 'sliding-window';
  events: Array<{ atMs: number; cost: number }>;
  head: number;
  totalCost: number;
}

export type QuotaState = TokenBucketState | SlidingWindowState;
