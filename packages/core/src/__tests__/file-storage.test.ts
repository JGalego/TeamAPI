import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ASSESSMENT_STATE_VERSION, type AssessmentState } from "../assessment/build";
import { loadAssessmentState, saveAssessmentState } from "../assessment/state-file";
import { loadEvidenceLedger, saveEvidenceLedger } from "../evidence/file-store";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-storage-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const state: AssessmentState = {
  version: ASSESSMENT_STATE_VERSION,
  generatedAt: "2026-08-27T00:00:00.000Z",
  snapshot: {
    teams: 1,
    members: 2,
    services: 3,
    roles: 2,
    vacantRoles: 0,
    avgCognitiveLoad: 4,
    maxCognitiveLoad: 4,
    overloadedTeams: 0,
    avgSupervision: 2,
    unscoredSupervision: 0,
    agents: 1,
    activeAgents: 1,
    teamsWithAgents: 1,
    blockingGaps: 0,
    warningGaps: 0,
    teamIds: ["checkout"],
  },
  findingIds: ["gaps/unacknowledged/checkout/payments"],
};

describe("file-backed state", () => {
  it("round-trips assessment state and treats a missing file as the first run", async () => {
    const file = path.join(await temporaryDirectory(), "nested", "state.json");
    expect(await loadAssessmentState(file)).toBeUndefined();
    await saveAssessmentState(file, state);
    expect(await loadAssessmentState(file)).toEqual(state);
  });

  it("round-trips evidence entries and chains", async () => {
    const file = path.join(await temporaryDirectory(), "evidence.json");
    const ledger = await loadEvidenceLedger(file);
    ledger.ingest({
      id: "github/checkout/1",
      kind: "observation",
      source: "github",
      observedAt: "2026-08-27T00:00:00.000Z",
      targetType: "service",
      targetId: "checkout-api",
      summary: "Repository exists",
      confidence: 1,
      attributes: {},
    });
    ledger.link({
      id: "ownership/checkout-api",
      finding: "unowned service",
      targetId: "checkout-api",
      evidenceIds: ["github/checkout/1"],
      result: "open",
    });
    await saveEvidenceLedger(file, ledger);

    const restored = await loadEvidenceLedger(file);
    expect(restored.list()).toEqual(ledger.list());
    expect(restored.chains()).toEqual(ledger.chains());
  });
});
