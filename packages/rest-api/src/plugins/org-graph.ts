import type { FastifyInstance } from "fastify";
import type { EmbeddingProvider, OrgGraphStore } from "@jgalego/teamapi-core";

declare module "fastify" {
  interface FastifyInstance {
    orgGraphStore: OrgGraphStore;
    /** Present only when the server was started with an embedding model configured. Routes check
     * for it rather than assuming it, so semantic search is an opt-in capability and its absence
     * is a documented 400 rather than a crash. */
    embeddings?: EmbeddingProvider;
  }
}

export function registerOrgGraphStore(app: FastifyInstance, store: OrgGraphStore): void {
  app.decorate("orgGraphStore", store);
}

export function registerEmbeddings(app: FastifyInstance, embeddings: EmbeddingProvider | undefined): void {
  app.decorate("embeddings", embeddings);
}
