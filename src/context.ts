import { ServiceError, type RequestContext } from "./models";
import { normalizeIp } from "./extractors/ip";

export function validateContext(input: unknown): asserts input is RequestContext {
  const fail = () => {
    throw new ServiceError(400, "INVALID_CONTEXT", "Invalid request context");
  };
  if (!input || typeof input !== "object" || Array.isArray(input)) fail();
  const value = input as Record<string, unknown>;
  for (const name of ["tenantId", "clientIp", "route", "method"]) {
    if (
      typeof value[name] !== "string" ||
      !(value[name] as string).length ||
      (value[name] as string).length > 256
    )
      fail();
  }
  if (!(value.route as string).startsWith("/") || !/^[A-Z]{1,20}$/.test(value.method as string))
    fail();
  if (
    value.userId !== undefined &&
    (typeof value.userId !== "string" || !value.userId.length || value.userId.length > 256)
  )
    fail();
  if (
    value.cost !== undefined &&
    (!Number.isSafeInteger(value.cost) || (value.cost as number) <= 0)
  )
    fail();
  if (
    value.priority !== undefined &&
    !["critical", "standard", "background"].includes(value.priority as string)
  )
    fail();
  if (!value.headers || typeof value.headers !== "object" || Array.isArray(value.headers)) fail();
  const headers = Object.entries(value.headers as Record<string, unknown>);
  if (headers.length > 32) fail();
  const seen = new Set<string>();
  for (const [key, val] of headers) {
    if (!/^[!#$%&'*+.^_`|~0-9a-zA-Z-]{1,64}$/.test(key) || seen.has(key.toLowerCase())) fail();
    seen.add(key.toLowerCase());
    if (val === undefined) continue;
    const values = Array.isArray(val) ? val : [val];
    if (values.length > 8 || values.some((item) => typeof item !== "string" || item.length > 256))
      fail();
  }
  normalizeIp(value.clientIp as string);
}
