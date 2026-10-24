import type { AlgorithmPolicy, QuotaState, TokenBucketPolicy, TokenBucketState } from '../models';
import type { Algorithm, QuotaPreview } from './algorithm';

export class TokenBucketAlgorithm implements Algorithm {
  preview(policy: AlgorithmPolicy, state: QuotaState | undefined,
    cost: number, nowMs: number): QuotaPreview {
    this.validate(policy, state, nowMs);
    if (!Number.isSafeInteger(cost) || cost <= 0 || cost > policy.capacity) {
      throw new RangeError('Cost must be a positive integer no greater than capacity');
    }

    const available = this.available(policy, state, nowMs);
    const allowed = available >= cost;
    const tokens = allowed ? available - cost : available;
    let committed = false;

    return {
      allowed,
      // Keep fractional tokens internally; expose only spendable whole units.
      remaining: Math.floor(tokens),
      fullResetAfterMs: (policy.capacity - tokens) / policy.refillRatePerSecond * 1000,
      ...(allowed ? {} : {
        retryAfterMs: (cost - available) / policy.refillRatePerSecond * 1000,
      }),
      commit: (): TokenBucketState => {
        if (!allowed || committed) throw new Error('Preview cannot be committed');
        committed = true;
        return { algorithm: 'token-bucket', tokens, updatedAtMs: nowMs };
      },
    };
  }

  canForget(policy: AlgorithmPolicy, state: QuotaState, nowMs: number): boolean {
    this.validate(policy, state, nowMs);
    return this.available(policy, state, nowMs) >= policy.capacity;
  }

  private available(policy: TokenBucketPolicy, state: QuotaState | undefined, nowMs: number): number {
    if (!state) return policy.capacity;
    if (state.algorithm !== 'token-bucket') throw new TypeError('Incorrect state algorithm');
    const refill = (nowMs - state.updatedAtMs) / 1000 * policy.refillRatePerSecond;
    return Math.min(policy.capacity, state.tokens + refill);
  }

  private validate(policy: AlgorithmPolicy, state: QuotaState | undefined,
    nowMs: number): asserts policy is TokenBucketPolicy {
    if (policy.algorithm !== 'token-bucket' || (state && state.algorithm !== 'token-bucket')) {
      throw new TypeError('Incorrect policy or state algorithm');
    }
    if (!Number.isSafeInteger(policy.capacity) || policy.capacity <= 0 ||
        !Number.isFinite(policy.refillRatePerSecond) || policy.refillRatePerSecond <= 0) {
      throw new RangeError('Capacity and refill rate must be positive and finite');
    }
    if (!Number.isFinite(nowMs) || nowMs < 0 ||
        (state && nowMs < state.updatedAtMs)) {
      throw new RangeError('Time must be finite, nonnegative and monotonic');
    }
  }
}
