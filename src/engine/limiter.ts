import { TokenBucketAlgorithm } from "../algorithms/token-bucket";
import { SlidingWindowLogAlgorithm } from "../algorithms/sliding-window-log";
import type { Algorithm } from "../algorithms/algorithm";
import { SystemClock, type Clock } from "../clock";
import { validateConfig } from "../config";
import { validateContext } from "../context";
import { buildKey } from "../extractors/keys";
import {
  ServiceError,
  type ServiceConfig,
  type RequestContext,
  type RateLimitResult,
} from "../models";
import { resolvePolicies } from "./policies";
import { TenantStore, type Entry } from "./store";

interface Counters {
  totalEvaluations: number;
  allowedCount: number;
  blockedCount: number;
  capacityRejectedCount: number;
}
export interface TenantMetrics extends Counters {
  tenantId: string;
  activeTrackedKeys: number;
  noisyNeighborsIsolated: number;
  currentMemoryEstimatedBytes: number;
}

export class RateLimiter {
  private readonly config: ServiceConfig;
  private readonly tenants = new Map<string, { store: TenantStore; counters: Counters }>();
  private readonly algorithms: Record<"token-bucket" | "sliding-window", Algorithm> = {
    "token-bucket": new TokenBucketAlgorithm(),
    "sliding-window": new SlidingWindowLogAlgorithm(),
  };
  private sweepTenant = 0;

  constructor(
    config: ServiceConfig,
    private readonly clock: Clock = new SystemClock(),
  ) {
    validateConfig(config);
    this.config = structuredClone(config);
    for (const tenant of this.config.tenants) {
      this.tenants.set(tenant.id, {
        store: new TenantStore(),
        counters: {
          totalEvaluations: 0,
          allowedCount: 0,
          blockedCount: 0,
          capacityRejectedCount: 0,
        },
      });
    }
  }

  check(context: RequestContext): RateLimitResult {
    validateContext(context);
    const policies = resolvePolicies(this.config, context);
    const cost = context.cost ?? 1;
    if (policies.some((policy) => cost > policy.capacity)) {
      throw new ServiceError(400, "IMPOSSIBLE_COST", "Cost exceeds an applicable policy capacity");
    }
    const tenant = this.tenant(context.tenantId);
    const now = this.clock.monotonicMs();
    // No await, I/O or externally supplied callback in this transaction.
    const previews = policies.map((policy) => {
      const key = buildKey(policy, context);
      const map = policy.scope === "tenant" ? tenant.store.aggregates : tenant.store.clients;
      const entry = map.get(key);
      return {
        policy,
        key,
        map,
        entry,
        preview: this.algorithms[policy.algorithm].preview(policy, entry?.state, cost, now),
      };
    });
    tenant.counters.totalEvaluations++;
    const denied = previews.filter((item) => !item.preview.allowed);
    let selected;
    if (denied.length) {
      selected = denied.reduce((a, b) =>
        (b.preview.retryAfterMs ?? 0) > (a.preview.retryAfterMs ?? 0) ? b : a,
      );
      tenant.counters.blockedCount++;
      if (
        previews
          .filter((item) => item.policy.scope === "tenant")
          .every((item) => item.preview.allowed)
      ) {
        for (const item of denied)
          if (item.entry && item.policy.scope === "client") item.entry.isolated = true;
      }
    } else {
      const allocations = previews.filter(
        (item) => item.policy.scope === "client" && !item.entry,
      ).length;
      const max = this.config.tenants.find((item) => item.id === context.tenantId)!.maxTrackedKeys;
      if (tenant.store.clients.size + allocations > max) {
        tenant.counters.capacityRejectedCount++;
        throw new ServiceError(503, "TRACKING_CAPACITY", "Tenant tracking capacity is full");
      }
      selected = previews.reduce((a, b) =>
        b.preview.remaining / b.policy.capacity < a.preview.remaining / a.policy.capacity ? b : a,
      );
      for (const item of previews) {
        item.map.set(item.key, {
          policy: item.policy,
          state: item.preview.commit(),
          isolated: item.entry?.isolated ?? false,
        });
      }
      tenant.counters.allowedCount++;
    }
    const { policy, preview } = selected;
    const resetAfterSeconds = Math.ceil(preview.fullResetAfterMs / 1000);
    return {
      allowed: denied.length === 0,
      policyId: policy.id,
      limit: policy.capacity,
      remaining: preview.remaining,
      resetAt: Math.ceil((this.clock.unixMs() + preview.fullResetAfterMs) / 1000),
      resetAfterSeconds,
      ...(denied.length
        ? {
            retryAfterSeconds: Math.max(1, Math.ceil(preview.retryAfterMs! / 1000)),
            reason:
              policy.scope === "tenant"
                ? ("TENANT_QUOTA_EXCEEDED" as const)
                : ("CLIENT_KEY_EXCEEDED" as const),
          }
        : {}),
    };
  }

  sweep(maxEntries: number): number {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100_000)
      throw new RangeError("Invalid sweep budget");
    const ids = this.config.tenants.map((tenant) => tenant.id);
    const now = this.clock.monotonicMs();
    let removed = 0;
    for (let i = 0; i < maxEntries; i++) {
      const store = this.tenant(ids[this.sweepTenant++ % ids.length]!).store;
      const pair = store.nextClient();
      if (!pair) continue;
      const [key, entry] = pair;
      if (this.algorithms[entry.policy.algorithm].canForget(entry.policy, entry.state, now)) {
        store.clients.delete(key);
        removed++;
      }
    }
    this.sweepTenant %= ids.length;
    return removed;
  }

  getMetrics(tenantId: string): TenantMetrics {
    const { store, counters } = this.tenant(tenantId);
    let noisyNeighborsIsolated = 0;
    for (const entry of store.clients.values()) if (entry.isolated) noisyNeighborsIsolated++;
    return {
      tenantId,
      ...counters,
      activeTrackedKeys: store.clients.size,
      noisyNeighborsIsolated,
      currentMemoryEstimatedBytes: store.estimatedBytes(),
    };
  }

  reset(tenantId: string, target?: { policyId: string; context: RequestContext }): number {
    const { store } = this.tenant(tenantId);
    if (!target) return store.clear();
    validateContext(target.context);
    if (target.context.tenantId !== tenantId)
      throw new ServiceError(400, "TENANT_MISMATCH", "Reset context must match tenant");
    const policy = this.config.tenants
      .find((tenant) => tenant.id === tenantId)!
      .policies.find((item) => item.id === target.policyId);
    if (!policy) throw new ServiceError(404, "UNKNOWN_POLICY", "Unknown policy");
    if (policy.scope !== "client")
      throw new ServiceError(400, "INVALID_RESET", "Use whole-tenant reset for tenant quotas");
    return Number(store.clients.delete(buildKey(policy, target.context)));
  }

  private tenant(id: string) {
    const tenant = this.tenants.get(id);
    if (!tenant) throw new ServiceError(404, "UNKNOWN_TENANT", "Unknown tenant");
    return tenant;
  }
}
