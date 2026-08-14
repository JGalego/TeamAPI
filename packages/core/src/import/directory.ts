import type { DirectoryGroup } from "../apply/okta-drift";
import type { SlackChannel } from "../apply/slack";
import { toSlug } from "./backstage";
import type { ImportedTeam } from "./github-org";

export interface DirectoryImportOptions {
  /** Strip this from group names before they become team ids — orgs prefix directory groups with
   * things like `eng-` or `team-`, and `teamapi okta-drift` already takes the same option, so the
   * two commands agree about which group is which team. */
  groupPrefix?: string;
  /** Skip groups with fewer than this many members. Directories are full of one-person groups that
   * are access-control artefacts rather than teams. Defaults to 2. */
  minMembers?: number;
}

const DEFAULT_MIN_MEMBERS = 2;

/** An email local-part is the closest thing a directory has to a stable person id. */
function memberIdFrom(email: string, fallbackIndex: number): string {
  const local = email.split("@")[0] ?? "";
  return toSlug(local) || `member-${fallbackIndex}`;
}

/**
 * Bootstraps Team API documents from a directory's groups — Okta, Entra, or anything else that can
 * produce `{ name, members: [{ email, displayName, status }] }`.
 *
 * The directory is where most orgs' membership actually lives, and it is the answer to "how do we
 * populate four hundred teams without typing them". It is also the least opinionated source there
 * is: a directory group knows who is in it and nothing about what they do, so every document comes
 * out with the right people and no roles, no services, and a defaulted team type.
 *
 * Deactivated accounts are dropped rather than imported. `okta-drift` reports them as findings on
 * an existing org because a name still listed on a team that has left is the dangerous case; on a
 * fresh import there is nothing to report against, and starting a new document with people who no
 * longer work here would create the exact drift the tool exists to catch.
 */
export function importDirectoryGroups(groups: DirectoryGroup[], options: DirectoryImportOptions = {}): ImportedTeam[] {
  const prefix = options.groupPrefix ?? "";
  const minMembers = options.minMembers ?? DEFAULT_MIN_MEMBERS;

  return groups
    .map((group) => {
      const bare = prefix && group.name.startsWith(prefix) ? group.name.slice(prefix.length) : group.name;
      const teamId = toSlug(bare);
      const members = group.members
        .filter((member) => (member.status ?? "ACTIVE").toUpperCase() === "ACTIVE")
        .sort((a, b) => a.email.localeCompare(b.email))
        .map((member, index) => ({
          id: memberIdFrom(member.email, index),
          name: member.displayName ?? member.email,
          contact: member.email,
          roleIds: [] as string[],
        }));
      return { teamId, groupName: group.name, members };
    })
    .filter((entry) => entry.members.length >= minMembers)
    .sort((a, b) => a.teamId.localeCompare(b.teamId))
    .map(({ teamId, groupName, members }) => ({
      teamId,
      document: {
        teamApiVersion: "1.0.0",
        id: teamId,
        info: { name: groupName, type: "stream-aligned" },
        roles: [],
        members,
      },
    }));
}

export interface SlackImportOptions {
  /** Strip this prefix from channel names before they become team ids. */
  channelPrefix?: string;
  /** Only channels matching this regular expression. Most workspaces have far more channels than
   * teams, and there is usually a naming convention that separates them. */
  channelPattern?: RegExp;
}

/**
 * Bootstraps Team API documents from Slack channels.
 *
 * The weakest of the importers, and it earns its place anyway: in a great many orgs the honest
 * list of teams is the list of channels, and nobody has written it down anywhere else. What comes
 * out is a skeleton — a team id, a name, the channel it is reachable on, and the topic as its
 * focus — which is precisely the part that is tedious to type and the part that is least likely to
 * be wrong.
 *
 * Members are deliberately not imported even though the API can list them. A Slack channel's
 * membership is not a team: it includes everybody who ever wanted visibility, and importing it
 * would produce documents whose `members[]` are wrong in a way that looks authoritative.
 */
export function importSlackChannels(channels: SlackChannel[], options: SlackImportOptions = {}): ImportedTeam[] {
  const prefix = options.channelPrefix ?? "";

  return channels
    .map((channel) => channel.name.replace(/^#/, ""))
    .filter((name) => (options.channelPattern ? options.channelPattern.test(name) : true))
    .map((name) => {
      const bare = prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
      return { teamId: toSlug(bare), channelName: name };
    })
    .filter((entry) => entry.teamId.length > 0)
    .sort((a, b) => a.teamId.localeCompare(b.teamId))
    .map(({ teamId, channelName }) => {
      const topic = channels.find((channel) => channel.name.replace(/^#/, "") === channelName)?.topic?.trim();
      return {
        teamId,
        document: {
          teamApiVersion: "1.0.0",
          id: teamId,
          info: {
            // Title-cased from the slug: a channel name is lowercase-hyphenated and a display name
            // is not, and "Stream Checkout" is a better starting point to edit than "stream-checkout".
            name: teamId
              .split("-")
              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(" "),
            ...(topic ? { focus: topic } : {}),
            type: "stream-aligned",
          },
          channels: [{ type: "slack", name: channelName }],
          roles: [],
          members: [],
        },
      };
    });
}
