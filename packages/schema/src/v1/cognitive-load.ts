import { z } from "zod";

/**
 * Inspired by TeamTopologies/Team-Cognitive-Load-Assessment: a lightweight 1-10 self-assessment
 * across the three cognitive load types described in _Team Topologies_.
 */
export const CognitiveLoadAssessmentSchema = z
  .object({
    intrinsic: z.number().min(1).max(10),
    extraneous: z.number().min(1).max(10),
    germane: z.number().min(1).max(10),
    notes: z.string().optional(),
    assessedOn: z.string().optional(),
  })
  .passthrough();
export type CognitiveLoadAssessment = z.infer<typeof CognitiveLoadAssessmentSchema>;
