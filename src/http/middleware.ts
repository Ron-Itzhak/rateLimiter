import type { Request, RequestHandler } from 'express';
import type { RateLimiter } from '../engine/limiter';
import type { RequestContext } from '../models';
import { makeRateLimitHeaders } from './headers';

/** Run after authentication; the callback must supply trusted identity/tenant context. */
export function createRateLimitMiddleware(limiter: RateLimiter,
  trustedContextFactory: (request: Request) => RequestContext): RequestHandler {
  return (req, res, next) => {
    try {
      const result = limiter.check(trustedContextFactory(req));
      res.set(makeRateLimitHeaders(result));
      if (!result.allowed) { res.status(429).json(result); return; }
      next();
    } catch (error) { next(error); }
  };
}
