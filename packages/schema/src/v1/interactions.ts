import { z } from "zod";
import { ContextMappingPatternSchema, DurationUnitSchema, InteractionModeSchema, RefSchema } from "./primitives";

export const InteractionSchema = RefSchema.extend({
  teamName: z.string().min(1),
  mode: InteractionModeSchema,
  purpose: z.string().optional(),
  startDate: z.string().optional(),
  expectedDuration: z.number().positive().optional(),
  expectedDurationUnit: DurationUnitSchema.optional(),
  /** Explicit DDD context-mapping pattern; if omitted, `core` derives a suggestion from `mode`. */
  contextMappingPattern: ContextMappingPatternSchema.optional(),
}).passthrough();
export type Interaction = z.infer<typeof InteractionSchema>;
