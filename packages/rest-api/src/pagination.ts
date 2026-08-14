import type { FastifyReply, FastifyRequest } from "fastify";

export interface PageQuery {
  limit?: number;
  offset?: number;
}

/** The highest `limit` a client may ask for. Beyond this the request is answered with the maximum
 * rather than rejected: a caller asking for everything wants everything, and a 400 would send them
 * to write the same loop with a smaller number. */
export const MAX_LIMIT = 1000;

/** The querystring fragment every paginated route declares, so the OpenAPI page documents the two
 * parameters identically everywhere rather than once per route with three different descriptions. */
export const pageQuerySchema = {
  limit: {
    type: "integer",
    minimum: 1,
    maximum: MAX_LIMIT,
    description: `Maximum items to return (max ${MAX_LIMIT}). Omitted returns everything.`,
  },
  offset: { type: "integer", minimum: 0, description: "Items to skip. Requires nothing else; defaults to 0." },
} as const;

function buildLink(request: FastifyRequest, offset: number, limit: number, rel: string): string {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));
  // Path plus query only. An absolute URL here would bake in whatever Host header arrived, which
  // behind a proxy is routinely the internal name and sends the client somewhere it cannot reach.
  return `<${url.pathname}${url.search}>; rel="${rel}"`;
}

/**
 * Slices a collection and describes the slice in headers.
 *
 * Headers rather than an envelope, and deliberately. Wrapping every list in
 * `{ items, total, next }` would break every existing consumer of this API — the dashboard, the
 * generators, anyone's script — on the day pagination shipped, in exchange for information that
 * `X-Total-Count` and RFC 8288 `Link` already convey. The body stays an array; a client that never
 * passes `limit` sees exactly what it saw before.
 *
 * Unpaginated by default for the same reason: a default page size is a silent truncation, and a
 * caller who wrote `GET /teams` last month and reads 100 of their 400 teams this month has no way
 * to notice. Asking for a page is how you get a page.
 */
export function paginate<T>(items: T[], query: PageQuery, request: FastifyRequest, reply: FastifyReply): T[] {
  const total = items.length;
  void reply.header("X-Total-Count", String(total));

  const offset = Math.max(0, query.offset ?? 0);
  if (query.limit === undefined && offset === 0) return items;

  const limit = Math.min(query.limit ?? MAX_LIMIT, MAX_LIMIT);
  const page = items.slice(offset, offset + limit);

  const links: string[] = [buildLink(request, 0, limit, "first")];
  if (offset + limit < total) links.push(buildLink(request, offset + limit, limit, "next"));
  if (offset > 0) links.push(buildLink(request, Math.max(0, offset - limit), limit, "prev"));
  // `last` is the offset of the final page, not of the final item — landing a client mid-page.
  if (total > 0) links.push(buildLink(request, Math.floor((total - 1) / limit) * limit, limit, "last"));

  void reply.header("Link", links.join(", "));
  return page;
}
