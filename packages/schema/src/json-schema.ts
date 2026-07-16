import { zodToJsonSchema } from "zod-to-json-schema";
import { TeamApiDocumentSchema } from "./v1/team";

/**
 * JSON Schema export of the v1 document schema, for editor tooling (YAML language server, etc).
 *
 * `zodToJsonSchema` is called through a simplified, non-generic call signature: invoking it
 * directly against our deeply nested `.passthrough()` object schema (many `.optional()`/
 * `.default()`/`.extend()` fields) makes the TS compiler try to structurally resolve the schema's
 * full literal type against the library's generic parameter, which hits TS2589 ("type
 * instantiation is excessively deep"). Erasing the call signature sidesteps that resolution
 * entirely; the runtime behavior of the call is unchanged.
 */
const toJsonSchema = zodToJsonSchema as (schema: unknown, name?: string) => Record<string, unknown>;

export function getTeamApiJsonSchema(): Record<string, unknown> {
  return toJsonSchema(TeamApiDocumentSchema, "TeamApiDocument");
}
