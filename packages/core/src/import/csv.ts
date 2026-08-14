import { toSlug } from "./backstage";
import type { ImportedTeam } from "./github-org";

/**
 * The columns this reads, and the header spellings it accepts for each.
 *
 * Several spellings per column because the file is nearly always an export from an HRIS, and
 * "Work Email", "email_address" and "Email" are the same column in three different systems.
 * Rejecting one of them would mean asking somebody to edit a 4,000-row export by hand before
 * a tool they have not decided to adopt yet will look at it.
 */
const COLUMNS = {
  team: ["team", "team name", "department", "org unit", "organization", "group"],
  teamId: ["team id", "team_id", "teamid", "team slug"],
  name: ["name", "full name", "employee name", "display name"],
  email: ["email", "work email", "email address", "email_address", "primary email"],
  role: ["role", "job title", "title", "position"],
  roleKind: ["role kind", "role_kind", "job family", "discipline"],
  manager: ["manager", "manager email", "reports to", "manager_email"],
  github: ["github", "github username", "github_username", "github handle"],
} as const;

type ColumnKey = keyof typeof COLUMNS;

/**
 * A minimal RFC 4180 reader: quoted fields, embedded commas and newlines, doubled quotes.
 *
 * Written out rather than pulled in from a dependency because it is forty lines and the
 * alternative is a runtime dependency in a package whose whole premise is being a pure function of
 * some YAML. Splitting on commas instead would corrupt every row containing a job title like
 * "Engineer, Payments", which is most HR exports.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cell) => cell.trim().length > 0));
}

/** Maps each known column to its index in the header row, by any of its accepted spellings. */
export function mapColumns(header: string[]): Partial<Record<ColumnKey, number>> {
  const normalised = header.map((cell) => cell.trim().toLowerCase().replace(/\s+/g, " "));
  const mapping: Partial<Record<ColumnKey, number>> = {};
  for (const [key, spellings] of Object.entries(COLUMNS) as Array<[ColumnKey, readonly string[]]>) {
    const index = normalised.findIndex((cell) => spellings.includes(cell));
    if (index !== -1) mapping[key] = index;
  }
  return mapping;
}

export class CsvImportError extends Error {}

export interface CsvImportOptions {
  /** Default team type for every imported team. An HRIS has no Team Topologies column. */
  defaultType?: string;
}

/**
 * Bootstraps Team API documents from one row per person — an HRIS export, or a spreadsheet.
 *
 * This is the importer for the org that has no Backstage, no directory API it can reach, and a
 * CSV somebody in HR can produce in a minute. It is also the only importer that can populate
 * `roles[]`, because a job-title column is the one place an org routinely writes down what a
 * person's *position* is rather than only who they are — which is exactly the distinction this
 * schema is built around.
 *
 * A role is created per distinct title per team, and every person holding that title is assigned
 * to it. Job-sharing therefore comes out correct for free, which is the case a role-per-person
 * model gets wrong.
 */
export function importCsvRoster(text: string, options: CsvImportOptions = {}): ImportedTeam[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new CsvImportError("The CSV has no data rows.");

  const columns = mapColumns(rows[0]!);
  if (columns.team === undefined && columns.teamId === undefined) {
    throw new CsvImportError(
      `No team column found. Expected one of: ${[...COLUMNS.team, ...COLUMNS.teamId].join(", ")}. ` +
        `Found: ${rows[0]!.join(", ")}`,
    );
  }
  if (columns.name === undefined && columns.email === undefined) {
    throw new CsvImportError(
      `No person column found. Expected a name or an email: ${[...COLUMNS.name, ...COLUMNS.email].join(", ")}.`,
    );
  }

  const cell = (row: string[], key: ColumnKey): string | undefined => {
    const index = columns[key];
    if (index === undefined) return undefined;
    // An empty cell reads as absent, not as an empty string: an HRIS export pads every row to
    // the full column count, so a blank is the normal way a value is missing.
    const value = row[index]?.trim() ?? "";
    return value.length > 0 ? value : undefined;
  };

  interface Draft {
    teamId: string;
    displayName: string;
    members: Array<{ id: string; name: string; contact?: string; githubUsername?: string; roleIds: string[] }>;
    roles: Map<string, { id: string; name: string; kind: string }>;
  }
  const teams = new Map<string, Draft>();

  for (const row of rows.slice(1)) {
    const teamLabel = cell(row, "teamId") ?? cell(row, "team");
    if (!teamLabel) continue;
    const teamId = toSlug(teamLabel);
    if (!teamId) continue;

    const email = cell(row, "email");
    const personName = cell(row, "name") ?? email;
    if (!personName) continue;

    const draft = teams.get(teamId) ?? {
      teamId,
      displayName: cell(row, "team") ?? teamLabel,
      members: [],
      roles: new Map<string, { id: string; name: string; kind: string }>(),
    };

    const roleTitle = cell(row, "role");
    const roleIds: string[] = [];
    if (roleTitle) {
      const roleId = toSlug(roleTitle);
      if (!draft.roles.has(roleId)) {
        // One role per distinct title, shared by everybody holding it — so a job-shared position
        // comes out as one role with two members, which is the shape the schema is built for.
        draft.roles.set(roleId, { id: roleId, name: roleTitle, kind: cell(row, "roleKind") ?? roleTitle });
      }
      roleIds.push(roleId);
    }

    // An email is the only column that is reliably unique; a name is not, and two people called
    // Alex Chen on one team would otherwise collide into one member.
    const memberId = toSlug(email?.split("@")[0] ?? personName);
    const existing = draft.members.find((member) => member.id === memberId);
    if (existing) {
      for (const roleId of roleIds) if (!existing.roleIds.includes(roleId)) existing.roleIds.push(roleId);
    } else {
      draft.members.push({
        id: memberId || `member-${draft.members.length}`,
        name: personName,
        ...(email ? { contact: email } : {}),
        ...(cell(row, "github") ? { githubUsername: cell(row, "github")! } : {}),
        roleIds,
      });
    }

    teams.set(teamId, draft);
  }

  if (teams.size === 0) throw new CsvImportError("No rows named both a team and a person.");

  return [...teams.values()]
    .sort((a, b) => a.teamId.localeCompare(b.teamId))
    .map((draft) => ({
      teamId: draft.teamId,
      document: {
        teamApiVersion: "1.0.0",
        id: draft.teamId,
        info: { name: draft.displayName, type: options.defaultType ?? "stream-aligned" },
        roles: [...draft.roles.values()].sort((a, b) => a.id.localeCompare(b.id)),
        members: draft.members.sort((a, b) => a.id.localeCompare(b.id)),
      },
    }));
}
