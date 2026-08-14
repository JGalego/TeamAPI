import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as YAML from "js-yaml";
import {
  GithubClient,
  importBackstageCatalog,
  importCsvRoster,
  importDirectoryGroups,
  importGithubOrg,
  importSlackChannels,
  OktaClient,
  SlackClient,
  type BackstageCatalogEntity,
  type ImportedTeam,
} from "@jgalego/teamapi-core";

export const IMPORT_SOURCES = ["github-org", "backstage", "okta", "slack", "csv"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export interface ImportOptions {
  token?: string;
  out: string;
  /** Okta org URL, or a Backstage base URL. */
  url?: string;
  /** Strip this from directory group / Slack channel names before they become team ids. */
  prefix?: string;
  /** Slack only: import channels whose name matches this regular expression. */
  match?: string;
}

/** What each source needs, and where its token comes from. Declared as data so the error a caller
 * gets for a missing credential names the right variable for the source they actually asked for. */
const REQUIREMENTS: Record<ImportSource, { argLabel: string; tokenEnv?: string[]; needsUrl?: boolean }> = {
  "github-org": { argLabel: "<org>", tokenEnv: ["GITHUB_TOKEN", "GH_TOKEN"] },
  backstage: { argLabel: "<catalog-file-or-url>" },
  okta: { argLabel: "<okta-url>", tokenEnv: ["OKTA_TOKEN"], needsUrl: false },
  slack: { argLabel: "(ignored)", tokenEnv: ["SLACK_BOT_TOKEN"] },
  csv: { argLabel: "<file>" },
};

function tokenFor(source: ImportSource, explicit: string | undefined): string | undefined {
  if (explicit) return explicit;
  for (const name of REQUIREMENTS[source].tokenEnv ?? []) {
    if (process.env[name]) return process.env[name];
  }
  return undefined;
}

/** Reads a Backstage catalog from a file or a URL. A URL because `/api/catalog/entities` is how a
 * running Backstage exposes the processed entities, which carry `relations[]` a raw
 * `catalog-info.yaml` does not. */
async function readBackstageEntities(source: string): Promise<BackstageCatalogEntity[]> {
  const text = /^https?:\/\//i.test(source)
    ? await fetch(source).then(async (res) => {
        if (!res.ok) throw new Error(`Failed to fetch ${source}: ${res.status} ${res.statusText}`);
        return res.text();
      })
    : await fs.readFile(source, "utf-8");

  const trimmed = text.trimStart();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(text) as BackstageCatalogEntity[] | { items?: BackstageCatalogEntity[] };
    // The catalog API answers `{items:[...]}` on some versions and a bare array on others.
    return Array.isArray(parsed) ? parsed : (parsed.items ?? []);
  }
  // A `catalog-info.yaml` is conventionally multi-document, one entity per `---` section.
  return YAML.loadAll(text) as BackstageCatalogEntity[];
}

async function collect(source: ImportSource, argument: string, options: ImportOptions): Promise<ImportedTeam[]> {
  const token = tokenFor(source, options.token);
  const requirement = REQUIREMENTS[source];
  if (requirement.tokenEnv && !token) {
    throw new Error(`A token is required for '${source}': pass --token or set ${requirement.tokenEnv.join("/")}.`);
  }

  switch (source) {
    case "github-org":
      return importGithubOrg(new GithubClient({ token: token! }), argument);

    case "backstage":
      return importBackstageCatalog(await readBackstageEntities(argument));

    case "okta": {
      const url = options.url ?? argument;
      if (!url || !/^https?:\/\//i.test(url)) {
        throw new Error("Okta needs an org URL, e.g. `teamapi import okta https://acme.okta.com --out ./teams`.");
      }
      const groups = await new OktaClient({ token: token!, url }).listGroups();
      return importDirectoryGroups(groups, { groupPrefix: options.prefix });
    }

    case "slack": {
      const channels = await new SlackClient({ token: token! }).listChannels();
      return importSlackChannels(channels, {
        channelPrefix: options.prefix,
        channelPattern: options.match ? new RegExp(options.match) : undefined,
      });
    }

    case "csv":
      return importCsvRoster(await fs.readFile(argument, "utf-8"));
  }
}

/** The sentence printed after a successful import, naming what this particular source could not
 * know — so nobody ships the output believing it is finished. */
const CAVEATS: Record<ImportSource, string> = {
  "github-org": "every team defaulted to type: stream-aligned with no roles[]",
  backstage: "team types are guessed from spec.type; roles[], cognitive load and interactions are empty",
  okta: "a directory group knows who is in it and nothing else — no roles[], services or team type",
  slack: "channels give you names and topics only; members were deliberately not imported",
  csv: "roles came from the job-title column; team types, services and interactions are empty",
};

/**
 * Bootstraps `teamapi.yml` documents from an existing system.
 *
 * Five sources rather than one, because the first question any org asks is "do we have to type all
 * of this", and the honest answer depends entirely on what they already have. Backstage and an
 * HRIS export are the two that get a real org populated; the directory is the one that scales to
 * hundreds of teams; Slack is the weakest and still the only one that works for an org whose list
 * of teams exists nowhere but a channel sidebar.
 *
 * Every source produces documents that are deliberately incomplete in the same way: nothing
 * outside the source is invented. What each one could not know is printed after the run.
 */
export async function runImport(source: ImportSource, argument: string, options: ImportOptions): Promise<number> {
  let imported: ImportedTeam[];
  try {
    imported = await collect(source, argument, options);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  if (imported.length === 0) {
    console.error(`No teams found via '${source}' (or the credentials supplied lack access to them).`);
    return 1;
  }

  for (const { teamId, document } of imported) {
    const dir = path.join(options.out, teamId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "teamapi.yml"), YAML.dump(document, { lineWidth: -1, noRefs: true }), "utf-8");
  }

  console.log(
    `Wrote ${imported.length} team(s) to ${options.out}/ — ${CAVEATS[source]}. ` +
      "Review by hand, then run `teamapi validate`.",
  );
  return 0;
}
