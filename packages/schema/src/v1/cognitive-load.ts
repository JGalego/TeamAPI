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
     * being the person everyone asks. Optional, and deliberately **not** part of `total` — but it
     * does affect the `label`.
     *
     * Those are two different questions. The three types above come from _Team Topologies_ and
     * their sum is what the thresholds are calibrated against, so summing a fourth term would
     * re-scale `total` for every team that adopted an agent. But `scoreCognitiveLoad` already
     * decides the label from independent triggers rather than the total alone, and supervision is
     * one of them: a team drowning in agent review must not be able to report "sustainable"
     * because its other three scores are modest. A team that hasn't scored this is unaffected.
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
