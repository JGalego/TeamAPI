import { z } from "zod";
import { ASSESSMENT_STATE_VERSION, type AssessmentState } from "./build";
import { readJsonIfPresent, writeJsonAtomic } from "../storage/json-file";

const OrgSnapshotSchema = z
  .object({
    teams: z.number(),
    members: z.number(),
    services: z.number(),
    roles: z.number(),
    vacantRoles: z.number(),
    avgCognitiveLoad: z.number(),
    maxCognitiveLoad: z.number(),
    overloadedTeams: z.number(),
    avgSupervision: z.number(),
    unscoredSupervision: z.number(),
    agents: z.number(),
    activeAgents: z.number(),
    teamsWithAgents: z.number(),
    blockingGaps: z.number(),
    warningGaps: z.number(),
    teamIds: z.array(z.string()),
  })
  .strict();

export const AssessmentStateSchema = z
  .object({
    version: z.literal(ASSESSMENT_STATE_VERSION),
    generatedAt: z.string().datetime(),
    snapshot: OrgSnapshotSchema,
    findingIds: z.array(z.string()).refine((ids) => new Set(ids).size === ids.length, "finding IDs must be unique"),
  })
  .strict();

export function parseAssessmentState(value: unknown): AssessmentState {
  return AssessmentStateSchema.parse(value);
}

export async function loadAssessmentState(file: string): Promise<AssessmentState | undefined> {
  const value = await readJsonIfPresent(file);
  return value === undefined ? undefined : parseAssessmentState(value);
}

export async function saveAssessmentState(file: string, state: AssessmentState): Promise<void> {
  await writeJsonAtomic(file, AssessmentStateSchema.parse(state));
}
