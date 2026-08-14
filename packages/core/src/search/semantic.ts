import type { OrgGraph, TeamId } from "../model/org-graph";
import { searchOrg, type SearchResult, type SearchResultKind } from "../model/queries";
import { cosineSimilarity, type EmbeddingProvider } from "./embeddings";

/** One searchable thing, plus the text that stands for it in embedding space. */
export interface SearchDocument {
  kind: SearchResultKind;
  teamId: TeamId;
  resourceId?: string;
  label: string;
  /** What gets embedded. Longer than the label, because "Checkout Tech Lead" alone tells a model
   * almost nothing while the responsibilities beneath it tell it a great deal. */
  text: string;
}

export interface SemanticSearchResult extends SearchResult {
  /** Cosine similarity to the query, in [-1, 1]. Absent on a result that only matched lexically. */
  similarity?: number;
  /** How this result was found. `both` is the strongest signal there is. */
  matchedBy: "lexical" | "semantic" | "both";
}

export interface SemanticSearchOptions {
  embeddings: EmbeddingProvider;
  /** Results to return. Defaults to 20. */
  limit?: number;
  /** Semantic results below this similarity are dropped. Defaults to 0.2 — low enough not to hide
   * a loosely-worded question, high enough that "who owns X" does not return the whole org. */
  minSimilarity?: number;
  /** `hybrid` (default) unions both; the others are for comparing them. */
  mode?: "hybrid" | "semantic" | "lexical";
}

const DEFAULT_LIMIT = 20;
const DEFAULT_MIN_SIMILARITY = 0.2;
/** A lexical hit is an exact substring of something the org wrote down, which is a stronger claim
 * than any similarity score. Ranked above every semantic-only result rather than being scored
 * against them, because the two numbers are not on the same scale and pretending otherwise is how
 * a search stops finding a service by its own name. */
const LEXICAL_RANK = 2;

function join(...parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(". ");
}

/**
 * Every resource in the org, as text worth embedding.
 *
 * The text is deliberately more than the label. `searchOrg` matches substrings, so a label is
 * enough for it; a vector of the string "Checkout Tech Lead" carries almost none of what makes
 * that role findable by "who should review a payment flow change", while the responsibilities and
 * the team's focus carry most of it.
 */
export function buildSearchDocuments(graph: OrgGraph): SearchDocument[] {
  const documents: SearchDocument[] = [];

  for (const teamId of [...graph.teams.keys()].sort()) {
    const doc = graph.teams.get(teamId)!.doc;
    const teamContext = join(doc.info.name, doc.info.focus);

    documents.push({
      kind: "team",
      teamId,
      label: doc.info.name,
      text: join(
        doc.info.name,
        `A ${doc.info.type} team`,
        doc.info.focus,
        doc.searchTerms.map((term) => term.term).join(", "),
      ),
    });

    for (const service of doc.services) {
      const context = service.boundedContext;
      documents.push({
        kind: "service",
        teamId,
        label: service.name,
        text: join(
          service.name,
          `Owned by ${doc.info.name}`,
          context?.ubiquitousLanguage?.map((entry) => `${entry.term}: ${entry.definition}`).join(". "),
          context?.aggregates?.length ? `Aggregates: ${context.aggregates.join(", ")}` : undefined,
          context?.publishedEvents?.length ? `Publishes: ${context.publishedEvents.join(", ")}` : undefined,
          context?.subscribedEvents?.length ? `Subscribes to: ${context.subscribedEvents.join(", ")}` : undefined,
        ),
      });
    }

    for (const role of doc.roles) {
      documents.push({
        kind: "role",
        teamId,
        resourceId: role.id,
        label: `${role.name} (${role.kind})`,
        text: join(
          role.name,
          role.kind,
          `On ${teamContext}`,
          role.responsibilities.map((r) => (typeof r === "string" ? r : r.text)).join(". "),
        ),
      });
    }

    for (const member of doc.members) {
      const roleNames = doc.roles.filter((role) => member.roleIds.includes(role.id)).map((role) => role.name);
      documents.push({
        kind: "member",
        teamId,
        resourceId: member.id,
        label: member.name,
        text: join(member.name, roleNames.join(", "), `On ${teamContext}`),
      });
    }

    for (const agent of doc.agents) {
      documents.push({
        kind: "agent",
        teamId,
        resourceId: agent.id,
        label: agent.name,
        text: join(agent.name, agent.role, agent.description, agent.capabilities.join(", "), agent.tags.join(", ")),
      });
    }

    for (const entry of doc.memory) {
      documents.push({
        kind: "memory",
        teamId,
        resourceId: entry.id,
        label: entry.title,
        text: join(entry.title, entry.kind, entry.body, entry.tags.join(", ")),
      });
    }

    for (const spec of doc.specifications) {
      documents.push({
        kind: "specification",
        teamId,
        resourceId: spec.id,
        label: spec.title,
        text: join(spec.title, spec.kind, spec.body, spec.tags.join(", ")),
      });
    }

    for (const steering of doc.steeringDocuments) {
      documents.push({
        kind: "steeringDocument",
        teamId,
        resourceId: steering.id,
        label: steering.title,
        text: join(steering.title, steering.category, steering.body, steering.tags.join(", ")),
      });
    }

    for (const prompt of doc.prompts) {
      documents.push({
        kind: "prompt",
        teamId,
        resourceId: prompt.id,
        label: prompt.name,
        text: join(prompt.name, prompt.description, prompt.template, prompt.tags.join(", ")),
      });
    }

    for (const playbook of doc.playbooks) {
      documents.push({
        kind: "playbook",
        teamId,
        resourceId: playbook.id,
        label: playbook.name,
        text: join(
          playbook.name,
          playbook.category,
          playbook.documentation,
          playbook.steps.map((step) => join(step.title, step.description)).join(". "),
          playbook.tags.join(", "),
        ),
      });
    }

    for (const policy of doc.policies) {
      documents.push({
        kind: "policy",
        teamId,
        resourceId: policy.id,
        label: policy.name,
        text: join(
          policy.name,
          policy.category,
          policy.description,
          policy.rules.map((rule) => join(rule.key, rule.description)).join(". "),
          policy.tags.join(", "),
        ),
      });
    }

    for (const entry of doc.knowledgeBase) {
      documents.push({
        kind: "knowledgeBase",
        teamId,
        resourceId: entry.id,
        label: entry.title,
        text: join(entry.title, entry.kind, entry.category, entry.body, entry.tags.join(", ")),
      });
    }

    for (const workflow of doc.workflows) {
      documents.push({
        kind: "workflow",
        teamId,
        resourceId: workflow.id,
        label: workflow.name,
        text: join(
          workflow.name,
          workflow.description,
          workflow.states.map((state) => state.name).join(" -> "),
          workflow.tags.join(", "),
        ),
      });
    }

    for (const session of doc.sessions) {
      documents.push({
        kind: "session",
        teamId,
        resourceId: session.id,
        label: session.objective,
        text: join(session.objective, session.assistant, session.decisions.join(". "), session.tags.join(", ")),
      });
    }
  }

  return documents;
}

