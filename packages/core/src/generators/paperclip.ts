import YAML from "js-yaml";
import type { OrgGraph, TeamId } from "../model/org-graph";

/**
 * Generates an Agent Companies package (`agentcompanies/v1`) from the resolved org graph.
 *
 * The format is markdown-with-frontmatter, filesystem- and git-native, and explicitly
 * vendor-neutral — Paperclip authored it but the spec states it is "intended to be usable by any
 * agent-company runtime". Targeting the spec rather than Paperclip's database means the output
 * stays useful if the runtime changes.
 *
 * Two deliberate gaps, both because the source data does not support the field:
 *
 * - `AGENTS.md` carries no `reportsTo`. Team API models reporting between *roles* (people), not
 *   between agents, so any agent-to-agent hierarchy here would be invented. The runtime is left to
 *   arrange them.
 * - Agents carry no `skills`. Team API's `prompts[]` are real reusable content and do become
 *   `SKILL.md` packages, but nothing in the schema says which agent uses which prompt, so they are
 *   attached at team level instead of guessed at per agent.
 *
 * Non-active agents are skipped: exporting a deprecated agent into a runtime that provisions from
 * the package would bring it back to life.
 */

export interface PaperclipFile {
  path: string;
  content: string;
}

export interface PaperclipPackage {
  files: PaperclipFile[];
  /** Agents left out because their status is not `active`, as `<team>/<agent>`. */
  skippedAgents: string[];
}

export interface PaperclipCompanyOptions {
  /** Company display name. */
  name: string;
  /** URL-safe company slug; defaults to a slugified `name`. */
  slug?: string;
  description?: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Agent and prompt ids are unique per team, not across the org, so they get a team prefix to
 * survive being flattened into the package's root-level `agents/` and `skills/` directories. */
function scoped(teamId: TeamId, id: string): string {
  return `${teamId}-${id}`;
}

function doc(frontmatter: Record<string, unknown>, body: string): string {
  const clean = Object.fromEntries(
    Object.entries(frontmatter).filter(([, v]) => {
      if (v === undefined || v === null) return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === "object") return Object.keys(v as object).length > 0;
      return true;
    }),
  );
  const yaml = YAML.dump(clean, { lineWidth: -1, noRefs: true, skipInvalid: true });
  return `---\n${yaml}---\n\n${body.trimEnd()}\n`;
}

function bullets(heading: string, items: string[]): string {
  return items.length === 0 ? "" : `\n\n## ${heading}\n\n${items.map((i) => `- ${i}`).join("\n")}`;
}

/** One `AGENTS.md` per active agent. Provider/model/permissions go under `metadata`, since the
 * spec reserves the base package for portable data and says vendor runtime config does not
 * belong in it. */
function agentDoc(graph: OrgGraph, teamId: TeamId, agent: Record<string, any>): PaperclipFile {
  const capabilities = (agent.capabilities ?? []) as string[];
  const permissions = (agent.permissions ?? []) as string[];
  const body =
    (agent.description ?? `${agent.name} works on ${teamId}.`) +
    bullets("Capabilities", capabilities) +
    bullets("Permissions requested", permissions);
  return {
    path: `agents/${scoped(teamId, agent.id)}/AGENTS.md`,
    content: doc(
      {
        schema: "agentcompanies/v1",
        kind: "agent",
        slug: scoped(teamId, agent.id),
        name: agent.name,
        title: agent.role,
        tags: agent.tags,
        metadata: {
          teamapi: {
            team: teamId,
            agentId: agent.id,
            provider: agent.provider,
            model: agent.model,
            ownerId: agent.ownerId,
            permissions,
          },
        },
      },
      body,
    ),
  };
}

/** One `SKILL.md` per prompt. Kept minimal so it stays a valid Agent Skills package — the spec
 * requires that `SKILL.md` remain owned by that specification. */
function skillDoc(teamId: TeamId, prompt: Record<string, any>): PaperclipFile {
  const template = prompt.template ?? prompt.body ?? prompt.content ?? "";
  return {
    path: `skills/${scoped(teamId, prompt.id)}/SKILL.md`,
    content: doc(
      {
        name: prompt.name ?? prompt.id,
        description: prompt.description ?? `Prompt ${prompt.id} from ${teamId}.`,
        metadata: { teamapi: { team: teamId, promptId: prompt.id } },
      },
      String(template),
    ),
  };
}

function teamDoc(graph: OrgGraph, teamId: TeamId, agentSlugs: string[], skillSlugs: string[]): PaperclipFile {
  const team = graph.teams.get(teamId)!;
  const info = team.doc.info as Record<string, any>;
  const policies = ((team.doc as Record<string, any>).policies ?? []) as Record<string, any>[];
  const includes = [
    ...agentSlugs.map((s) => `../../agents/${s}/AGENTS.md`),
    ...skillSlugs.map((s) => `../../skills/${s}/SKILL.md`),
  ];
  const body =
    (info.focus ?? `The ${info.name ?? teamId} team.`) +
    bullets(
      "Policies",
      policies.map((p) => `**${p.id}** — ${p.description ?? p.name ?? "see teamapi.yml"}`),
    );
  return {
    path: `teams/${teamId}/TEAM.md`,
    content: doc(
      {
        schema: "agentcompanies/v1",
        kind: "team",
        slug: teamId,
        name: info.name ?? teamId,
        description: info.focus,
        // The Team Topologies type is the single most useful thing a runtime can know about a
        // team, so it rides along as a tag — the base spec has nowhere better to put it.
        includes,
        tags: [info.type].filter(Boolean),
      },
      body,
    ),
  };
}

export function buildPaperclipPackage(graph: OrgGraph, company: PaperclipCompanyOptions): PaperclipPackage {
  const files: PaperclipFile[] = [];
  const skippedAgents: string[] = [];
  const teamIds = [...graph.teams.keys()].sort();

  for (const teamId of teamIds) {
    const team = graph.teams.get(teamId)!;
    const raw = team.doc as Record<string, any>;
    const agents = ((raw.agents ?? []) as Record<string, any>[]).filter((a) => {
      if ((a.status ?? "active") === "active") return true;
      skippedAgents.push(`${teamId}/${a.id}`);
      return false;
    });
    const prompts = (raw.prompts ?? []) as Record<string, any>[];

    for (const agent of agents) files.push(agentDoc(graph, teamId, agent));
    for (const prompt of prompts) files.push(skillDoc(teamId, prompt));
    files.push(
      teamDoc(
        graph,
        teamId,
        agents.map((a) => scoped(teamId, a.id)),
        prompts.map((p) => scoped(teamId, p.id)),
      ),
    );
  }

  files.unshift({
    path: "COMPANY.md",
    content: doc(
      {
        schema: "agentcompanies/v1",
        kind: "company",
        slug: company.slug ?? slugify(company.name),
        name: company.name,
        description: company.description ?? `Agent company generated from ${teamIds.length} Team API team(s).`,
        includes: teamIds.map((id) => `teams/${id}/TEAM.md`),
      },
      "Generated by [TeamAPI](https://github.com/JGalego/TeamAPI) from `teamapi.yml`.\n\n" +
        "The Team API documents remain the source of truth: regenerate rather than editing this " +
        "package by hand, so changes stay reviewable in the originating repository.",
    ),
  });

  return { files, skippedAgents };
}
