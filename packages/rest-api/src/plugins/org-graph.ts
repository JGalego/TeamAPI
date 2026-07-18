import type { FastifyInstance } from "fastify";
import type { OrgGraphStore } from "@jgalego/teamapi-core";

declare module "fastify" {
  interface FastifyInstance {
    orgGraphStore: OrgGraphStore;
  }
}

export function registerOrgGraphStore(app: FastifyInstance, store: OrgGraphStore): void {
  app.decorate("orgGraphStore", store);
}
