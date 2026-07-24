import { z } from "zod";
import { TeamTypeSchema } from "./primitives";

export const InfoSchema = z
  .object({
    name: z.string().min(1),
    focus: z.string().optional(),
    type: TeamTypeSchema,
  })
  .passthrough();
export type Info = z.infer<typeof InfoSchema>;
