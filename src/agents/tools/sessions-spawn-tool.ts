import { Type } from "@sinclair/typebox";
import crypto from "node:crypto";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import type { AnyAgentTool } from "./common.js";
import { formatThinkingLevels, normalizeThinkLevel } from "../../auto-reply/thinking.js";
import { loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import {
  isSubagentSessionKey,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../../routing/session-key.js";
import { normalizeDeliveryContext } from "../../utils/delivery-context.js";
import { canSpawnTier, hierarchyPathExists, resolveAgentConfig, resolveAgentTier, resolveAgentWorkspaceDir } from "../agent-scope.js";
import { AGENT_LANE_SUBAGENT } from "../lanes.js";
import { optionalStringEnum } from "../schema/typebox.js";
import { buildSubagentSystemPrompt } from "../subagent-announce.js";
import { registerSubagentRun } from "../subagent-registry.js";
import { jsonResult, readStringParam } from "./common.js";
import type { AgentTier } from "../../config/types.teams.js";
import { loadTierBootstrapFiles } from "../../teams/team-bootstrap.js";
import {
  resolveDisplaySessionKey,
  resolveInternalSessionKey,
  resolveMainSessionAlias,
} from "./sessions-helpers.js";

const SessionsSpawnToolSchema = Type.Object({
  task: Type.String(),
  label: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  runTimeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  // Back-compat alias. Prefer runTimeoutSeconds.
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  cleanup: optionalStringEnum(["delete", "keep"] as const),
  // Team context fields — set when spawning team agents
  teamTier: Type.Optional(Type.String()),
  teamProjectId: Type.Optional(Type.String()),
  teamName: Type.Optional(Type.String()),
  teamRole: Type.Optional(Type.String()),
  teamMemberName: Type.Optional(Type.String()),
  // Nested hierarchy fields — thread through spawn chain for containment
  teamManagerId: Type.Optional(Type.String()),
  teamLeadRole: Type.Optional(Type.String()),
  // The requester's own team tier — passed so subagent sessions can spawn children
  requesterTeamTier: Type.Optional(Type.String()),
});

function splitModelRef(ref?: string) {
  if (!ref) {
    return { provider: undefined, model: undefined };
  }
  const trimmed = ref.trim();
  if (!trimmed) {
    return { provider: undefined, model: undefined };
  }
  const [provider, model] = trimmed.split("/", 2);
  if (model) {
    return { provider, model };
  }
  return { provider: undefined, model: trimmed };
}

function normalizeModelSelection(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const primary = (value as { primary?: unknown }).primary;
  if (typeof primary === "string" && primary.trim()) {
    return primary.trim();
  }
  return undefined;
}

export function createSessionsSpawnTool(opts?: {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  sandboxed?: boolean;
  /** Explicit agent ID override for cron/hook sessions where session key parsing may not work. */
  requesterAgentIdOverride?: string;
}): AnyAgentTool {
  return {
    label: "Sessions",
    name: "sessions_spawn",
    description:
      "Spawn a background sub-agent run in an isolated session and announce the result back to the requester chat.",
    parameters: SessionsSpawnToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const task = readStringParam(params, "task", { required: true });
      const label = typeof params.label === "string" ? params.label.trim() : "";
      const requestedAgentId = readStringParam(params, "agentId");
      const modelOverride = readStringParam(params, "model");
      const thinkingOverrideRaw = readStringParam(params, "thinking");
      const cleanup =
        params.cleanup === "keep" || params.cleanup === "delete" ? params.cleanup : "keep";
      const requesterOrigin = normalizeDeliveryContext({
        channel: opts?.agentChannel,
        accountId: opts?.agentAccountId,
        to: opts?.agentTo,
        threadId: opts?.agentThreadId,
      });
      const runTimeoutSeconds = (() => {
        const explicit =
          typeof params.runTimeoutSeconds === "number" && Number.isFinite(params.runTimeoutSeconds)
            ? Math.max(0, Math.floor(params.runTimeoutSeconds))
            : undefined;
        if (explicit !== undefined) {
          return explicit;
        }
        const legacy =
          typeof params.timeoutSeconds === "number" && Number.isFinite(params.timeoutSeconds)
            ? Math.max(0, Math.floor(params.timeoutSeconds))
            : undefined;
        return legacy ?? 0;
      })();
      let modelWarning: string | undefined;
      let modelApplied = false;

      const cfg = loadConfig();
      const { mainKey, alias } = resolveMainSessionAlias(cfg);
      const requesterSessionKey = opts?.agentSessionKey;
      if (typeof requesterSessionKey === "string" && isSubagentSessionKey(requesterSessionKey)) {
        // Team agents (managers, team leads) are allowed to spawn from subagent sessions
        // to support the full hierarchy chain (GM -> Manager -> Team Lead -> Teammate).
        const reqTeamTier = readStringParam(params, "teamTier") as AgentTier | undefined;
        const requesterTeamTier = readStringParam(params, "requesterTeamTier") as AgentTier | undefined;
        const effectiveTier = requesterTeamTier || reqTeamTier;
        if (!effectiveTier || (effectiveTier !== "manager" && effectiveTier !== "team-lead")) {
          return jsonResult({
            status: "forbidden",
            error: "sessions_spawn is not allowed from sub-agent sessions",
          });
        }
      }
      const requesterInternalKey = requesterSessionKey
        ? resolveInternalSessionKey({
            key: requesterSessionKey,
            alias,
            mainKey,
          })
        : alias;
      const requesterDisplayKey = resolveDisplaySessionKey({
        key: requesterInternalKey,
        alias,
        mainKey,
      });

      const requesterAgentId = normalizeAgentId(
        opts?.requesterAgentIdOverride ?? parseAgentSessionKey(requesterInternalKey)?.agentId,
      );
      const targetAgentId = requestedAgentId
        ? normalizeAgentId(requestedAgentId)
        : requesterAgentId;
      if (targetAgentId !== requesterAgentId) {
        const allowAgents = resolveAgentConfig(cfg, requesterAgentId)?.subagents?.allowAgents ?? [];
        const allowAny = allowAgents.some((value) => value.trim() === "*");
        const normalizedTargetId = targetAgentId.toLowerCase();
        const allowSet = new Set(
          allowAgents
            .filter((value) => value.trim() && value.trim() !== "*")
            .map((value) => normalizeAgentId(value).toLowerCase()),
        );
        if (!allowAny && !allowSet.has(normalizedTargetId)) {
          const allowedText = allowAny
            ? "*"
            : allowSet.size > 0
              ? Array.from(allowSet).join(", ")
              : "none";
          return jsonResult({
            status: "forbidden",
            error: `agentId is not allowed for sessions_spawn (allowed: ${allowedText})`,
          });
        }
      }

      // Hierarchy-based spawn enforcement: if both agents have tiers, check permission
      const requesterTier = resolveAgentTier(cfg, requesterAgentId);
      const targetTier = resolveAgentTier(cfg, targetAgentId);
      if (requesterTier && targetTier && !canSpawnTier(requesterTier, targetTier)) {
        return jsonResult({
          status: "forbidden",
          error: `tier "${requesterTier}" cannot spawn tier "${targetTier}" (hierarchy violation)`,
        });
      }
      const childSessionKey = `agent:${targetAgentId}:subagent:${crypto.randomUUID()}`;
      const spawnedByKey = requesterInternalKey;
      const targetAgentConfig = resolveAgentConfig(cfg, targetAgentId);
      const resolvedModel =
        normalizeModelSelection(modelOverride) ??
        normalizeModelSelection(targetAgentConfig?.subagents?.model) ??
        normalizeModelSelection(cfg.agents?.defaults?.subagents?.model);

      const resolvedThinkingDefaultRaw =
        readStringParam(targetAgentConfig?.subagents ?? {}, "thinking") ??
        readStringParam(cfg.agents?.defaults?.subagents ?? {}, "thinking");

      let thinkingOverride: string | undefined;
      const thinkingCandidateRaw = thinkingOverrideRaw || resolvedThinkingDefaultRaw;
      if (thinkingCandidateRaw) {
        const normalized = normalizeThinkLevel(thinkingCandidateRaw);
        if (!normalized) {
          const { provider, model } = splitModelRef(resolvedModel);
          const hint = formatThinkingLevels(provider, model);
          return jsonResult({
            status: "error",
            error: `Invalid thinking level "${thinkingCandidateRaw}". Use one of: ${hint}.`,
          });
        }
        thinkingOverride = normalized;
      }
      if (resolvedModel) {
        try {
          await callGateway({
            method: "sessions.patch",
            params: { key: childSessionKey, model: resolvedModel },
            timeoutMs: 10_000,
          });
          modelApplied = true;
        } catch (err) {
          const messageText =
            err instanceof Error ? err.message : typeof err === "string" ? err : "error";
          const recoverable =
            messageText.includes("invalid model") || messageText.includes("model not allowed");
          if (!recoverable) {
            return jsonResult({
              status: "error",
              error: messageText,
              childSessionKey,
            });
          }
          modelWarning = messageText;
        }
      }
      if (thinkingOverride !== undefined) {
        try {
          await callGateway({
            method: "sessions.patch",
            params: {
              key: childSessionKey,
              thinkingLevel: thinkingOverride === "off" ? null : thinkingOverride,
            },
            timeoutMs: 10_000,
          });
        } catch (err) {
          const messageText =
            err instanceof Error ? err.message : typeof err === "string" ? err : "error";
          return jsonResult({
            status: "error",
            error: messageText,
            childSessionKey,
          });
        }
      }
      // Build team context if team parameters are provided
      const teamTier = readStringParam(params, "teamTier") as AgentTier | undefined;
      const teamProjectId = readStringParam(params, "teamProjectId");
      const teamNameParam = readStringParam(params, "teamName");
      const teamRole = readStringParam(params, "teamRole");
      const teamMemberName = readStringParam(params, "teamMemberName");
      const teamManagerId = readStringParam(params, "teamManagerId");
      const teamLeadRole = readStringParam(params, "teamLeadRole");

      // Containment check: verify spawned role exists in the hierarchy folder
      if (teamManagerId && teamTier) {
        const workspaceDir = resolveAgentWorkspaceDir(cfg, requesterAgentId);
        if (teamTier === "team-lead" && teamRole) {
          // Manager spawning a team lead: verify the team lead role exists in the manager's folder
          if (!hierarchyPathExists(workspaceDir, teamManagerId, teamRole)) {
            return jsonResult({
              status: "forbidden",
              error: `team lead role "${teamRole}" not found in hierarchy for manager "${teamManagerId}" (expected: workspace/agents/${teamManagerId}/teamleads/${teamRole}/)`,
            });
          }
        } else if (teamTier === "teammate" && teamLeadRole && teamRole) {
          // Team lead spawning a teammate: verify the teammate role exists in the lead's folder
          if (!hierarchyPathExists(workspaceDir, teamManagerId, teamLeadRole, teamRole)) {
            return jsonResult({
              status: "forbidden",
              error: `teammate role "${teamRole}" not found in hierarchy for team lead "${teamLeadRole}" under manager "${teamManagerId}" (expected: workspace/agents/${teamManagerId}/teamleads/${teamLeadRole}/teammates/${teamRole}/)`,
            });
          }
        }
      }

      const teamContext = teamTier
        ? {
            tier: teamTier,
            projectId: teamProjectId || undefined,
            teamName: teamNameParam || undefined,
            role: teamRole || undefined,
            memberName: teamMemberName || undefined,
            managerId: teamManagerId || undefined,
            leadRole: teamLeadRole || undefined,
          }
        : undefined;

      let childSystemPrompt = buildSubagentSystemPrompt({
        requesterSessionKey,
        requesterOrigin,
        childSessionKey,
        label: label || undefined,
        task,
        teamContext,
      });

      // For team agents, load tier-specific bootstrap files and embed them
      // in the extraSystemPrompt so they flow through the entire agent pipeline.
      // This ensures MANAGER.md/TEAM-LEAD.md/TEAMMATE.md and tier-specific
      // SOUL.md/AGENTS.md get injected into the system prompt at run time.
      if (teamContext) {
        try {
          const workspaceDir = resolveAgentWorkspaceDir(cfg, requesterAgentId);
          const tierFiles = await loadTierBootstrapFiles({
            workspaceDir,
            tier: teamContext.tier,
            projectId: teamContext.projectId,
            teamName: teamContext.teamName,
            teamManagerId: teamContext.managerId,
            teamLeadRole: teamContext.leadRole,
            teamMateRole: teamContext.role,
          });
          const bootstrapSection: string[] = [];
          for (const file of tierFiles) {
            if (!file.missing && file.content?.trim()) {
              bootstrapSection.push(`## ${file.name}`, "", file.content.trim(), "");
            }
          }
          if (bootstrapSection.length > 0) {
            childSystemPrompt +=
              "\n\n# Bootstrap Context\n\n" +
              "The following role-specific bootstrap files define your behavior:\n\n" +
              bootstrapSection.join("\n");
          }
        } catch {
          // Non-fatal: tier bootstrap files are supplementary
        }
      }

      const childIdem = crypto.randomUUID();
      let childRunId: string = childIdem;
      try {
        const response = await callGateway<{ runId: string }>({
          method: "agent",
          params: {
            message: task,
            sessionKey: childSessionKey,
            channel: requesterOrigin?.channel,
            to: requesterOrigin?.to ?? undefined,
            accountId: requesterOrigin?.accountId ?? undefined,
            threadId:
              requesterOrigin?.threadId != null ? String(requesterOrigin.threadId) : undefined,
            idempotencyKey: childIdem,
            deliver: false,
            lane: AGENT_LANE_SUBAGENT,
            extraSystemPrompt: childSystemPrompt,
            thinking: thinkingOverride,
            timeout: runTimeoutSeconds > 0 ? runTimeoutSeconds : undefined,
            label: label || undefined,
            spawnedBy: spawnedByKey,
            groupId: opts?.agentGroupId ?? undefined,
            groupChannel: opts?.agentGroupChannel ?? undefined,
            groupSpace: opts?.agentGroupSpace ?? undefined,
          },
          timeoutMs: 10_000,
        });
        if (typeof response?.runId === "string" && response.runId) {
          childRunId = response.runId;
        }
      } catch (err) {
        const messageText =
          err instanceof Error ? err.message : typeof err === "string" ? err : "error";
        return jsonResult({
          status: "error",
          error: messageText,
          childSessionKey,
          runId: childRunId,
        });
      }

      registerSubagentRun({
        runId: childRunId,
        childSessionKey,
        requesterSessionKey: requesterInternalKey,
        requesterOrigin,
        requesterDisplayKey,
        task,
        cleanup,
        label: label || undefined,
        runTimeoutSeconds,
      });

      return jsonResult({
        status: "accepted",
        childSessionKey,
        runId: childRunId,
        modelApplied: resolvedModel ? modelApplied : undefined,
        warning: modelWarning,
      });
    },
  };
}
