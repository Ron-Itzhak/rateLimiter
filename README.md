# In-memory multi-tenant rate limiter

Express and strict TypeScript, with token bucket and exact sliding window log policies. One Node process owns all quota state. No database, Redis or Docker installation is required for local development.

## Run locally

```sh
npm ci
npm test
npm run typecheck
npm run build
npm start
# Or: npm run dev
```

The server listens on `127.0.0.1:3000` by default. `PORT` and `HOST` override this. The initial implementation was tested on Node 25.2.0. Source targets Node 20+, while the supplied container uses Node 24; those other runtimes have not been executed here.

## Startup configuration

Edit `src/config.ts`, then restart. It creates two independent tenants: `org-acme-prod` and `org-beta-prod`. Each has:

| Policy | Algorithm | Quota |
|---|---|---|
| `tenant` | Token bucket | 100 tokens, refill 10/second |
| `client` | Sliding window log | 10 units per rolling 60 seconds |

Client identity uses trusted user ID when present, otherwise IP (IPv6 /64). Each tenant tracks at most 1,000 client policy keys. A request must pass all matching policies before any quota is consumed. Costs are positive integers, default 1; a cost larger than any applicable capacity is a 400 validation error.

Either algorithm works at either scope. Set `algorithm: 'token-bucket'` plus `refillRatePerSecond`, or `algorithm: 'sliding-window'` plus `windowSizeSeconds`. Additional client policies can match an exact `route` and optional uppercase `method`. Explicit `keyStrategy.dimensions` supports `ip`, `userId`, `route` (includes method), and `header` with `headerName`. Explicit dimensions do not silently fall back. `fallbackUserToIp: true` is the distinct default strategy and cannot be combined with dimensions.

Tenant and client baseline policies are required. Configuration is validated and copied on construction. Policies are selected dynamically per request but cannot be modified through an API in this version. Restarting clears all state and metrics.

## Try the API

These are POSIX shell examples; in PowerShell use `Invoke-RestMethod` with the same JSON body or save the body to a file and use `curl.exe --data-binary @request.json`.

```sh
curl -i http://localhost:3000/v1/rate-limit/check \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"org-acme-prod","clientIp":"2001:db8:1:2::1","userId":"alice","route":"/checkout","method":"POST","headers":{},"cost":10}'
```

The first call consumes Alice's quota; repeating immediately returns 429. Changing `userId` to `bob` succeeds while tenant capacity remains. Omit `userId` to test shared-IP fallback. Both example IPv6 addresses `2001:db8:1:2::1` and `2001:db8:1:2::abcd` share the anonymous /64 quota.

```sh
curl http://localhost:3000/v1/tenants/org-acme-prod/metrics
curl -X POST http://localhost:3000/v1/tenants/org-acme-prod/reset \
  -H 'Content-Type: application/json' -d '{}'
curl http://localhost:3000/health
```

To reset only one client policy key, post `{"policyId":"client","context":{...}}` with a full context like the check example. It clears that key only, leaving aggregate usage and cumulative metrics unchanged. Whole-tenant reset clears quotas for that tenant only.

Responses: 200 allowed, 429 quota exhausted, 400 invalid context/cost, 404 unknown tenant/policy, 413 body larger than 16 KiB, 503 tracking capacity or internal failure. At tracking capacity, existing clients still work; new identities must wait for cleanup. No arbitrary retry duration is claimed for capacity exhaustion.

`X-RateLimit-*` reports one selected policy consistently; reset is Unix seconds until full recovery expressed as an absolute timestamp. `Retry-After` on quota denial is seconds until enough quota for this request, rounded up. The two times may differ. Supplemental `RateLimit` and `RateLimit-Policy` use the [IETF draft-11 syntax](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/11/), not a claimed published RFC standard. Only quota is advertised in policy metadata; no fixed-window semantics are implied for a token bucket.

## Trust boundary and middleware

The check/reset/metrics API is an internal demonstration service without authentication. Only trusted backends should call it. Its body describes the original request; the caller's socket IP is not substituted. Do not expose this directly to untrusted clients, who could invent tenant/user IDs or reset quotas.

`createRateLimitMiddleware` runs after your existing authentication and accepts a synchronous callback that builds trusted context. For example:

```ts
app.use(createRateLimitMiddleware(limiter, req => ({
  tenantId: 'org-acme-prod', // Obtain from your authenticated tenant mapping.
  clientIp: resolveClientIp(req.socket.remoteAddress!, req.get('x-forwarded-for'), []),
  route: req.path,
  method: req.method,
  headers: req.headers,
  // userId: obtain from your authentication layer, never a raw client header.
})));
```

Import these helpers from `src/http/middleware.ts` and `src/extractors/proxy.ts`. Empty trusted CIDRs ignores all forwarded headers. Configure only proxies you control; chain resolution walks right-to-left to the first untrusted hop. For route quotas, supply a stable route template where possible instead of a high-cardinality raw URL. The 256-character key limit and tracking cap bound stored key data.

## Docker later

```sh
docker compose up --build
```

Compose runs only this server, publishes port 3000 on loopback, and has no service dependencies. There is no shared state between multiple containers. Docker files have been inspected but not executed because Docker is not installed here.

## Learning and diagnostics

Read in order: `src/algorithms/token-bucket.ts`, `sliding-window-log.ts`, `src/extractors/keys.ts`, then `src/engine/limiter.ts`. Tests use a fake monotonic clock rather than real waits. They cover quota boundaries, weighted cost, hierarchy rollback, tenant isolation, proxy trust, IPv6, cleanup, capacity admission, HTTP and middleware.

See [DECISIONS.md](DECISIONS.md) for memory calculations and eviction rules, and [AI_USAGE.md](AI_USAGE.md) for how this was built. Run `npm run build` then `node --expose-gc scripts/memory-profile.cjs` for a repeatable memory diagnostic.

Deferred: live policy updates, distributed storage, configurable fail-open behavior, priority shedding, Prometheus, and a throughput benchmark. Priority values are validated but do not change admission. Unexpected errors fail closed. No throughput target or production authentication claim is made.
