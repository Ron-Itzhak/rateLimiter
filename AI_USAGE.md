# AI tool usage

## Tools used

OpenAI Codex with the Superpowers skills for design discussion, planning, tests and review. The human chose in-memory operation, both algorithms, sliding window log, a small layered architecture, trusted-user/IP identity, mixed default hierarchy, tracking-cap rejection and a trusted internal API boundary. The human approved the design and plan. Codex wrote the implementation and tests.

## What helped most

- Separating noisy-neighbor protection (hierarchical all-or-nothing quota consumption) from IP fallback and algorithm selection.
- Expressing time-dependent algorithms using a controllable clock so expiry, refill and retry could be tested without sleeps.
- Identifying safe eviction conditions and documenting an explicit memory model instead of treating a Map as inherently bounded.

## What needed correction or qualification

- The initial HTTP test run could not connect to localhost because of sandbox EACCES. Re-running with network permission passed without changing application logic; this was an environment failure, not an algorithm fix.
- The first npm installation attempt could not reach the registry in the sandbox. An approved retry installed the explicit IP parsing dependency.
- Current RateLimit fields were verified against the IETF draft rather than claiming legacy X-RateLimit headers are RFC-standard. A separate RFC number initially inspected was unrelated and is not cited as support.
- Core behavior tests were written before implementation and first failed on missing modules. Some additional contract/middleware tests were added after implementation; they are coverage checks, not claimed red-green proof.

## Limitations of AI assistance

An independent review found two compatibility issues in generated code: mapped IPv4 proxy CIDRs were not normalized like peers, and a supplemental draft header advertised a full-reset time inconsistent with earlier Retry-After. Regression tests reproduced both before fixes. The reviewer also suggested additional coverage; tracking-admission and later-client-denial assertions were added. Direct timer-leak detection and more engine-level clock/partial-compaction cases remain test improvements.

Passing tests does not prove production memory usage, fairness under all workloads, or distributed correctness. Memory byte counts are labeled assumptions and supplemented by a local diagnostic. Docker execution requires a future installed runtime. The human should review the algorithms and transaction flow and be able to explain the decisions; generated code is not a substitute for that understanding.
