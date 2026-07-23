import { z } from "zod";

/** Stable slug used for cross-file `$ref` linking (not a display name). */
export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be a lowercase kebab-case slug, e.g. 'stream-checkout'");
export type Slug = z.infer<typeof SlugSchema>;

/** A reference to another team's document, or a supporting resource, by URI or relative file path. */
export const RefSchema = z
  .object({
    $ref: z.string().min(1),
  })
  .passthrough();
export type Ref = z.infer<typeof RefSchema>;

export const TeamTypeSchema = z.enum([
  "stream-aligned",
  "platform",
  "complicated-subsystem",
  "enabling",
]);
export type TeamType = z.infer<typeof TeamTypeSchema>;

/** Team Topologies interaction modes (canonical lowercase-kebab casing for this extended schema). */
export const InteractionModeSchema = z.enum(["collaboration", "x-as-a-service", "facilitating"]);
export type InteractionMode = z.infer<typeof InteractionModeSchema>;

export const DependencyTypeSchema = z.enum(["OK", "Slowing", "Blocking"]);
export type DependencyType = z.infer<typeof DependencyTypeSchema>;

export const DurationUnitSchema = z.enum(["days", "weeks", "months"]);
export type DurationUnit = z.infer<typeof DurationUnitSchema>;

/**
 * DDD context-mapping patterns, layered on top of `InteractionMode` when a team wants to be
 * explicit about the technical relationship rather than relying on the mode->pattern heuristic.
 */
export const ContextMappingPatternSchema = z.enum([
  "Partnership",
  "CustomerSupplier",
  "Conformist",
  "OpenHostService",
  "AnticorruptionLayer",
  "SharedKernel",
]);
export type ContextMappingPattern = z.infer<typeof ContextMappingPatternSchema>;

/** Suggested (non-exhaustive) role kinds, offered for editor autocompletion; `roles[].kind` accepts any string. */
export const SUGGESTED_ROLE_KINDS = [
  "ProductManager",
  "TechLead",
  "EngineeringManager",
  "Engineer",
  "Designer",
  "SRE",
  "DataScientist",
  "DomainExpert",
  "DeliveryLead",
] as const;

export const RoleKindSchema = z.string().min(1);
export type RoleKind = z.infer<typeof RoleKindSchema>;
