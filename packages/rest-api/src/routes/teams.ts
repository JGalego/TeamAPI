import type { FastifyInstance } from "fastify";
import {
  getDependencies,
  getInteractions,
  getTeam,
  listMembers,
  listRoles,
  listTeams,
  toTeamDetailDto,
  toTeamSummaryDto,
} from "@teamapi/core";

interface ListTeamsQuery {
  type?: string;
  search?: string;
}

interface DirectionQuery {
  direction?: "in" | "out" | "both";
}

const teamIdParam = {
  type: "object",
  properties: { id: { type: "string", description: "Team id (slug), e.g. 'stream-checkout'" } },
  required: ["id"],
} as const;

const directionQuery = {
  type: "object",
  properties: {
    direction: { type: "string", enum: ["in", "out", "both"], description: "Filter by edge direction" },
  },
} as const;

export async function teamsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ListTeamsQuery }>(
    "/teams",
    {
      schema: {
        tags: ["Teams"],
        summary: "List teams",
        description: "List all teams, optionally filtered by team type or a free-text search term.",
        querystring: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["stream-aligned", "platform", "complicated-subsystem", "enabling"],
              description: "Filter by Team Topologies team type",
            },
            search: { type: "string", description: "Case-insensitive substring match on name/focus" },
          },
        },
      },
    },
    async (req) => {
      const graph = app.orgGraphStore.current;
      const teams = listTeams(graph, { type: req.query.type, search: req.query.search });
      return teams.map(toTeamSummaryDto);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/teams/:id",
    {
      schema: {
        tags: ["Teams"],
        summary: "Get team detail",
        description: "Full detail for one team: info, roles, members, services, cognitive load, meetings.",
        params: teamIdParam,
      },
    },
    async (req, reply) => {
      const graph = app.orgGraphStore.current;
      const team = getTeam(graph, req.params.id);
      if (!team) return reply.code(404).send({ error: `Unknown team id '${req.params.id}'` });
      return toTeamDetailDto(team);
    },
  );

  app.get<{ Params: { id: string }; Querystring: DirectionQuery }>(
    "/teams/:id/interactions",
    {
      schema: {
        tags: ["Teams"],
        summary: "Get team interactions",
        description: "Team Topologies interactions (collaboration / x-as-a-service / facilitating).",
        params: teamIdParam,
        querystring: directionQuery,
      },
    },
    async (req, reply) => {
      const graph = app.orgGraphStore.current;
      if (!getTeam(graph, req.params.id)) return reply.code(404).send({ error: `Unknown team id '${req.params.id}'` });
      return getInteractions(graph, req.params.id, req.query.direction ?? "both");
    },
  );

  app.get<{ Params: { id: string }; Querystring: DirectionQuery }>(
    "/teams/:id/dependencies",
    {
      schema: {
        tags: ["Teams"],
        summary: "Get team dependencies",
        description: "Dependencies this team has declared on other teams (or, with direction=in, who depends on it).",
        params: teamIdParam,
        querystring: directionQuery,
      },
    },
    async (req, reply) => {
      const graph = app.orgGraphStore.current;
      if (!getTeam(graph, req.params.id)) return reply.code(404).send({ error: `Unknown team id '${req.params.id}'` });
      return getDependencies(graph, req.params.id, req.query.direction ?? "out");
    },
  );

  app.get<{ Params: { id: string } }>(
    "/teams/:id/roles",
    {
      schema: {
        tags: ["Teams"],
        summary: "Get team roles and members",
        description: "The role/reporting hierarchy for one team, plus the members assigned to each role.",
        params: teamIdParam,
      },
    },
    async (req, reply) => {
      const graph = app.orgGraphStore.current;
      if (!getTeam(graph, req.params.id)) return reply.code(404).send({ error: `Unknown team id '${req.params.id}'` });
      return {
        roles: listRoles(graph, req.params.id).map((r) => r.role),
        members: listMembers(graph, req.params.id).map((m) => m.member),
      };
    },
  );
}
