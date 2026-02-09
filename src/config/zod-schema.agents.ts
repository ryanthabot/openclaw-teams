import { z } from "zod";
import { AgentDefaultsSchema } from "./zod-schema.agent-defaults.js";
import { AgentEntrySchema } from "./zod-schema.agent-runtime.js";
import { TranscribeAudioSchema } from "./zod-schema.core.js";

export const AgentsSchema = z
  .object({
    defaults: z.lazy(() => AgentDefaultsSchema).optional(),
    list: z.array(AgentEntrySchema).optional(),
  })
  .strict()
  .optional();

export const BindingsSchema = z
  .array(
    z
      .object({
        agentId: z.string(),
        match: z
          .object({
            channel: z.string(),
            accountId: z.string().optional(),
            peer: z
              .object({
                kind: z.union([z.literal("dm"), z.literal("group"), z.literal("channel")]),
                id: z.string(),
              })
              .strict()
              .optional(),
            guildId: z.string().optional(),
            teamId: z.string().optional(),
          })
          .strict(),
      })
      .strict(),
  )
  .optional();

export const BroadcastStrategySchema = z.enum(["parallel", "sequential"]);

export const BroadcastSchema = z
  .object({
    strategy: BroadcastStrategySchema.optional(),
  })
  .catchall(z.array(z.string()))
  .optional();

export const AudioSchema = z
  .object({
    transcription: TranscribeAudioSchema,
  })
  .strict()
  .optional();

export const TeamMemberSchema = z
  .object({
    role: z.string(),
    name: z.string().optional(),
    model: z.string().optional(),
    persona: z.string().optional(),
  })
  .strict();

export const TeamTemplateSchema = z
  .object({
    teamName: z.string(),
    teamLead: TeamMemberSchema,
    teammates: z.array(TeamMemberSchema),
    hooks: z.record(z.string(), z.string()).optional(),
    defaults: z
      .object({
        taskClaiming: z.enum(["self-claim", "assigned"]).optional(),
        displayMode: z.string().optional(),
        requirePlanApproval: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const TeamsSchema = z
  .object({
    templates: z.record(z.string(), TeamTemplateSchema).optional(),
  })
  .strict()
  .optional();
