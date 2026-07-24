import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/health",
    { schema: { tags: ["Health"], summary: "Liveness check" } },
    async () => ({ status: "ok" }),
  );
}
