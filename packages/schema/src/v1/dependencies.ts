import { z } from "zod";
import { DependencyTypeSchema, RefSchema } from "./primitives";

export const DependencySchema = RefSchema.extend({
  teamName: z.string().min(1),
  description: z.string().optional(),
  type: DependencyTypeSchema,
}).passthrough();
export type Dependency = z.infer<typeof DependencySchema>;
