import { z } from "zod";
import { SlugSchema } from "./primitives";
import { InfoSchema } from "./info";
import { ChannelSchema, PlatformSchema, SearchTermSchema } from "./misc";
import { ServiceSchema } from "./services";
import { WorkSchema } from "./work";
import { MeetingSchema } from "./meetings";
import { InteractionSchema } from "./interactions";
import { DependencySchema } from "./dependencies";
import { MembersSchema, RolesSchema } from "./roles";
import { CognitiveLoadAssessmentSchema } from "./cognitive-load";
import { AgentsSchema } from "./agents";
import { MemorySchema } from "./memory";
import { SpecificationsSchema } from "./specifications";
import { SteeringDocumentsSchema } from "./steering";
import { PromptsSchema } from "./prompts";
import { PlaybooksSchema } from "./playbooks";
import { PoliciesSchema } from "./policies";
import { KnowledgeBaseSchema } from "./knowledge-base";
import { WorkflowsSchema } from "./workflows";
import { AiSessionsSchema } from "./sessions";

/**
 * Root document schema for the extended Team API as Code spec (v1).
 *
 * `teamApiVersion` deliberately does not reuse the upstream `teamapi:` field name: that field
 * versions the base TeamAPI-As-Code spec, while this is a separate, non-strictly-backwards-
 * compatible extension, and conflating the two would make version negotiation ambiguous for
 * tooling that only understands one or the other.
 */
export const TeamApiDocumentSchema = z
  .object({
    teamApiVersion: z.literal("1.0.0"),
    id: SlugSchema,
    info: InfoSchema,
    channels: z.array(ChannelSchema).default([]),
    searchTerms: z.array(SearchTermSchema).default([]),
    platform: PlatformSchema.optional(),
    services: z.array(ServiceSchema).default([]),
    work: WorkSchema.optional(),
    roles: RolesSchema,
    members: MembersSchema,
    cognitiveLoad: CognitiveLoadAssessmentSchema.optional(),
    meetings: z.array(MeetingSchema).default([]),
    interactions: z.array(InteractionSchema).default([]),
    dependencies: z.array(DependencySchema).default([]),
    // AI-native knowledge & collaboration additions (all additive/optional — a document with none
    // of these still validates identically to before they existed).
    agents: AgentsSchema,
    memory: MemorySchema,
    specifications: SpecificationsSchema,
    steeringDocuments: SteeringDocumentsSchema,
    prompts: PromptsSchema,
    playbooks: PlaybooksSchema,
    policies: PoliciesSchema,
    knowledgeBase: KnowledgeBaseSchema,
    workflows: WorkflowsSchema,
    sessions: AiSessionsSchema,
  })
  .passthrough();
export type TeamApiDocument = z.infer<typeof TeamApiDocumentSchema>;
