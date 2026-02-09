import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";
import { DEFAULT_AGENT_WORKSPACE_DIR } from "./workspace.js";

export { resolveAgentIdFromSessionKey } from "../routing/session-key.js";

type AgentEntry = NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]>[number];

import type { AgentTier } from "../config/types.teams.js";

type ResolvedAgentConfig = {
  name?: string;
  workspace?: string;
  agentDir?: string;
  model?: AgentEntry["model"];
  skills?: AgentEntry["skills"];
  memorySearch?: AgentEntry["memorySearch"];
  humanDelay?: AgentEntry["humanDelay"];
  heartbeat?: AgentEntry["heartbeat"];
  identity?: AgentEntry["identity"];
  groupChat?: AgentEntry["groupChat"];
  subagents?: AgentEntry["subagents"];
  sandbox?: AgentEntry["sandbox"];
  tools?: AgentEntry["tools"];
  tier?: AgentTier;
  reportsTo?: string;
  agentTeams?: { enabled?: boolean; templates?: string[] };
};

let defaultAgentWarned = false;

function listAgents(cfg: OpenClawConfig): AgentEntry[] {
  const list = cfg.agents?.list;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter((entry): entry is AgentEntry => Boolean(entry && typeof entry === "object"));
}

export function listAgentIds(cfg: OpenClawConfig): string[] {
  const agents = listAgents(cfg);
  if (agents.length === 0) {
    return [DEFAULT_AGENT_ID];
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of agents) {
    const id = normalizeAgentId(entry?.id);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : [DEFAULT_AGENT_ID];
}

export function resolveDefaultAgentId(cfg: OpenClawConfig): string {
  const agents = listAgents(cfg);
  if (agents.length === 0) {
    return DEFAULT_AGENT_ID;
  }
  const defaults = agents.filter((agent) => agent?.default);
  if (defaults.length > 1 && !defaultAgentWarned) {
    defaultAgentWarned = true;
    console.warn("Multiple agents marked default=true; using the first entry as default.");
  }
  const chosen = (defaults[0] ?? agents[0])?.id?.trim();
  return normalizeAgentId(chosen || DEFAULT_AGENT_ID);
}

export function resolveSessionAgentIds(params: { sessionKey?: string; config?: OpenClawConfig }): {
  defaultAgentId: string;
  sessionAgentId: string;
} {
  const defaultAgentId = resolveDefaultAgentId(params.config ?? {});
  const sessionKey = params.sessionKey?.trim();
  const normalizedSessionKey = sessionKey ? sessionKey.toLowerCase() : undefined;
  const parsed = normalizedSessionKey ? parseAgentSessionKey(normalizedSessionKey) : null;
  const sessionAgentId = parsed?.agentId ? normalizeAgentId(parsed.agentId) : defaultAgentId;
  return { defaultAgentId, sessionAgentId };
}

export function resolveSessionAgentId(params: {
  sessionKey?: string;
  config?: OpenClawConfig;
}): string {
  return resolveSessionAgentIds(params).sessionAgentId;
}

function resolveAgentEntry(cfg: OpenClawConfig, agentId: string): AgentEntry | undefined {
  const id = normalizeAgentId(agentId);
  return listAgents(cfg).find((entry) => normalizeAgentId(entry.id) === id);
}

export function resolveAgentConfig(
  cfg: OpenClawConfig,
  agentId: string,
): ResolvedAgentConfig | undefined {
  const id = normalizeAgentId(agentId);
  const entry = resolveAgentEntry(cfg, id);
  if (!entry) {
    return undefined;
  }
  return {
    name: typeof entry.name === "string" ? entry.name : undefined,
    workspace: typeof entry.workspace === "string" ? entry.workspace : undefined,
    agentDir: typeof entry.agentDir === "string" ? entry.agentDir : undefined,
    model:
      typeof entry.model === "string" || (entry.model && typeof entry.model === "object")
        ? entry.model
        : undefined,
    skills: Array.isArray(entry.skills) ? entry.skills : undefined,
    memorySearch: entry.memorySearch,
    humanDelay: entry.humanDelay,
    heartbeat: entry.heartbeat,
    identity: entry.identity,
    groupChat: entry.groupChat,
    subagents: typeof entry.subagents === "object" && entry.subagents ? entry.subagents : undefined,
    sandbox: entry.sandbox,
    tools: entry.tools,
    tier: (entry as Record<string, unknown>).tier as AgentTier | undefined,
    reportsTo: typeof (entry as Record<string, unknown>).reportsTo === "string"
      ? ((entry as Record<string, unknown>).reportsTo as string)
      : undefined,
    agentTeams:
      typeof (entry as Record<string, unknown>).agentTeams === "object" &&
      (entry as Record<string, unknown>).agentTeams
        ? ((entry as Record<string, unknown>).agentTeams as {
            enabled?: boolean;
            templates?: string[];
          })
        : undefined,
  };
}

export function resolveAgentSkillsFilter(
  cfg: OpenClawConfig,
  agentId: string,
): string[] | undefined {
  const raw = resolveAgentConfig(cfg, agentId)?.skills;
  if (!raw) {
    return undefined;
  }
  const normalized = raw.map((entry) => String(entry).trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : [];
}

export function resolveAgentModelPrimary(cfg: OpenClawConfig, agentId: string): string | undefined {
  const raw = resolveAgentConfig(cfg, agentId)?.model;
  if (!raw) {
    return undefined;
  }
  if (typeof raw === "string") {
    return raw.trim() || undefined;
  }
  const primary = raw.primary?.trim();
  return primary || undefined;
}

export function resolveAgentModelFallbacksOverride(
  cfg: OpenClawConfig,
  agentId: string,
): string[] | undefined {
  const raw = resolveAgentConfig(cfg, agentId)?.model;
  if (!raw || typeof raw === "string") {
    return undefined;
  }
  // Important: treat an explicitly provided empty array as an override to disable global fallbacks.
  if (!Object.hasOwn(raw, "fallbacks")) {
    return undefined;
  }
  return Array.isArray(raw.fallbacks) ? raw.fallbacks : undefined;
}

export function resolveAgentWorkspaceDir(cfg: OpenClawConfig, agentId: string) {
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentConfig(cfg, id)?.workspace?.trim();
  if (configured) {
    return resolveUserPath(configured);
  }
  const defaultAgentId = resolveDefaultAgentId(cfg);
  if (id === defaultAgentId) {
    const fallback = cfg.agents?.defaults?.workspace?.trim();
    if (fallback) {
      return resolveUserPath(fallback);
    }
    return DEFAULT_AGENT_WORKSPACE_DIR;
  }
  return path.join(os.homedir(), ".openclaw", `workspace-${id}`);
}

export function resolveAgentDir(cfg: OpenClawConfig, agentId: string) {
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentConfig(cfg, id)?.agentDir?.trim();
  if (configured) {
    return resolveUserPath(configured);
  }
  const root = resolveStateDir(process.env, os.homedir);
  return path.join(root, "agents", id, "agent");
}

// ---------------------------------------------------------------------------
// Team hierarchy helpers
// ---------------------------------------------------------------------------

const TIER_ORDER: AgentTier[] = [
  "general-manager",
  "operations",
  "manager",
  "team-lead",
  "teammate",
];

/** Returns the agent's tier or undefined if not set. */
export function resolveAgentTier(
  cfg: OpenClawConfig,
  agentId: string,
): AgentTier | undefined {
  return resolveAgentConfig(cfg, agentId)?.tier;
}

/** Returns the parent agent ID this agent reports to. */
export function resolveAgentReportsTo(
  cfg: OpenClawConfig,
  agentId: string,
): string | undefined {
  return resolveAgentConfig(cfg, agentId)?.reportsTo;
}

/** Returns all agent IDs that report to the given manager. */
export function listDirectReports(
  cfg: OpenClawConfig,
  managerId: string,
): string[] {
  const id = normalizeAgentId(managerId);
  return listAgentIds(cfg).filter((agentId) => {
    const reportsTo = resolveAgentConfig(cfg, agentId)?.reportsTo;
    return reportsTo ? normalizeAgentId(reportsTo) === id : false;
  });
}

/**
 * Returns whether requesterTier can spawn agents at targetTier.
 * Rules:
 * - general-manager can spawn operations or manager
 * - manager can spawn team-lead
 * - team-lead can spawn teammate
 * - operations cannot spawn anyone
 * - teammate cannot spawn anyone
 */
export function canSpawnTier(
  requesterTier: AgentTier | undefined,
  targetTier: AgentTier | undefined,
): boolean {
  if (!requesterTier || !targetTier) {
    return true; // no tier set = no hierarchy enforcement
  }
  const requesterIdx = TIER_ORDER.indexOf(requesterTier);
  const targetIdx = TIER_ORDER.indexOf(targetTier);
  if (requesterIdx < 0 || targetIdx < 0) {
    return true;
  }
  // operations tier has no spawning authority
  if (requesterTier === "operations") {
    return false;
  }
  // teammate tier has no spawning authority
  if (requesterTier === "teammate") {
    return false;
  }
  // general-manager can spawn operations or manager (tier indices 1 and 2)
  if (requesterTier === "general-manager") {
    return targetTier === "operations" || targetTier === "manager";
  }
  // manager can spawn team-lead
  if (requesterTier === "manager") {
    return targetTier === "team-lead";
  }
  // team-lead can spawn teammate
  if (requesterTier === "team-lead") {
    return targetTier === "teammate";
  }
  return false;
}

/** Returns agent team templates enabled for a given manager agent. */
export function resolveAgentTeamTemplates(
  cfg: OpenClawConfig,
  agentId: string,
): string[] {
  const config = resolveAgentConfig(cfg, agentId);
  if (!config?.agentTeams?.enabled) {
    return [];
  }
  return config.agentTeams.templates ?? [];
}

// ---------------------------------------------------------------------------
// Nested hierarchy filesystem discovery
// ---------------------------------------------------------------------------

import fs from "node:fs";

/**
 * List team lead roles available under a manager's hierarchy folder.
 * Scans workspace/agents/<managerId>/teamleads/ for subdirectories.
 * Returns empty array if the directory doesn't exist.
 */
export function listManagerTeamLeads(
  workspaceDir: string,
  managerId: string,
): string[] {
  const teamleadsDir = path.join(workspaceDir, "agents", managerId, "teamleads");
  try {
    const entries = fs.readdirSync(teamleadsDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * List teammate roles available under a team lead's hierarchy folder.
 * Scans workspace/agents/<managerId>/teamleads/<leadRole>/teammates/ for subdirectories.
 * Returns empty array if the directory doesn't exist.
 */
export function listTeamLeadTeammates(
  workspaceDir: string,
  managerId: string,
  leadRole: string,
): string[] {
  const teammatesDir = path.join(
    workspaceDir,
    "agents",
    managerId,
    "teamleads",
    leadRole,
    "teammates",
  );
  try {
    const entries = fs.readdirSync(teammatesDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Check if a specific nested hierarchy path exists on the filesystem.
 * Used for containment checks before spawning.
 */
export function hierarchyPathExists(
  workspaceDir: string,
  managerId: string,
  leadRole?: string,
  mateRole?: string,
): boolean {
  let target = path.join(workspaceDir, "agents", managerId);
  if (leadRole) {
    target = path.join(target, "teamleads", leadRole);
  }
  if (mateRole) {
    if (!leadRole) {
      return false;
    }
    target = path.join(target, "teammates", mateRole);
  }
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}
