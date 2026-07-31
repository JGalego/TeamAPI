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
    /**
     * Load from supervising AI agents: reviewing what they produce, maintaining their prompts,
     * being the person everyone asks. Optional, and deliberately **not** part of `total`.
     *
     * The three types above come from _Team Topologies_ and their sum is what the `label`
     * thresholds are calibrated against; folding a fourth term in would silently re-label every
     * team that adopted one. Supervision is reported alongside instead, so it can be read, sorted
     * and alerted on without moving a number other things already depend on.
     *
     * It is a separate term rather than part of `extraneous` because it isn't necessarily
     * avoidable overhead — reviewing an agent's output is often the work, not friction around it.
     */
    supervision: z.number().min(1).max(10).optional(),
    notes: z.string().optional(),
    assessedOn: z.string().optional(),
  })
  .passthrough();
export type CognitiveLoadAssessment = z.infer<typeof CognitiveLoadAssessmentSchema>;
