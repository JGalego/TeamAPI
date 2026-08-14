import { z } from "zod";
import { parseDocument, isMap, type Document } from "yaml";
import { TeamApiDocumentSchema } from "@jgalego/teamapi-schema";
import { formatDocumentText } from "../serialize/format-document";
import { formatZodError } from "../validate/format-errors";
import type { ResolvedTeam } from "../model/org-graph";

/**
 * What a proposal is allowed to change.
 *
 * A deliberately small list, and the smallness is the design. This exists so somebody who is not
 * going to open an editor can correct the two things that are wrong about their team most often —
 * what it says it does, and how loaded it says it is — without that being a licence to restructure
 * the graph from a web form. Adding a `$ref`, renaming an id, or removing a team changes what
 * every other document resolves to; those stay where they belong, in a branch, in review, with a
 * diff somebody reads.
 *
 * `.strict()` throughout: a field this does not know about is rejected rather than dropped, so a
 * client sending `interactions` gets told no instead of silently getting a PR that did nothing.
 */
export const TeamPatchSchema = z
  .object({
    info: z
      .object({
        name: z.string().min(1).optional(),
        focus: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    cognitiveLoad: z
      .object({
        intrinsic: z.number().int().min(1).max(10),
        extraneous: z.number().int().min(1).max(10),
        germane: z.number().int().min(1).max(10),
        supervision: z.number().int().min(1).max(10).optional(),
        notes: z.string().optional(),
        assessedOn: z.string().optional(),
      })
      .strict()
      .optional(),
    channels: z.array(z.object({ type: z.string().min(1), name: z.string().min(1) }).strict()).optional(),
    searchTerms: z.array(z.object({ term: z.string().min(1) }).strict()).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: "A proposal must change something" });

export type TeamPatch = z.infer<typeof TeamPatchSchema>;

export class ProposalError extends Error {}

export interface TeamProposal {
  teamId: string;
  /** The document's path, as the resolver knew it. */
  sourceUri: string;
  /** The full new file content, formatted the way `teamapi fmt` would write it. */
  content: string;
  /** One line per change, for the PR title and body — and for a human to read before approving. */
  summary: string[];
}

/** Sets `key` on the document's top-level map, replacing the existing value in place so the
 * surrounding comments and key order survive. */
function setTopLevel(doc: Document, key: string, value: unknown): void {
  if (!isMap(doc.contents)) throw new ProposalError("not a Team API document: expected a YAML mapping");
  doc.setIn([key], doc.createNode(value));
}

/** Merges into a nested map (`info`), so a patch that sets only `focus` leaves `type` alone. */
function mergeNested(doc: Document, key: string, patch: Record<string, unknown>): void {
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    doc.setIn([key, field], value);
  }
}

function describe(before: unknown, after: unknown, label: string): string | undefined {
  if (JSON.stringify(before) === JSON.stringify(after)) return undefined;
  const render = (value: unknown): string =>
    value === undefined ? "(unset)" : typeof value === "string" ? value : JSON.stringify(value);
  return `${label}: ${render(before)} → ${render(after)}`;
}

/**
 * Applies a patch to a team's document and returns the file that would replace it.
 *
 * Edits the parsed YAML in place rather than re-serializing the resolved object, so every comment
 * in the file survives. That is not a nicety: these documents carry the reasons things are the way
 * they are — a `notes:` explaining a cognitive load score, a comment above an interaction saying
 * when it should end — and a write path that silently deleted them would make the format worse for
 * having a UI.
 *
 * The result is re-validated against the schema and re-formatted through `formatDocumentText`, so
 * a proposal can never open a pull request whose CI fails on `validate` or `fmt --check`.
 */
export function buildTeamProposal(team: ResolvedTeam, rawPatch: unknown, originalText: string): TeamProposal {
  const parsed = TeamPatchSchema.safeParse(rawPatch);
  if (!parsed.success) throw new ProposalError(formatZodError(parsed.error));
  const patch = parsed.data;

  const doc = parseDocument(originalText);
  if (doc.errors.length > 0) throw new ProposalError(doc.errors[0]!.message);
  if (!isMap(doc.contents)) throw new ProposalError("not a Team API document: expected a YAML mapping");

  const summary: string[] = [];

  if (patch.info) {
    const change = describe(team.doc.info.name, patch.info.name ?? team.doc.info.name, "name");
    const focusChange = describe(team.doc.info.focus, patch.info.focus ?? team.doc.info.focus, "focus");
    if (change) summary.push(change);
    if (focusChange) summary.push(focusChange);
    mergeNested(doc, "info", patch.info);
  }

  if (patch.cognitiveLoad) {
    const before = team.doc.cognitiveLoad;
    for (const field of ["intrinsic", "extraneous", "germane", "supervision"] as const) {
      const line = describe(before?.[field], patch.cognitiveLoad[field], `cognitiveLoad.${field}`);
      if (line) summary.push(line);
    }
    if (describe(before?.notes, patch.cognitiveLoad.notes, "notes")) summary.push("cognitiveLoad.notes updated");
    // Replaced wholesale rather than merged: the four scores are one assessment made at one time,
    // and merging a new `intrinsic` into last quarter's `extraneous` produces a total nobody
    // assessed.
    setTopLevel(doc, "cognitiveLoad", patch.cognitiveLoad);
  }

  if (patch.channels) {
    const line = describe(team.doc.channels, patch.channels, "channels");
    if (line) summary.push(`channels: ${patch.channels.map((c) => `${c.type}:${c.name}`).join(", ")}`);
    setTopLevel(doc, "channels", patch.channels);
  }

  if (patch.searchTerms) {
    if (describe(team.doc.searchTerms, patch.searchTerms, "searchTerms")) {
      summary.push(`searchTerms: ${patch.searchTerms.map((t) => t.term).join(", ")}`);
    }
    setTopLevel(doc, "searchTerms", patch.searchTerms);
  }

  if (summary.length === 0) throw new ProposalError("Nothing to propose: the patch matches the document already.");

  const content = formatDocumentText(doc.toString());

  // Re-validated after formatting, not before: the formatter is the last thing to touch the bytes,
  // and validating the object graph rather than the file it produced would leave a gap exactly
  // where a serialization bug would live.
  const revalidated = TeamApiDocumentSchema.safeParse(parseDocument(content).toJS());
  if (!revalidated.success) {
    throw new ProposalError(`The proposed document would not validate: ${formatZodError(revalidated.error)}`);
  }

  return { teamId: team.id, sourceUri: team.sourceUri, content, summary };
}

/** A branch name that is unique per team and per content, so proposing the same change twice
 * reuses one branch instead of accumulating near-identical ones. */
export function proposalBranchName(teamId: string, content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = (Math.imul(31, hash) + content.charCodeAt(i)) | 0;
  }
  return `teamapi/${teamId}-${(hash >>> 0).toString(36)}`;
}

/** Title and body for the pull request. The body leads with the change list, because a reviewer
 * looking at a YAML diff needs to know what was *meant* before reading what moved. */
export function proposalPullRequest(proposal: TeamProposal, author?: string): { title: string; body: string } {
  const title =
    proposal.summary.length === 1
      ? `${proposal.teamId}: ${proposal.summary[0]}`
      : `${proposal.teamId}: ${proposal.summary.length} changes`;

  const body = [
    `Proposed from the Team API dashboard${author ? ` by ${author}` : ""}.`,
    "",
    ...proposal.summary.map((line) => `- ${line}`),
    "",
    "The document was re-validated and re-formatted before this branch was pushed, so `teamapi",
    "validate` and `teamapi fmt --check` should both pass. Everything else about the team is",
    "unchanged — a proposal cannot add a `$ref`, rename an id, or remove a team.",
  ].join("\n");

  return { title, body };
}
