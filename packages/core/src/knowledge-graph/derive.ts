import type { Ref } from "@jgalego/teamapi-schema";
import type { OrgGraph, TeamId } from "../model/org-graph";
import { LoaderRegistry } from "../resolve/loaders";

export type KnowledgeNodeKind =
  | "team"
  | "member"
  | "role"
  | "service"
  | "agent"
  | "specification"
  | "steeringDocument"
  | "prompt"
  | "playbook"
  | "policy"
  | "knowledgeBase"
  | "workflow"
  | "memory"
  | "session";

export interface KnowledgeNode {
  id: string;
  kind: KnowledgeNodeKind;
  teamId: TeamId;
  label: string;
}

export type KnowledgeEdgeRelation =
  | "owns"
  | "fills"
  | "reportsTo"
  | "alignsWith"
  | "interaction"
  | "dependency"
  | "platform"
  | "usedPrompt"
  | "ranBy"
  | "references";

export interface KnowledgeEdge {
  from: string;
  to: string;
  relation: KnowledgeEdgeRelation;
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

const teamNodeId = (teamId: TeamId) => `team:${teamId}`;
const resourceNodeId = (kind: KnowledgeNodeKind, teamId: TeamId, resourceId: string) => `${kind}:${teamId}:${resourceId}`;

/**
 * Derives a knowledge graph linking every resource this schema knows about: teams, people, AI
 * agents, and every AI-native document domain (specifications, steering documents, prompts,
 * playbooks, policies, knowledge base entries, workflows, memory, sessions).
 *
 * Three edge families, each backed by something the schema can actually resolve — this
 * deliberately stays honest about what's a real link vs. a plausible-looking one:
 * - **Ownership** (`owns`): every resource belongs to the team whose document declares it.
 * - **Structural**: `fills` (member -> role), `reportsTo`/`alignsWith` (role -> role, reusing the
 *   graph's existing `roleEdges`), `interaction`/`dependency`/`platform` (team -> team, reusing
 *   the graph's existing team-level `edges`), `usedPrompt`/`ranBy` (session -> prompt/agent, via
 *   `sessions[].promptIds`/`agentId` — same-team fields, no `$ref` resolution needed).
 * - **Cross-team references** (`references`): resolved from `$ref`-bearing fields
 *   (`memory[].relatedRefs`, `specifications[].linkedDocuments`, `knowledgeBase[].relatedRefs`/
 *   `attachments`, `playbooks[].attachments`) by resolving each `$ref` against its declaring
 *   team's `sourceUri` and matching it to another team's `sourceUri` — the same resolution logic
 *   `buildOrgGraph` uses for the `$ref` kinds it *does* traverse, applied here to the kinds it
 *   doesn't. A `$ref` that doesn't resolve to a known team (e.g. a wiki page, a non-team resource)
 *   is simply omitted rather than guessed at.
 */
export function deriveKnowledgeGraph(graph: OrgGraph): KnowledgeGraph {
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const loaders = new LoaderRegistry();
  const uriToTeamId = new Map<string, TeamId>();
  for (const team of graph.teams.values()) uriToTeamId.set(team.sourceUri, team.id);

  const addOwned = (kind: KnowledgeNodeKind, teamId: TeamId, id: string, label: string) => {
    const nodeId = resourceNodeId(kind, teamId, id);
    nodes.push({ id: nodeId, kind, teamId, label });
    edges.push({ from: teamNodeId(teamId), to: nodeId, relation: "owns" });
    return nodeId;
  };

  const addReferences = (fromNodeId: string, teamId: TeamId, sourceUri: string, refs: Ref[] | undefined) => {
    for (const ref of refs ?? []) {
      let targetUri: string;
      try {
        targetUri = loaders.resolveRef(sourceUri, ref.$ref);
      } catch {
        continue;
      }
      const targetTeamId = uriToTeamId.get(targetUri);
      if (targetTeamId && targetTeamId !== teamId) {
        edges.push({ from: fromNodeId, to: teamNodeId(targetTeamId), relation: "references" });
      }
    }
  };

  for (const team of graph.teams.values()) {
    nodes.push({ id: teamNodeId(team.id), kind: "team", teamId: team.id, label: team.doc.info.name });

    for (const member of team.doc.members) {
      const memberNodeId = addOwned("member", team.id, member.id, member.name);
      for (const roleId of member.roleIds) {
        edges.push({ from: memberNodeId, to: resourceNodeId("role", team.id, roleId), relation: "fills" });
      }
    }
    for (const role of team.doc.roles) {
      addOwned("role", team.id, role.id, role.name);
    }
    for (const service of team.doc.services) {
      addOwned("service", team.id, service.name, service.name);
    }
    for (const agent of team.doc.agents) {
      addOwned("agent", team.id, agent.id, agent.name);
    }
    for (const prompt of team.doc.prompts) {
      addOwned("prompt", team.id, prompt.id, prompt.name);
    }
    for (const playbook of team.doc.playbooks) {
      const nodeId = addOwned("playbook", team.id, playbook.id, playbook.name);
      addReferences(nodeId, team.id, team.sourceUri, playbook.attachments);
    }
    for (const policy of team.doc.policies) {
      addOwned("policy", team.id, policy.id, policy.name);
    }
    for (const workflow of team.doc.workflows) {
      addOwned("workflow", team.id, workflow.id, workflow.name);
    }
    for (const doc of team.doc.steeringDocuments) {
      addOwned("steeringDocument", team.id, doc.id, doc.title);
    }
    for (const entry of team.doc.knowledgeBase) {
      const nodeId = addOwned("knowledgeBase", team.id, entry.id, entry.title);
      addReferences(nodeId, team.id, team.sourceUri, entry.relatedRefs);
      addReferences(nodeId, team.id, team.sourceUri, entry.attachments);
    }
    for (const entry of team.doc.memory) {
      const nodeId = addOwned("memory", team.id, entry.id, entry.title);
      addReferences(nodeId, team.id, team.sourceUri, entry.relatedRefs);
    }
    for (const spec of team.doc.specifications) {
      const nodeId = addOwned("specification", team.id, spec.id, spec.title);
      addReferences(nodeId, team.id, team.sourceUri, spec.linkedDocuments);
    }
    for (const session of team.doc.sessions) {
      const nodeId = addOwned("session", team.id, session.id, session.objective);
      if (session.agentId) {
        edges.push({ from: nodeId, to: resourceNodeId("agent", team.id, session.agentId), relation: "ranBy" });
      }
      for (const promptId of session.promptIds) {
        edges.push({ from: nodeId, to: resourceNodeId("prompt", team.id, promptId), relation: "usedPrompt" });
      }
    }
  }

  for (const edge of graph.edges) {
    edges.push({ from: teamNodeId(edge.from), to: teamNodeId(edge.to), relation: edge.kind });
  }
  const roleEdgeRelation: Record<(typeof graph.roleEdges)[number]["kind"], KnowledgeEdgeRelation> = {
    "reports-to": "reportsTo",
    "aligns-with": "alignsWith",
  };
  for (const roleEdge of graph.roleEdges) {
    edges.push({
      from: resourceNodeId("role", roleEdge.fromTeam, roleEdge.fromRole),
      to: resourceNodeId("role", roleEdge.toTeam, roleEdge.toRole),
      relation: roleEdgeRelation[roleEdge.kind],
    });
  }

  return { nodes, edges };
}

/**
 * Breadth-first traversal of a derived `KnowledgeGraph` starting at `fromNodeId`, treating edges
 * as undirected (a caller asking "what's connected to this ADR" wants both what it references and
 * what references it). Returns the reachable subgraph up to `maxDepth` hops, `fromNodeId` itself
 * included at depth 0.
 */
export function traverseKnowledgeGraph(graph: KnowledgeGraph, fromNodeId: string, maxDepth = 2): KnowledgeGraph {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!nodesById.has(fromNodeId)) return { nodes: [], edges: [] };

  const adjacency = new Map<string, Array<{ neighbor: string; edge: KnowledgeEdge }>>();
  for (const edge of graph.edges) {
    (adjacency.get(edge.from) ?? adjacency.set(edge.from, []).get(edge.from)!).push({ neighbor: edge.to, edge });
    (adjacency.get(edge.to) ?? adjacency.set(edge.to, []).get(edge.to)!).push({ neighbor: edge.from, edge });
  }

  const visited = new Set<string>([fromNodeId]);
  const includedEdges = new Set<KnowledgeEdge>();
  let frontier = [fromNodeId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const { neighbor, edge } of adjacency.get(nodeId) ?? []) {
        includedEdges.add(edge);
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }

  return {
    nodes: [...visited].map((id) => nodesById.get(id)!).filter(Boolean),
    edges: [...includedEdges],
  };
}
