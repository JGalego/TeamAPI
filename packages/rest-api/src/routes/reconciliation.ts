import type { FastifyInstance } from "fastify";
import {
  gateReconciliationPlan,
  type EvidenceLedger,
  type ReconciliationAction,
  type ReconciliationGatePolicy,
} from "@jgalego/teamapi-core";
import { errorResponseSchema } from "../schemas/error";

export interface ReconciliationRouteOptions {
  ledger: EvidenceLedger;
  policy: ReconciliationGatePolicy;
}

export async function reconciliationRoutes(app: FastifyInstance, options: ReconciliationRouteOptions): Promise<void> {
  app.post<{ Body: { actions: ReconciliationAction[] } }>(
    "/reconciliation/evaluate",
    {
      schema: {
        tags: ["Reconciliation"],
        summary: "Evaluate external-system changes against evidence and policy gates",
        description: "Returns approval decisions only. This endpoint never executes the proposed actions.",
        body: {
          type: "object",
          required: ["actions"],
          properties: { actions: { type: "array", items: { type: "object" } } },
        },
        response: { 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      try {
        return gateReconciliationPlan(app.orgGraphStore.current, options.ledger, req.body.actions, options.policy);
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );
}
