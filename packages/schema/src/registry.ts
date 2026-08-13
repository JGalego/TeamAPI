import { z } from "zod";
import { TeamApiDocumentSchema } from "./v1/team";

/**
 * Registry of supported `teamApiVersion` values to their Zod schema, for forward compatibility.
 *
 * Split out of `index.ts` so `migrate.ts` can read it without importing the package's own barrel,
 * which would be a cycle: the barrel re-exports the migration helpers.
 */
export const SCHEMA_REGISTRY = {
  "1.0.0": TeamApiDocumentSchema,
} as const;

export type SupportedTeamApiVersion = keyof typeof SCHEMA_REGISTRY;

export function isSupportedVersion(version: string): version is SupportedTeamApiVersion {
  return version in SCHEMA_REGISTRY;
}

/** Resolves the Zod schema for a raw document's declared `teamApiVersion`, if supported. */
export function resolveSchemaForVersion(version: string): z.ZodTypeAny | undefined {
  return isSupportedVersion(version) ? SCHEMA_REGISTRY[version] : undefined;
}
