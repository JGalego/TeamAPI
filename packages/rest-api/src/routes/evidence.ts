import type { FastifyInstance } from "fastify";
import { EvidenceKindSchema, type EvidenceChain, type EvidenceLedger } from "@jgalego/teamapi-core";
import { errorResponseSchema } from "../schemas/error";

export interface EvidenceRouteOptions {
  ledger: EvidenceLedger;
}

export async function evidenceRoutes(app: FastifyInstance, options: EvidenceRouteOptions): Promise<void> {
  app.get<{ Querystring: { targetId?: string; kind?: string; source?: string } }>(
    "/evidence",
    {
      schema: {
        tags: ["Evidence"],
        summary: "List ingested organizational evidence",
        querystring: {
          type: "object",
          properties: {
            targetId: { type: "string" },
            kind: { type: "string", enum: EvidenceKindSchema.options },
            source: { type: "string" },
          },
        },
      },
    },
    async (req) => options.ledger.list({ ...req.query, kind: req.query.kind as never }),
  );

  app.post<{ Body: unknown }>(
    "/evidence",
    {
      schema: {
        tags: ["Evidence"],
        summary: "Ingest an immutable evidence entry",
        response: { 400: errorResponseSchema, 409: errorResponseSchema },
      },
    },
    async (req, reply) => {
      try {
        const result = options.ledger.ingest(req.body);
        return await reply.code(result.created ? 201 : 200).send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(message.includes("different content") ? 409 : 400).send({ error: message });
      }
    },
  );

  app.get<{ Querystring: { targetId?: string } }>(
    "/evidence/chains",
    { schema: { tags: ["Evidence"], summary: "List finding-to-outcome evidence chains" } },
    async (req) => options.ledger.chains(req.query.targetId),
  );

  app.post<{ Body: EvidenceChain }>(
    "/evidence/chains",
    {
      schema: {
        tags: ["Evidence"],
        summary: "Link a finding and outcome to supporting evidence",
        response: { 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      try {
        return await reply.code(201).send(options.ledger.link(req.body));
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );
}
