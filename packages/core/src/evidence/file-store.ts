import { EvidenceLedger } from "./ledger";
import { readJsonIfPresent, writeJsonAtomic } from "../storage/json-file";

/** Loads an append-only ledger from disk; a missing file is an empty first run. */
export async function loadEvidenceLedger(file: string): Promise<EvidenceLedger> {
  const value = await readJsonIfPresent(file);
  return value === undefined ? new EvidenceLedger() : EvidenceLedger.restore(value);
}

/** Atomically replaces the durable representation after a successful in-memory update. */
export async function saveEvidenceLedger(file: string, ledger: EvidenceLedger): Promise<void> {
  await writeJsonAtomic(file, ledger.snapshot());
}
