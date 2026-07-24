import { z } from "zod";
import { checkUniqueIds, SlugSchema } from "./primitives";

export const WorkflowStateSchema = z
  .object({
    id: SlugSchema,
    name: z.string().min(1),
    description: z.string().optional(),
  })
  .passthrough();
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export const WorkflowTransitionSchema = z
  .object({
    from: SlugSchema,
    to: SlugSchema,
    trigger: z.string().min(1),
  })
  .passthrough();
export type WorkflowTransition = z.infer<typeof WorkflowTransitionSchema>;

export const WorkflowAutomationSchema = z
  .object({
    trigger: z.string().min(1),
    action: z.string().min(1),
  })
  .passthrough();
export type WorkflowAutomation = z.infer<typeof WorkflowAutomationSchema>;

/**
 * A workflow independent of any particular CI/CD system — a state machine (`states[]` +
 * `transitions[]`) describing a process like a release (testing -> approval -> deployment ->
 * announcement). `automation[]` names the hooks that drive transitions in the real world;
 * executing them is an external-tooling concern, not this schema's.
 */
export const WorkflowSchema = z
  .object({
    id: SlugSchema,
    name: z.string().min(1),
    description: z.string().optional(),
    states: z.array(WorkflowStateSchema).default([]),
    transitions: z.array(WorkflowTransitionSchema).default([]),
    automation: z.array(WorkflowAutomationSchema).default([]),
    tags: z.array(z.string().min(1)).default([]),
  })
  .passthrough()
  .superRefine((workflow, ctx) => {
    const stateIds = new Set(workflow.states.map((s) => s.id));
    workflow.transitions.forEach((transition, i) => {
      if (!stateIds.has(transition.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `transitions[${i}].from '${transition.from}' does not match any state id in this workflow's states[]`,
          path: ["transitions", i, "from"],
        });
      }
      if (!stateIds.has(transition.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `transitions[${i}].to '${transition.to}' does not match any state id in this workflow's states[]`,
          path: ["transitions", i, "to"],
        });
      }
    });
  });
export type Workflow = z.infer<typeof WorkflowSchema>;

export const WorkflowsSchema = z
  .array(WorkflowSchema)
  .default([])
  .superRefine((workflows, ctx) => checkUniqueIds(workflows.map((w) => w.id), ctx, "a team's workflows[]"));
