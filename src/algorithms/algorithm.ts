import type { AlgorithmPolicy, QuotaState } from '../models';

export interface QuotaPreview {
  allowed: boolean;
  remaining: number;
  fullResetAfterMs: number;
  retryAfterMs?: number;
  /** Call once, synchronously, only after every applicable policy admits. */
  commit(): QuotaState;
}

export interface Algorithm {
  preview(policy: AlgorithmPolicy, state: QuotaState | undefined,
    cost: number, nowMs: number): QuotaPreview;
  canForget(policy: AlgorithmPolicy, state: QuotaState, nowMs: number): boolean;
}