function keyOf(result: { kind: string; teamId: string; resourceId?: string; label: string }): string {
  return `${result.kind}|${result.teamId}|${result.resourceId ?? result.label}`;
}

/**
 * Hybrid search: the existing substring matcher, unioned with cosine similarity over embeddings.
 *
 * Hybrid rather than a replacement, and that is the important decision. Embeddings are the obvious
 * upgrade for "who owns the thing that charges cards" — a question containing none of the words in
 * any document. They are a downgrade for "checkout-api", where the searcher already knows the
 * exact name and a nearest-neighbour search will happily return six services that are *like* it.
 * A search that stops finding a service by its own name is worse than one that never learned to
 * answer the first question.
 *
 * So lexical hits rank above semantic-only ones, unconditionally, rather than being blended into a
 * single score. The two numbers are not on the same scale, and a weighting between them would be a
 * knob nobody can tune without a benchmark this project does not have.
 */
export async function semanticSearchOrg(
  graph: OrgGraph,
  query: string,
  options: SemanticSearchOptions,
): Promise<SemanticSearchResult[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const mode = options.mode ?? "hybrid";
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;

  const lexical = mode === "semantic" ? [] : searchOrg(graph, query);
  if (mode === "lexical") {
    return lexical.slice(0, limit).map((result) => ({ ...result, matchedBy: "lexical" }));
  }

  const documents = buildSearchDocuments(graph);
  // The query is embedded in the same call as the documents so a provider that batches pays one
  // round trip, and so a cache that already holds every document still only fetches the query.
  const vectors = await options.embeddings.embed([query, ...documents.map((document) => document.text)]);
  const queryVector = vectors[0]!;

  const scored = documents
    .map((document, index) => ({ document, similarity: cosineSimilarity(queryVector, vectors[index + 1]!) }))
    .filter((entry) => entry.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity);

  const merged = new Map<string, SemanticSearchResult & { rank: number }>();

  for (const result of lexical) {
    merged.set(keyOf(result), { ...result, matchedBy: "lexical", rank: LEXICAL_RANK });
  }
  for (const { document, similarity } of scored) {
    const key = keyOf(document);
    const existing = merged.get(key);
    if (existing) {
      // Found both ways: the strongest signal available, and it keeps its lexical rank.
      existing.matchedBy = "both";
      existing.similarity = similarity;
      continue;
    }
    merged.set(key, {
      kind: document.kind,
      teamId: document.teamId,
      resourceId: document.resourceId,
      label: document.label,
      similarity,
      matchedBy: "semantic",
      rank: 1,
    });
  }

  return [...merged.values()]
    .sort((a, b) => b.rank - a.rank || (b.similarity ?? 0) - (a.similarity ?? 0) || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map(({ rank: _rank, ...result }) => result);
}
