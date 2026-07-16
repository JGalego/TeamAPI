import { z } from "zod";

export const VersioningSchema = z
  .object({
    type: z.string().min(1),
  })
  .passthrough();
export type Versioning = z.infer<typeof VersioningSchema>;

const UbiquitousLanguageTermSchema = z
  .object({
    term: z.string().min(1),
    definition: z.string().min(1),
  })
  .passthrough();

/**
 * DDD annotations for a service, describing it as a bounded context: its ubiquitous language,
 * the aggregates it owns, and the domain events it publishes/subscribes to.
 */
export const BoundedContextSchema = z
  .object({
    ubiquitousLanguage: z.array(UbiquitousLanguageTermSchema).default([]),
    aggregates: z.array(z.string().min(1)).default([]),
    publishedEvents: z.array(z.string().min(1)).default([]),
    subscribedEvents: z.array(z.string().min(1)).default([]),
  })
  .passthrough();
export type BoundedContext = z.infer<typeof BoundedContextSchema>;

export const ServiceSchema = z
  .object({
    name: z.string().min(1),
    url: z.string().optional(),
    versioning: VersioningSchema.optional(),
    repository: z.string().optional(),
    boundedContext: BoundedContextSchema.optional(),
  })
  .passthrough();
export type Service = z.infer<typeof ServiceSchema>;
