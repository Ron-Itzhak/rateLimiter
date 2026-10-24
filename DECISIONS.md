# Design decisions

## 1. Algorithm selection and trade-offs

The user selected token bucket and exact sliding window log. Both implement `Algorithm.preview` and `canForget`; a policy chooses the algorithm. Default tenant policy uses token bucket, default client policy uses the log. Combining different algorithms is a default configuration, not the source of fairness.

Token bucket allows a controlled burst and refills lazily using `min(capacity, tokens + elapsedSeconds * refillRate)`. State is constant-size per key. Fractional tokens are retained internally; only spendable integer units are reported. Retry waits for the requested deficit, whereas full reset waits for capacity to refill.

The sliding log stores accepted timestamps and integer costs in `(now-window, now]`. An event at the lower boundary has expired. It is exact rather than a weighted counter approximation. Expiration advances a queue head and adjusts the total. Successful commits compact when at least half the backing array is expired. Pruning is amortized over accepted events, but repeated denial and weighted retry scans can be O(capacity). This implementation prioritizes understandable correctness and bounds each policy's capacity to 10,000; it has not been benchmarked at 20,000 evaluations/second.

## 2. Hierarchy and noisy-neighbor behavior

All applicable tenant and client quotas are previewed before any successful state is committed. A failed client check cannot debit aggregate quota; a failed tenant check cannot debit a client. Tracking allocation is also checked in advance for all policies together. A tenant has its own maps and counters, never another tenant's pool.

Accepted abusive traffic still consumes tenant quota. Enough legitimate clients can exhaust a tenant. This is not reserved bandwidth, strict fairness scheduling or a starvation guarantee. User IDs distinguish authenticated users behind NAT; anonymous users sharing an IP also share a quota. IP fallback alone does not solve noisy neighbors.

On denial, the blocking policy with the longest retry determines all response quota fields; on allow, use the smallest remaining/capacity ratio. Stable policy ordering breaks ties. A single header set is a summary of a hierarchy, not its full representation.

## 3. Networking and trust

The internal REST caller supplies verified original request context. Do not confuse that client's IP with the backend's transport address. This demo has no caller authentication; bind locally and place behind trusted infrastructure before real deployment. Reset and metrics share this boundary.

The middleware helper derives socket/proxy IP separately. With no trusted proxies, forwarded headers are ignored. Otherwise, walk from the socket through X-Forwarded-For right-to-left, stopping at the first untrusted address. Spoofed entries farther left cannot replace it. IP parsing uses ipaddr.js plus Node's strict IP validation. IPv4-mapped IPv6 is normalized to IPv4; scoped IPv6 zone IDs are rejected. Native IPv6 is grouped by prefix, default /64, reducing cycling within a subnet but not across different subnets.

Composite keys are JSON tuples including tenant and policy IDs, with typed dimensions. This avoids delimiter collisions and user/IP ambiguity. Header keys use SHA-256 fingerprints instead of retaining raw authorization values. There is no JWT validation here: the trusted caller extracts verified user identity before constructing context.

## 4. Memory footprint calculations

State grows with configured tenants, client policy keys and retained events, not with all historical requests. Each tenant has at most K client entries across all client policies (default K=1,000), and at most 32 configured policies. Unknown tenants/policies cannot be created by traffic. Configuration permits at most 100 tenants, capacities up to 10,000 and at most 1,000 client entries per tenant. These are structural limits, not a promise every extreme configuration fits any machine; size deployments from the formula before increasing defaults.

Let T be tenants, P tenant-scope policies per tenant, C a log capacity, L the JavaScript key length, E retained log event objects, and K the tracked-client cap. The diagnostic estimate is:

```
per tenant base ≈ 256 bytes
per entry ≈ 256 bytes + 2L bytes + 64E bytes
total ≈ sum(tenant base + all client entries + materialized tenant entries)
```

The 256-byte entry allowance estimates Map/node/state/object bookkeeping; 2L estimates UTF-16 string storage; 64 bytes/event estimates timestamp/cost object plus array reference. These are explicit planning assumptions, not measured V8 object sizes. V8 version, alignment, string encoding, allocator slack, backing-array capacity and garbage collection vary. The metric excludes Express, code, policies, transient request/preview allocations, sockets and the rest of the process heap/RSS.

For token buckets E=0, so memory is O(TK) for similarly bounded keys. For a log, integer costs >=1 imply at most C active events. Partial head pruning/compaction can retain expired events: the backing queue has at most about 2C event objects after a successful commit, rather than just C. During compaction an old and new reference array may briefly coexist. Inactive entries preserve their bounded queue until safe reclamation; it cannot grow without accepted traffic.

