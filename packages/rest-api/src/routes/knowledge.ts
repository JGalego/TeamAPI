import type { FastifyInstance } from "fastify";
import {
  getAgent,
  getKnowledgeBaseEntry,
  getMemoryEntry,
  getPlaybook,
  getPolicy,
  getPrompt,
  getSession,
  getSpecification,
  getSteeringDocument,
  getTeam,
  getWorkflow,
  listAgents,
  listAllAgents,
  listAllPlaybooks,
  listAllPolicies,
  listAllPrompts,
  listAllSessions,
  listAllSpecifications,
  listAllWorkflows,
  listKnowledgeBase,
  listMemory,
  listPlaybooks,
  listPolicies,
  listPrompts,
  listSessions,
  listSpecifications,
  listSteeringDocuments,
  listWorkflows,
  MissingPromptVariableError,
  renderPrompt,
  resolveEffectiveSteering,
  searchKnowledgeBase,
  searchMemory,
} from "@jgalego/teamapi-core";
import { errorResponseSchema } from "../schemas/error";
import { registerResourceRoutes } from "./resource-collection";

const teamIdParam = {
  type: "object",
  properties: { id: { type: "string", description: "Team id (slug), e.g. 'stream-checkout'" } },
  required: ["id"],
} as const;

/** Registers the read-only REST surface for every AI-native resource domain. There is no write
 * path here, same as the rest of this API: these documents are edited in git, not via `POST`. */
export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  registerResourceRoutes(app, {
    tag: "Agents",
    collectionPath: "agents",
    resourceLabel: "agent",
    listInTeam: listAgents,
    getById: getAgent,
    listAcrossOrg: listAllAgents,
  });

  registerResourceRoutes(app, {
    tag: "Memory",
    collectionPath: "memory",
    resourceLabel: "memory entry",
    listInTeam: listMemory,
    getById: getMemoryEntry,
    listAcrossOrg: searchMemory,
  });

  registerResourceRoutes(app, {
    tag: "Specifications",
    collectionPath: "specifications",
    resourceLabel: "specification",
    listInTeam: listSpecifications,
    getById: getSpecification,
    listAcrossOrg: listAllSpecifications,
  });

  registerResourceRoutes(app, {
    tag: "Prompts",
    collectionPath: "prompts",
    resourceLabel: "prompt",
    listInTeam: listPrompts,
    getById: getPrompt,
    listAcrossOrg: listAllPrompts,
  });

  registerResourceRoutes(app, {
    tag: "Playbooks",
    collectionPath: "playbooks",
    resourceLabel: "playbook",
    listInTeam: listPlaybooks,
    getById: getPlaybook,
    listAcrossOrg: listAllPlaybooks,
  });

  registerResourceRoutes(app, {
    tag: "Policies",
    collectionPath: "policies",
    resourceLabel: "policy",
    listInTeam: listPolicies,
    getById: getPolicy,
    listAcrossOrg: listAllPolicies,
  });

  registerResourceRoutes(app, {
    tag: "Knowledge Base",
    collectionPath: "knowledge-base",
    resourceLabel: "knowledge base entry",
    listInTeam: listKnowledgeBase,
    getById: getKnowledgeBaseEntry,
    listAcrossOrg: searchKnowledgeBase,
  });

  registerResourceRoutes(app, {
    tag: "Workflows",
    collectionPath: "workflows",
    resourceLabel: "workflow",
    listInTeam: listWorkflows,
    getById: getWorkflow,
    listAcrossOrg: listAllWorkflows,
  });

  registerResourceRoutes(app, {
    tag: "Sessions",
    collectionPath: "sessions",
    resourceLabel: "AI session",
    listInTeam: listSessions,
    getById: getSession,
    listAcrossOrg: listAllSessions,
  });

  // Steering documents: a bespoke route, not `registerResourceRoutes`, so it can support
  // `effective=true` — the inherited (organization -> team -> project) view derived by walking
  // the platform-team chain, on top of the plain "this team's own documents" list the other
  // domains all have.
  app.get<{ Params: { id: string }; Querystring: { effective?: string } }>(
    "/teams/:id/steering",
    {
      schema: {
        tags: ["Steering"],
        summary: "List a team's steering documents",
        description:
          "This team's own steering documents by default. Pass effective=true to also include organization-scoped " +
          "documents inherited from this team's platform-team chain (nearer documents win on id collisions).",
        params: teamIdParam,
        querystring: {
          type: "object",
          properties: {
            effective: { type: "string", enum: ["true", "false"], description: "Include inherited organization-scoped documents" },
          },
        },
        response: { 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const graph = app.orgGraphStore.current;
      if (!getTeam(graph, req.params.id)) return reply.code(404).send({ error: `Unknown team id '${req.params.id}'` });
      return req.query.effective === "true"
        ? resolveEffectiveSteering(graph, req.params.id)
        : listSteeringDocuments(graph, req.params.id);
    },
  );

  app.get<{ Params: { id: string; resourceId: string } }>(
    "/teams/:id/steering/:resourceId",
    {
      schema: {
        tags: ["Steering"],
        summary: "Get one steering document by id",
        params: {
          type: "object",
          properties: { id: { type: "string" }, resourceId: { type: "string" } },
          required: ["id", "resourceId"],
        },
        response: { 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const graph = app.orgGraphStore.current;
      if (!getTeam(graph, req.params.id)) return reply.code(404).send({ error: `Unknown team id '${req.params.id}'` });
      const doc = getSteeringDocument(graph, req.params.id, req.params.resourceId);
      if (!doc) return reply.code(404).send({ error: `Unknown steering document id '${req.params.resourceId}' on team '${req.params.id}'` });
      return doc;
    },
  );

  // Prompt rendering: fills a prompt's {{variable}} placeholders.
  app.post<{ Params: { id: string; promptId: string }; Body: { variables?: Record<string, string> } }>(
    "/teams/:id/prompts/:promptId/render",
    {
      schema: {
        tags: ["Prompts"],
        summary: "Render a prompt",
        description: "Fills a prompt's {{variable}} placeholders from the request body, falling back to each variable's declared default.",
        params: {
          type: "object",
          properties: { id: { type: "string" }, promptId: { type: "string" } },
          required: ["id", "promptId"],
        },
        body: {
          type: "object",
          properties: { variables: { type: "object", additionalProperties: { type: "string" } } },
        },
        response: { 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const graph = app.orgGraphStore.current;
      if (!getTeam(graph, req.params.id)) return reply.code(404).send({ error: `Unknown team id '${req.params.id}'` });
      const prompt = getPrompt(graph, req.params.id, req.params.promptId);
      if (!prompt) return reply.code(404).send({ error: `Unknown prompt id '${req.params.promptId}' on team '${req.params.id}'` });
      try {
        return { rendered: renderPrompt(prompt, req.body?.variables ?? {}) };
      } catch (err) {
        if (err instanceof MissingPromptVariableError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );
}
