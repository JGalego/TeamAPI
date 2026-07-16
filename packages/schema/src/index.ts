import { z } from "zod";
import { TeamApiDocumentSchema } from "./v1/team";

export * from "./v1";
export * as v1 from "./v1";
export { getTeamApiJsonSchema } from "./json-schema";

/** Registry of supported `teamApiVersion` values to their Zod schema, for forward compatibility. */
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
