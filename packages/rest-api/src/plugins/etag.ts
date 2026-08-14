import * as crypto from "node:crypto";
import type { FastifyInstance } from "fastify";

/** 128 bits of SHA-256, base64url. Long enough that a collision is not a thing that happens, short
 * enough that the header stays readable in a log or a curl transcript. */
function strongEtag(payload: string | Buffer): string {
  const digest = crypto.createHash("sha256").update(payload).digest("base64url").slice(0, 22);
  return `"${digest}"`;
}

/** Whether any entry in an `If-None-Match` header matches. The header is a comma-separated list,
 * and `*` matches any existing representation (RFC 9110 §13.1.2). */
export function ifNoneMatchSatisfied(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || candidate === etag || candidate === `W/${etag}`);
}

/**
 * Content-derived `ETag` on every successful GET, and a 304 when the client already has it.
 *
 * Derived from the response body rather than from the graph's `resolvedAt`, and that is the whole
 * design. `resolvedAt` changes on every reload — every `--watch` trigger, every `POST /reload`,
 * every SIGHUP — including the overwhelmingly common reload where a document was touched and
 * nothing a given endpoint returns actually changed. A timestamp validator would invalidate every
 * client's cache on every reload, which is the same as having no validator. Hashing the body means
 * the org graph can be re-resolved a hundred times and `/teams` keeps the same ETag until `/teams`
 * genuinely differs.
 *
 * What this saves is the network, not the computation: the payload is still built before it is
 * hashed. That is the right trade here — building it is pure in-memory work over an already
 * resolved graph, while `/graph` on a large org is megabytes over the wire, repeatedly, to
 * dashboards and CI jobs polling for changes.
 *
 * Registered as an `onSend` hook rather than per route, so a route added later is covered by
 * existing rather than by remembering.
 */
export function registerEtag(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method !== "GET" && request.method !== "HEAD") return payload;
    if (reply.statusCode !== 200) return payload;
    if (typeof payload !== "string" && !Buffer.isBuffer(payload)) return payload;

    const etag = strongEtag(payload);
    void reply.header("ETag", etag);

    if (ifNoneMatchSatisfied(request.headers["if-none-match"], etag)) {
      // An empty payload, not the real one: a 304 carries no body. Fastify recomputes
      // `Content-Length` from what this hook returns, so the header follows rather than being left
      // behind promising bytes that never arrive.
      void reply.code(304);
      return "";
    }
    return payload;
  });
}
