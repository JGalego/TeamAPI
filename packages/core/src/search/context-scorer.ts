import type { OrgGraph, TeamId } from "../model/org-graph";
import { contextBundleCandidateTexts, type ContextBundleScorer } from "../context-bundle/derive";
import { cosineSimilarity, type EmbeddingProvider } from "./embeddings";

export interface EmbeddingScorerOptions {
  embeddings: EmbeddingProvider;
  /**
   * How much a perfectly similar document is worth, in units of matched keywords.
   *
   * Three, deliberately. The same-team boost is 2, so a semantically excellent document from
   * another team can outrank a mediocre one from the scoped team — which is the case this exists
   * for — while three literal keyword matches still beat any similarity score. Keyword overlap is
   * evidence the org used those words; similarity is a model's opinion, and the weighting says
   * which of those is the stronger claim.
   */
  weight?: number;
  /** Similarities below this contribute nothing. Defaults to 0.2, so a loosely related document
   * does not accumulate a small score against every possible goal. */
  minSimilarity?: number;
}

const DEFAULT_WEIGHT = 3;
const DEFAULT_MIN_SIMILARITY = 0.2;

/**
 * Pre-embeds a goal and every context-bundle candidate, and returns a synchronous scorer.
 *
 * The asynchrony is confined here on purpose. `deriveContextBundle` is a pure function of the
 * graph, called from an MCP tool and a REST route that both have callers with no embedding model
 * configured; making it async so it could optionally do I/O would have made every consumer pay for
 * a feature most of them will not switch on. Doing the I/O first and handing back a lookup keeps
 * the ranking function exactly as pure as it was.
 */
export async function createEmbeddingScorer(
  graph: OrgGraph,
  goal: string,
  options: EmbeddingScorerOptions,
  teamId?: TeamId,
): Promise<ContextBundleScorer> {
  const weight = options.weight ?? DEFAULT_WEIGHT;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;

  // The candidate texts come from the same helper `rank` scores, so the two can never describe
  // different material — a drift that would read as a mysteriously bad ranking, not as a bug.
  const texts = [...new Set(contextBundleCandidateTexts(graph, teamId))];
  const vectors = await options.embeddings.embed([goal, ...texts]);
  const goalVector = vectors[0]!;

  const scores = new Map<string, number>();
  texts.forEach((text, index) => {
    const similarity = cosineSimilarity(goalVector, vectors[index + 1]!);
    scores.set(text, similarity >= minSimilarity ? similarity * weight : 0);
  });

  return {
    // Unknown text scores 0 rather than throwing: a candidate the pre-pass did not see is a bug in
    // this file, and failing a whole bundle over it would be a worse outcome than ranking it by
    // keywords alone.
    score: (text: string) => scores.get(text) ?? 0,
  };
}
