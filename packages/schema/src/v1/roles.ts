import { z } from "zod";
import { RefSchema, RoleKindSchema, SlugSchema } from "./primitives";

/** A reference to another team's role, by team document `$ref` plus that team's `roles[].id`.
 * `teamName` mirrors `Interaction`/`Dependency`'s convention of keeping a human-readable label
 * inline alongside the `$ref`, so the target is legible without resolving the reference. */
export const RoleRefSchema = RefSchema.extend({
  teamName: z.string().min(1),
  roleId: SlugSchema,
}).passthrough();
export type RoleRef = z.infer<typeof RoleRefSchema>;

/** A responsibility can be a plain string, or — when a consumer like the CrewAI generator needs
 * to know what "done" looks like — an object pairing the responsibility with an optional
 * `doneWhen`. Both forms are valid; `doneWhen` is never required, since most consumers (diagrams,
 * REST API, MCP tools) have no use for it. */
export const ResponsibilitySchema = z.union([
  z.string().min(1),
  z
    .object({
      text: z.string().min(1),
      doneWhen: z.string().min(1).optional(),
    })
    .passthrough(),
]);
export type Responsibility = z.infer<typeof ResponsibilitySchema>;

/** Reads a `Responsibility`'s text regardless of which of its two forms was used. */
export function responsibilityText(responsibility: Responsibility): string {
  return typeof responsibility === "string" ? responsibility : responsibility.text;
}

/** Reads a `Responsibility`'s `doneWhen`, if any was declared. */
export function responsibilityDoneWhen(responsibility: Responsibility): string | undefined {
  return typeof responsibility === "string" ? undefined : responsibility.doneWhen;
}

/**
 * A role is a position/function within the team (e.g. "Payments Tech Lead"), independent of who
 * (if anyone) currently fills it. Keeping roles and people separate lets a role stay vacant, be
 * job-shared by multiple members, or be held by one member alongside other roles.
 */
export const RoleSchema = z
  .object({
    id: SlugSchema,
    name: z.string().min(1),
    kind: RoleKindSchema,
    responsibilities: z.array(ResponsibilitySchema).default([]),
    reportsTo: SlugSchema.optional(),
    /** Formal reporting line to a role on another team, e.g. a tech lead reporting to a
     * cross-team engineering manager. Mutually exclusive with `reportsTo`: a role reports to
     * exactly one manager, same-team or not, and setting both is rejected below. */
    reportsToRef: RoleRefSchema.optional(),
    /** Dotted-line / matrix relationships that aren't formal reporting — e.g. a community of
     * practice lead a role coordinates with, same-team or cross-team. */
    alignsWith: z.array(RoleRefSchema).default([]),
  })
  .passthrough()
  .superRefine((role, ctx) => {
    if (role.reportsTo !== undefined && role.reportsToRef !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reportsTo and reportsToRef are mutually exclusive: a role reports to exactly one manager",
        path: ["reportsToRef"],
      });
    }
  });
export type Role = z.infer<typeof RoleSchema>;

export const RolesSchema = z
  .array(RoleSchema)
  .default([])
  .superRefine((roles, ctx) => {
    const seenIds = new Set<string>();
    for (let i = 0; i < roles.length; i++) {
      const id = roles[i]!.id;
      if (seenIds.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate role id '${id}': role ids must be unique within a team's roles[]`,
          path: [i, "id"],
        });
      }
      seenIds.add(id);
    }

    const reportsToById = new Map(roles.map((role) => [role.id, role.reportsTo]));
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i]!;
      if (role.reportsTo === undefined) continue;

      if (!reportsToById.has(role.reportsTo)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `reportsTo '${role.reportsTo}' does not match any role id in this team's roles[]`,
          path: [i, "reportsTo"],
        });
        continue;
      }

      // Walk the same-team reportsTo chain looking for a cycle back to this role (including a
      // role reporting to itself).
      const chain = new Set([role.id]);
      let cursor: string | undefined = role.reportsTo;
      for (let steps = 0; steps < roles.length && cursor !== undefined; steps++) {
        if (chain.has(cursor)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `reportsTo cycle detected: ${[...chain, cursor].join(" -> ")}`,
            path: [i, "reportsTo"],
          });
          break;
        }
        chain.add(cursor);
        cursor = reportsToById.get(cursor);
      }
    }
  });

/** A person on the team, optionally assigned to one or more `roles[]` by id. */
export const MemberSchema = z
  .object({
    id: SlugSchema,
    name: z.string().min(1),
    contact: z.string().optional(),
    roleIds: z.array(SlugSchema).default([]),
    allocation: z.number().min(0).max(100).optional(),
    /** GitHub login, used to resolve this member to a real account for `teamapi apply`/`import`. */
    githubUsername: z.string().optional(),
  })
  .passthrough();
export type Member = z.infer<typeof MemberSchema>;

export const MembersSchema = z
  .array(MemberSchema)
  .default([])
  .superRefine((members, ctx) => {
    const seenIds = new Set<string>();
    for (let i = 0; i < members.length; i++) {
      const id = members[i]!.id;
      if (seenIds.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate member id '${id}': member ids must be unique within a team's members[]`,
          path: [i, "id"],
        });
      }
      seenIds.add(id);
    }
  });
