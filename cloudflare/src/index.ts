import { Container } from "@cloudflare/containers";
import { Hono } from "hono";
import { fail, IMMUTABLE, securityHeaders } from "../../src/server/http.ts";

interface Env {
  readonly ASSETS: Fetcher;
  readonly CHECKER: DurableObjectNamespace<CheckerContainer>;
  readonly CHANGE_LIMITER: RateLimit;
  readonly DATABASE_URL: string;
}

const CHECKER_NAME = "checker";
const CHECKER_LOCATION: DurableObjectLocationHint = "wnam";
const TOO_MANY_CHANGES = "Too many requests from this address. Wait a minute and try again.";
const CHECKER_UNAVAILABLE = "The checker is starting or unavailable. Try again in a minute.";
const READ_METHODS = new Set(["GET", "HEAD"]);

type ContainerState = ConstructorParameters<typeof Container>[0];

export class CheckerContainer extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = "20m";

  constructor(ctx: ContainerState, env: Env) {
    super(ctx, env);
    this.envVars = { DATABASE_URL: env.DATABASE_URL };
  }
}

const app = new Hono<{ Bindings: Env }>();

app.use(securityHeaders());
app.use("/api/*", async (c, next) => {
  if (!READ_METHODS.has(c.req.method)) {
    const key = c.req.header("cf-connecting-ip") ?? "unknown";
    const { success } = await c.env.CHANGE_LIMITER.limit({ key });
    if (!success) {
      return fail(c, 429, TOO_MANY_CHANGES);
    }
  }
  return next();
});
app.all("/api/*", (c) => forwardToChecker(c.env, c.req.raw));
app.all("/samples/*", (c) => forwardToChecker(c.env, c.req.raw));
app.get("*", async (c) => {
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  const response = new Response(asset.body, asset);
  if (new URL(c.req.url).pathname.startsWith("/assets/") && response.ok) {
    response.headers.set("Cache-Control", IMMUTABLE);
  }
  return response;
});

app.onError((error, c) => {
  console.error(error);
  return fail(c, 503, CHECKER_UNAVAILABLE);
});

async function forwardToChecker(env: Env, request: Request): Promise<Response> {
  const checker = env.CHECKER.get(env.CHECKER.idFromName(CHECKER_NAME), {
    locationHint: CHECKER_LOCATION,
  });
  const response = await checker.fetch(request);
  return new Response(response.body, response);
}

export default app;
