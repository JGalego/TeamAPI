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

/**
 * Canonical URL the generated schema is published at, served from `site/` via GitHub Pages.
 *
 * Versioned in the path (`/v1.json`) rather than by content negotiation or a query string: an
 * editor pins this string in a file it never re-reads, so the URL for a given `teamApiVersion`
 * has to keep meaning the same thing forever. A `2.0.0` schema becomes `/v2.json` rather than
 * changing what this one serves.
 */
export const TEAM_API_SCHEMA_URL = "https://teamapi.dev/schema/v1.json";

/**
 * The `yaml-language-server` modeline that binds a `teamapi.yml` to the published schema, giving
 * editors (VS Code, Neovim, JetBrains — anything speaking the YAML language server protocol)
 * completion and inline validation with no per-workspace configuration.
 *
 * It is a comment, so it is invisible to `js-yaml` and every consumer downstream of it: a
 * document carrying it parses identically to one that doesn't.
 */
export const TEAM_API_SCHEMA_MODELINE = `# yaml-language-server: $schema=${TEAM_API_SCHEMA_URL}`;

/**
 * The v1 document schema as JSON Schema draft-07.
 *
 * `$id` is set to the canonical published URL so the document self-identifies once downloaded —
 * a schema cached by an editor, vendored into another repo, or served from a mirror still names
 * where it came from, and relative `$ref`s inside it resolve against the right base.
 */
export function getTeamApiJsonSchema(): Record<string, unknown> {
  return { $id: TEAM_API_SCHEMA_URL, ...toJsonSchema(TeamApiDocumentSchema, "TeamApiDocument") };
}
