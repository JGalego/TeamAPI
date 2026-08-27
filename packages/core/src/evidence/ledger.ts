import { z } from "zod";

export const EvidenceKindSchema = z.enum(["observation", "audit-log", "metric", "incident", "change", "attestation"]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const EvidenceEntrySchema = z
  .object({
    id: z.string().min(1),
    kind: EvidenceKindSchema,
    source: z.string().min(1),
    observedAt: z.string().datetime(),
    targetType: z.enum(["org", "team", "service", "member", "agent", "policy", "proposal"]),
    targetId: z.string().min(1),
    summary: z.string().min(1),
    confidence: z.number().min(0).max(1).default(1),
    attributes: z.record(z.unknown()).default({}),
  })
  .strict();
export type EvidenceEntry = z.infer<typeof EvidenceEntrySchema>;

export interface EvidenceChain {
  id: string;
  finding: string;
  targetId: string;
  evidenceIds: string[];
  action?: string;
  result?: "open" | "accepted" | "rejected" | "resolved";
}

const EvidenceChainSchema = z
  .object({
    id: z.string().min(1),
    finding: z.string().min(1),
    targetId: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)).min(1),
    action: z.string().min(1).optional(),
    result: z.enum(["open", "accepted", "rejected", "resolved"]).optional(),
  })
  .strict();

export const EvidenceLedgerDocumentSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(EvidenceEntrySchema),
    chains: z.array(EvidenceChainSchema),
  })
  .strict();
export type EvidenceLedgerDocument = z.infer<typeof EvidenceLedgerDocumentSchema>;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Append-only evidence with idempotent ingestion and explicit finding-to-outcome chains. */
export class EvidenceLedger {
  readonly #entries = new Map<string, EvidenceEntry>();
  readonly #chains = new Map<string, EvidenceChain>();

  static restore(raw: unknown): EvidenceLedger {
    const document = EvidenceLedgerDocumentSchema.parse(raw);
    const ledger = new EvidenceLedger();
    for (const entry of document.entries) ledger.ingest(entry);
    for (const chain of document.chains) ledger.link(chain);
    return ledger;
  }

  ingest(raw: unknown): { entry: EvidenceEntry; created: boolean } {
    const entry = EvidenceEntrySchema.parse(raw);
    const existing = this.#entries.get(entry.id);
    if (existing) {
      if (stable(existing) !== stable(entry))
        throw new Error(`Evidence id '${entry.id}' already has different content`);
      return { entry: existing, created: false };
    }
    const stored = structuredClone(entry);
    this.#entries.set(entry.id, stored);
    return { entry: structuredClone(stored), created: true };
  }

  get(id: string): EvidenceEntry | undefined {
    const entry = this.#entries.get(id);
    return entry ? structuredClone(entry) : undefined;
  }

  list(filter: { targetId?: string; kind?: EvidenceKind; source?: string } = {}): EvidenceEntry[] {
    return [...this.#entries.values()]
      .filter((entry) => !filter.targetId || entry.targetId === filter.targetId)
      .filter((entry) => !filter.kind || entry.kind === filter.kind)
      .filter((entry) => !filter.source || entry.source === filter.source)
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id))
      .map((entry) => structuredClone(entry));
  }

  link(chain: EvidenceChain): EvidenceChain {
    if (chain.evidenceIds.length === 0) throw new Error("An evidence chain must cite at least one evidence entry");
    for (const evidenceId of chain.evidenceIds) {
      if (!this.#entries.has(evidenceId)) throw new Error(`Unknown evidence id '${evidenceId}'`);
    }
    const stored = structuredClone({ ...chain, evidenceIds: [...new Set(chain.evidenceIds)].sort() });
    this.#chains.set(chain.id, stored);
    return structuredClone(stored);
  }

  chains(targetId?: string): EvidenceChain[] {
    return [...this.#chains.values()]
      .filter((chain) => !targetId || chain.targetId === targetId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((chain) => structuredClone(chain));
  }

  snapshot(): EvidenceLedgerDocument {
    return { version: 1, entries: this.list(), chains: this.chains() };
  }
}

/** Current on-disk evidence document version, for consumers that manage migrations. */
export const EVIDENCE_LEDGER_VERSION = 1;
