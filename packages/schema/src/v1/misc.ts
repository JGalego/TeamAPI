import { z } from "zod";
import { RefSchema } from "./primitives";

export const ChannelSchema = z
  .object({
    type: z.string().min(1),
    name: z.string().min(1),
  })
  .passthrough();
export type Channel = z.infer<typeof ChannelSchema>;

export const SearchTermSchema = z
  .object({
    term: z.string().min(1),
  })
  .passthrough();
export type SearchTerm = z.infer<typeof SearchTermSchema>;

/** Present when this team is part of a wider platform; `$ref` points at the platform team's document. */
export const PlatformSchema = RefSchema;
export type Platform = z.infer<typeof PlatformSchema>;
