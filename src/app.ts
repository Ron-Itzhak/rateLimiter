import express, { type ErrorRequestHandler } from 'express';
import type { RateLimiter } from './engine/limiter';
import { validateContext } from './context';
import { ServiceError } from './models';
import { makeRateLimitHeaders } from './http/headers';

export function createApp(limiter: RateLimiter): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.get('/', (_req, res) => { res.json({ message: 'Server is running!' }); });
  app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });
  app.post('/v1/rate-limit/check', (req, res) => {
    validateContext(req.body);
    const result = limiter.check(req.body);
    res.set(makeRateLimitHeaders(result)).status(result.allowed ? 200 : 429).json(result);
  });
  app.get('/v1/tenants/:tenantId/metrics', (req, res) => {
    res.set('Cache-Control', 'no-store').json(limiter.getMetrics(req.params.tenantId as string));
  });
  app.post('/v1/tenants/:tenantId/reset', (req, res) => {
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ServiceError(400, 'INVALID_RESET', 'Expected an object');
    const value = body as Record<string, unknown>;
    if (Object.keys(value).some(key => key !== 'policyId' && key !== 'context')) throw new ServiceError(400, 'INVALID_RESET', 'Unknown reset field');
    let count: number;
    if (value.policyId === undefined && value.context === undefined) {
      count = limiter.reset(req.params.tenantId as string);
    } else {
      if (typeof value.policyId !== 'string') throw new ServiceError(400, 'INVALID_RESET', 'Expected policyId and context');
      validateContext(value.context);
      count = limiter.reset(req.params.tenantId as string, { policyId: value.policyId, context: value.context });
    }
    res.set('Cache-Control', 'no-store').json({ resetEntries: count });
  });
  app.use((_req, res) => { res.status(404).json({ error: 'NOT_FOUND' }); });
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    res.set('Cache-Control', 'no-store');
    if (error instanceof ServiceError) { res.status(error.status).json({ error: error.code, message: error.message }); return; }
    const parserError = error as { type?: string } | null;
    if (parserError?.type === 'entity.too.large') { res.status(413).json({ error: 'BODY_TOO_LARGE' }); return; }
    if (parserError?.type === 'entity.parse.failed') { res.status(400).json({ error: 'INVALID_JSON' }); return; }
    res.status(503).json({ error: 'INTERNAL_FAILURE' });
  };
  app.use(errorHandler);
  return app;
}
