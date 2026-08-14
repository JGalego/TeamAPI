import * as fs from "node:fs";
import * as path from "node:path";

export interface SyntheticOrgOptions {
  /** Total number of teams. */
  teams: number;
  /** How many stream-aligned teams each platform team serves. Controls the graph's fan-out — and
   * therefore how wide a single BFS level gets, which is the thing parallel loading acts on. */
  fanOut?: number;
  /** Roles per team, each with a member. */
  rolesPerTeam?: number;
  /** Services per team. */
  servicesPerTeam?: number;
}

export interface SyntheticOrg {
  root: string;
  /** Every generated document, sorted. Pass as `seedUris`, or pass just `seeds[0]` to exercise
   * discovery through `$ref`s alone. */
  files: string[];
  /** The stream-aligned team documents, which reach every other team transitively. */
  streamFiles: string[];
}

/**
 * Writes a synthetic org of arbitrary size to `root`.
 *
 * The six example orgs top out at four teams, which says nothing about where resolution breaks:
 * a four-team graph has two BFS levels and resolves in single-digit milliseconds whether the
 * loader is serial or not. This produces the shape a real large org has — a handful of platform
 * teams each serving many stream-aligned teams, a wide enabling layer, cross-team reporting lines
 * and interactions — at whatever size the caller asks for.
 *
 * Deterministic: no randomness, so a benchmark run twice measures the code and not the fixture.
 */
export function generateSyntheticOrg(root: string, options: SyntheticOrgOptions): SyntheticOrg {
  const total = options.teams;
  const fanOut = options.fanOut ?? 12;
  const rolesPerTeam = options.rolesPerTeam ?? 4;
  const servicesPerTeam = options.servicesPerTeam ?? 3;

  // One enabling team, then enough platform teams to cover the rest at the requested fan-out.
  const platformCount = Math.max(1, Math.ceil((total - 2) / (fanOut + 1)));
  const streamCount = Math.max(1, total - platformCount - 1);

  const enablingId = "enabling-practice";
  const platformIds = Array.from({ length: platformCount }, (_, i) => `platform-${i}`);
  const streamIds = Array.from({ length: streamCount }, (_, i) => `stream-${i}`);

  const files: string[] = [];
  const write = (id: string, body: string): string => {
    const file = path.join(root, id, "teamapi.yml");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, "utf-8");
    files.push(file);
    return file;
  };

  const roles = (prefix: string, extra = ""): string =>
    Array.from(
      { length: rolesPerTeam },
      (_, i) =>
        `  - id: ${prefix}-role-${i}\n` +
        `    name: ${prefix} Role ${i}\n` +
        `    kind: Engineer\n` +
        `    responsibilities:\n` +
        `      - Owns ${prefix} concern ${i}\n` +
        (i > 0 ? `    reportsTo: ${prefix}-role-0\n` : "") +
        (i === 0 ? extra : ""),
    ).join("");

  const members = (prefix: string): string =>
    Array.from(
      { length: rolesPerTeam },
      (_, i) =>
        `  - id: ${prefix}-member-${i}\n` +
        `    name: Person ${prefix} ${i}\n` +
        `    contact: ${prefix}-${i}@example.com\n` +
        `    roleIds: [${prefix}-role-${i}]\n`,
    ).join("");

  const services = (prefix: string): string =>
    Array.from(
      { length: servicesPerTeam },
      (_, i) =>
        `  - name: ${prefix}-service-${i}\n` +
        `    repository: https://github.com/synthetic/${prefix}-service-${i}\n` +
        `    boundedContext:\n` +
        `      aggregates: [${prefix}Aggregate${i}]\n` +
        `      publishedEvents: [${prefix}Event${i}]\n` +
        `      subscribedEvents: []\n`,
    ).join("");

  const header = (id: string, name: string, type: string): string =>
    `teamApiVersion: "1.0.0"\nid: ${id}\ninfo:\n  name: ${name}\n  type: ${type}\n` +
    `cognitiveLoad:\n  intrinsic: 5\n  extraneous: 3\n  germane: 4\n  supervision: 2\n`;

  write(
    enablingId,
    header(enablingId, "Enabling Practice", "enabling") +
      `roles:\n${roles(enablingId)}` +
      `members:\n${members(enablingId)}`,
  );

  for (const platformId of platformIds) {
    write(
      platformId,
      header(platformId, `Platform ${platformId}`, "platform") +
        `services:\n${services(platformId)}` +
        `roles:\n${roles(platformId, `    alignsWith:\n      - teamName: Enabling Practice\n        roleId: ${enablingId}-role-0\n        $ref: ../${enablingId}/teamapi.yml\n`)}` +
        `members:\n${members(platformId)}`,
    );
  }

  const streamFiles: string[] = [];
  const peerStrides = [1, Math.max(2, Math.floor(streamCount / 3)), Math.max(3, Math.floor(streamCount / 7))];
  streamIds.forEach((streamId, index) => {
    const platformId = platformIds[index % platformIds.length]!;
    // Several peers, at spreading strides, rather than just the next team along. A next-neighbour
    // chain resolves as a chain — one or two documents per BFS level however many teams there are —
    // which would make a benchmark seeded from one document measure latency and nothing else. Real
    // orgs collaborate across the org, not only with their neighbour.
    const peerIds = [...new Set(peerStrides.map((stride) => streamIds[(index + stride) % streamIds.length]!))].filter(
      (peer) => peer !== streamId,
    );
    const body =
      header(streamId, `Stream ${streamId}`, "stream-aligned") +
      `platform:\n  $ref: ../${platformId}/teamapi.yml\n` +
      `services:\n${services(streamId)}` +
      `interactions:\n` +
      peerIds
        .map((peer) => `  - teamName: Stream ${peer}\n    mode: collaboration\n    $ref: ../${peer}/teamapi.yml\n`)
        .join("") +
      `dependencies:\n` +
      `  - teamName: Platform ${platformId}\n    type: OK\n    $ref: ../${platformId}/teamapi.yml\n` +
      `roles:\n${roles(
        streamId,
        `    reportsToRef:\n      teamName: Platform ${platformId}\n      roleId: ${platformId}-role-0\n      $ref: ../${platformId}/teamapi.yml\n`,
      )}` +
      `members:\n${members(streamId)}`;
    streamFiles.push(write(streamId, body));
  });

  return { root, files: [...files].sort(), streamFiles };
}
