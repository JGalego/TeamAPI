import type { FastifyInstance } from "fastify";
import { searchOrg, semanticSearchOrg } from "@jgalego/teamapi-core";
import { errorResponseSchema } from "../schemas/error";
import { MAX_LIMIT, pageQuerySchema, paginate, type PageQuery } from "../pagination";

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: PageQuery & { q?: string; mode?: "lexical" | "hybrid" | "semantic" } }>(
    "/search",
    {
      schema: {
        tags: ["Search"],
        summary: "Search the org",
        description:
          "Unified search across team names/focus, services, roles, members, search terms, and every AI-native " +
          "resource domain (agents, memory, specifications, steering documents, prompts, playbooks, policies, " +
          "knowledge base, workflows, sessions). Substring matching by default; `mode=hybrid` or " +
          "`mode=semantic` additionally ranks by embedding similarity, and requires the server to " +
          "have been started with an embedding model.",
        querystring: {
          type: "object",
          properties: {
            q: { type: "string", description: "Search query" },
            mode: {
              type: "string",
              enum: ["lexical", "hybrid", "semantic"],
              description:
                "lexical (default) is substring matching. hybrid unions it with embedding similarity; " +
                "semantic uses similarity alone. Both need an embedding model on the server.",
              default: "lexical",
            },
            ...pageQuerySchema,
          },
        },
        response: { 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      // `q` is intentionally not `required` in the querystring schema above: that would make
      // Fastify's AJV validation reject a missing `q` before this handler runs, with a different
      // (less friendly, AJV-generated) error body than the one below — so both "absent" and
      // "present but empty" land on the same, single error message here.
      if (!req.query.q) return reply.code(400).send({ error: "Missing required query parameter 'q'" });
      const mode = req.query.mode ?? "lexical";
      if (mode === "lexical") {
        return paginate(searchOrg(app.orgGraphStore.current, req.query.q), req.query, req, reply);
      }
      if (!app.embeddings) {
        // A 400 naming the flag, rather than silently falling back to substring matching: a caller
        // who asked for semantic search and got lexical results has no way to tell.
        return reply
          .code(400)
          .send({ error: `mode='${mode}' requires an embedding model; start the server with --embeddings` });
      }
      const results = await semanticSearchOrg(app.orgGraphStore.current, req.query.q, {
        embeddings: app.embeddings,
        mode,
        // Paginated afterwards, so the ceiling here has to be at least one page.
        limit: (req.query.offset ?? 0) + (req.query.limit ?? MAX_LIMIT),
      });
      return paginate(results, req.query, req, reply);
    },
  );
}
