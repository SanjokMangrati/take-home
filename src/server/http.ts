import type { Context, MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorResponse } from "../shared/errors.ts";

export const IMMUTABLE = "public, max-age=31536000, immutable";

export function securityHeaders(): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'"],
      connectSrc: ["'self'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'none'"],
    },
  });
}

export function fail(c: Context, status: ContentfulStatusCode, message: string): Response {
  const body: ErrorResponse = { error: message };
  return c.json(body, status);
}
