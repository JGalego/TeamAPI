/** Shared OpenAPI response schema for this API's error bodies (`{ error: string }`), so the
 * generated spec at `/docs`/`/docs/json` documents the 400/404 paths every route can actually
 * take, not just its success body. */
export const errorResponseSchema = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
} as const;