Default example, assuming L=128 characters: 2 tenants × 1,000 clients × capacity 10 gives at most 20,000 active events. Using the conservative 20 retained events per entry yields:

```
entry estimate = 256 + 2×128 + 64×20 = 1,792 bytes
2,000 client entries = 3,584,000 bytes ≈ 3.42 MiB
plus tenant states, tenant bases and non-state process memory
```

Longer composite keys cost more: with up to four 256-character dimensions and JSON escaping, L can exceed 1,024. Input limits keep it bounded, but use actual key lengths for estimates. The runtime metric computes from actual retained event count and key length instead of assuming every entry is at its maximum.

`scripts/memory-profile.cjs` fills 2,000 logs with 10 unit-cost events each at a fixed clock instant. It increases only the aggregate capacity to 10,000 so tenant rejection does not prevent filling the client logs. It compares heapUsed after forced GC and emits the modeled estimate. It is a local diagnostic, not a bound or a throughput benchmark; repeat on the deployment runtime and leave heap headroom.

One local run on Node v25.2.0 (2026-10-24) retained 2,000 keys and 20,000 events: observed heap delta 1,811,592 bytes; modeled state 1,976,688 bytes. This fixture uses short keys and full logs without partial-expiry residue. Its measurements do not replace the conservative retained-event calculation above.

## 5. Eviction strategy

Access lazily computes current refill/expiration. Rejected previews do not rewrite existing state. A background timer scans 100 candidate slots per second across tenants round-robin; each slot processes at most one client entry. Per-tenant Map iterators avoid an unbounded historical key queue. With the default two full tenants, a sweep cycle is about 20 seconds. Expired entries may continue occupying a slot until visited; correctness does not depend on cleanup timing.

Only forget a token bucket when it would be completely full, or a sliding log when all events have expired. Removing active usage, including through ordinary LRU eviction, would restore quota too early. Empty client maps and whole-tenant resets release their sweep cursor. Timer is stopped on shutdown and server errors. There is one timer, not one timer per key.

When all required new entries cannot fit, return 503 TRACKING_CAPACITY and consume nothing. Existing clients continue normal quota checks. No eviction of active clients is performed. Tenant aggregate entries are kept separately and are materialized on first successful use; this is equivalent to preallocating a full bucket without allocating unused states.

## 6. Concurrency and time

Within one Node process, synchronous preview/allocation/commit completes before another event-loop callback can interleave. There is no await or I/O in that section. Algorithm previews return a one-use commit closure. The engine does not expose these previews or permit external mutation of its copied startup configuration.

This does not synchronize worker threads, cluster processes or replicas. Run one instance for authoritative quota enforcement. Supporting shared storage later needs a true atomic multi-policy operation, such as carefully designed Redis scripting, not just swapping a Map adapter.

Use monotonic performance.now for quota durations and Date.now only to serialize Unix timestamps. Tests inject a fake clock. NTP/wall-clock adjustments do not replenish quota; external absolute reset timestamps can change with wall time. A refill timer would add drift and per-key overhead, so refill is calculated on access.

## 7. HTTP and operational choices

Quota denials use 429 with Retry-After seconds rounded up; resource exhaustion/internal failures use 503 without an invented recovery promise. Impossible costs are 400 rather than a perpetual 429. Reset clears quota state; cumulative operational counters remain. `noisyNeighborsIsolated` counts currently retained policy-key entries that have been client-blocked while tenant quota could admit; it is not an unbounded historical distinct-user counter, and multiple policy keys can represent one person.

Legacy X-RateLimit headers match the assignment, with reset defined as full recovery Unix seconds. [IETF draft-11](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/11/) currently describes RateLimit and RateLimit-Policy; supplemental fields follow that draft syntax and are not labeled a published RFC. The policy field omits window metadata to avoid advertising continuous token refill as a fixed window. [HTTP Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after) uses delay-seconds on 429.

On denial, omit the optional supplemental `t` parameter: full recovery can occur after the earliest valid Retry-After, so advertising both would conflict with the draft's timing recommendation. Legacy reset retains full-recovery semantics. IPv4-mapped trusted proxy CIDRs normalize alongside mapped peers; mapped prefixes below /96 are rejected as ambiguous for IPv4 trust.

## 8. With more time

Add authenticated administrative access, stronger process-wide memory budgeting with measured deployment headroom, bounded metrics collection, distributed atomicity, fair scheduling, optional priority shedding, benchmark/latency profiles and live policy versioning/reset semantics. Fail-open configuration is deferred; unexpected failures currently fail closed. No Docker run or throughput target is claimed without execution evidence.
