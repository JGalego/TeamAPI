import {
  buildOrgGraph,
  formatDriftReport,
  PaperclipClient,
  planPaperclipDrift,
  type PaperclipAgent,
} from "@jgalego/teamapi-core";
import { resolveOptions } from "../resolve-options";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";
import { isConfigFailure, NO_PATTERNS_MESSAGE, resolveInput, type ConfigAwareOptions } from "../with-config";

export interface PaperclipDriftOptions extends ConfigAwareOptions {
  url?: string;
  company?: string;
  token?: string;
}

export async function runPaperclipDrift(patterns: string[], options: PaperclipDriftOptions): Promise<number> {
  const input = await resolveInput(patterns, options);
  if (isConfigFailure(input)) {
    console.error(input.error);
    return 1;
  }
  if (input.patterns.length === 0) {
    console.error(NO_PATTERNS_MESSAGE);
    return 1;
  }

  const url = options.url ?? input.config.defaults.paperclip.url;
  const company = options.company ?? input.config.defaults.paperclip.company;
  if (!url || !company) {
    console.error(
      "A Paperclip URL and company id are required: pass --url/--company or set `defaults.paperclip` in teamapi.config.yml.",
    );
    return 1;
  }

  const seeds = await expandSeeds(input.patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${input.patterns.join(", ")}`);
    return 1;
  }
  const token = options.token ?? process.env.PAPERCLIP_API_KEY;
  if (!token) {
    console.error("A Paperclip token is required: pass --token or set PAPERCLIP_API_KEY.");
    return 1;
  }

  const graph = await buildOrgGraph(resolveOptions(seeds));
  warnUnresolved(graph);

  let running: PaperclipAgent[];
  try {
    running = await new PaperclipClient({ token, url }).listAgents(company);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const report = planPaperclipDrift(graph, company, running);
  console.log(formatDriftReport(report));

  // Exit non-zero only on a governance breach, so this can gate a required check without
  // ordinary drift — which is expected while Paperclip's org is editable from its UI — failing CI.
  return report.findings.some((f) => f.severity === "blocking") ? 1 : 0;
}
