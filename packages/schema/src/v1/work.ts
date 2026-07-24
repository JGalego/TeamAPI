import { z } from "zod";

/** `$ref` is optional here (unlike `interactions[]`/`dependencies[]`): a work item may just be
 * named without a resolvable link to a repo, wiki page, or other team's document. */
const NamedRefSchema = z
  .object({
    name: z.string().min(1),
    $ref: z.string().optional(),
  })
  .passthrough();

export const WorkSchema = z
  .object({
    services: z.array(NamedRefSchema).default([]),
    waysOfWorking: z.array(NamedRefSchema).default([]),
    crossTeam: z.array(NamedRefSchema).default([]),
  })
  .passthrough();
export type Work = z.infer<typeof WorkSchema>;
