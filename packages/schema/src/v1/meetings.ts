import { z } from "zod";

export const MeetingSchema = z
  .object({
    purpose: z.string().min(1),
    dayOfWeek: z.string().optional(),
    timeOfDay: z.string().optional(),
    durationMinutes: z.number().int().positive().optional(),
  })
  .passthrough();
export type Meeting = z.infer<typeof MeetingSchema>;
