import * as crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * Bearer-token authentication for the whole API.
 *
 * Opt-in: with no token configured the server behaves exactly as it always has, because the
 * overwhelmingly common case is `teamapi serve-api` on a laptop against a local checkout, and
 * making that require a credential would be friction with nothing behind it. The safety property
 * that matters is enforced one level up, in the CLI: binding a non-loopback address without a
 * token is refused outright, so "reachable by other machines" and "unauthenticated" cannot be
 * true at the same time by accident.
 *
 * Routes exempted from the check, and why:
 *
 * - `/health` — liveness probes come from load balancers and orchestrators that have no way to
 *   carry a token, and the response ("ok") discloses nothing that isn't already implied by the
 *   port accepting a connection.
 * - `/slack/*` — Slack authenticates itself with an HMAC over the request body, which is strictly
 *   stronger than a shared bearer token, and Slack cannot be configured to send an `Authorization`
 *   header. Requiring both would mean the route could never be called.
 */
export interface AuthOptions {
  /** When set, every route outside the exempt list requires `Authorization: Bearer <token>`. */
  token?: string;
}

const EXEMPT_PREFIXES = ["/health", "/slack/"];

function isExempt(url: string): boolean {
  // `url` carries the query string; compare against the path alone so `/health?probe=1` is still
  // recognised as the liveness endpoint.
  const path = url.split("?")[0]!;
  return EXEMPT_PREFIXES.some((prefix) => (prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix));
}

/** Reads a bearer token out of an `Authorization` header, if it is well-formed. */
export function bearerToken(request: Pick<FastifyRequest, "headers">): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string") return undefined;
  const match = /^Bearer (.+)$/i.exec(header.trim());
  return match?.[1];
}

/**
 * Constant-time comparison, for the same reason the Slack route does it: a fast reject on the
 * first differing byte turns a secret into something guessable one character at a time.
 * `timingSafeEqual` requires equal lengths, so the length check has to come first and is
 * deliberately the only thing that short-circuits.
 */
export function tokenMatches(expected: string, presented: string | undefined): boolean {
  if (presented === undefined) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Auth runs at `preParsing`, not `onRequest`, and the reason is the rate limiter.
 *
 * `@fastify/rate-limit` attaches its counter as a *route-level* `onRequest` hook (via `onRoute`),
 * and Fastify runs every instance-level `onRequest` hook before any route-level one. An auth hook
 * at `onRequest` would therefore answer 401 before the limiter ever counted the request — leaving
 * failed authentication, the one thing a limiter is most needed for here, completely uncounted and
 * a token guessable at whatever rate the network allows. `preParsing` is the earliest stage that
 * runs after route-level `onRequest`, so the limiter sees and counts every rejected attempt.
 *
 * It still runs before the body is parsed, so no unauthenticated request ever reaches a parser,
 * and Fastify runs this stage for its not-found handler too — so unknown paths are answered 401
 * like everything else, and route existence stays invisible without a token.
 */
export function registerAuth(app: FastifyInstance, options: AuthOptions): void {
  const { token } = options;
  if (!token) return;

  app.addHook("preParsing", async (request, reply) => {
    if (isExempt(request.url)) return;
    if (tokenMatches(token, bearerToken(request))) return;

    // `WWW-Authenticate` so a client knows which scheme to retry with, and a body that names the
    // scheme but never echoes what was presented — an error message that reflects the attempted
    // credential back into logs is how tokens end up in log aggregators.
    await reply
      .code(401)
      .header("WWW-Authenticate", 'Bearer realm="teamapi"')
      .send({ error: "Unauthorized", message: "This API requires a bearer token." });
  });
}
