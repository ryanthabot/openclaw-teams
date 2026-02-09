import path from "node:path";
import type { OpenClawConfig, ConfigValidationIssue } from "./types.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { CHANNEL_IDS, normalizeChatChannelId } from "../channels/registry.js";
import {
  normalizePluginsConfig,
  resolveEnableState,
  resolveMemorySlotDecision,
} from "../plugins/config-state.js";
import { loadPluginManifestRegistry } from "../plugins/manifest-registry.js";
import { validateJsonSchemaValue } from "../plugins/schema-validator.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { findDuplicateAgentDirs, formatDuplicateAgentDirError } from "./agent-dirs.js";
import { applyAgentDefaults, applyModelDefaults, applySessionDefaults } from "./defaults.js";
import { findLegacyConfigIssues } from "./legacy.js";
import { OpenClawSchema } from "./zod-schema.js";

const AVATAR_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;
const WINDOWS_ABS_RE = /^[a-zA-Z]:[\\/]/;

function isWorkspaceAvatarPath(value: string, workspaceDir: string): boolean {
  const workspaceRoot = path.resolve(workspaceDir);
  const resolved = path.resolve(workspaceRoot, value);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative === "") {
    return true;
  }
  if (relative.startsWith("..")) {
    return false;
  }
  return !path.isAbsolute(relative);
}

function validateIdentityAvatar(config: OpenClawConfig): ConfigValidationIssue[] {
  const agents = config.agents?.list;
  if (!Array.isArray(agents) || agents.length === 0) {
    return [];
  }
  const issues: ConfigValidationIssue[] = [];
  for (const [index, entry] of agents.entries()) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const avatarRaw = entry.identity?.avatar;
    if (typeof avatarRaw !== "string") {
      continue;
    }
    const avatar = avatarRaw.trim();
    if (!avatar) {
      continue;
    }
    if (AVATAR_DATA_RE.test(avatar) || AVATAR_HTTP_RE.test(avatar)) {
      continue;
    }
    if (avatar.startsWith("~")) {
      issues.push({
        path: `agents.list.${index}.identity.avatar`,
        message: "identity.avatar must be a workspace-relative path, http(s) URL, or data URI.",
      });
      continue;
    }
    const hasScheme = AVATAR_SCHEME_RE.test(avatar);
    if (hasScheme && !WINDOWS_ABS_RE.test(avatar)) {
      issues.push({
        path: `agents.list.${index}.identity.avatar`,
        message: "identity.avatar must be a workspace-relative path, http(s) URL, or data URI.",
      });
      continue;
    }
    const workspaceDir = resolveAgentWorkspaceDir(
      config,
      entry.id ?? resolveDefaultAgentId(config),
    );
    if (!isWorkspaceAvatarPath(avatar, workspaceDir)) {
      issues.push({
        path: `agents.list.${index}.identity.avatar`,
        message: "identity.avatar must stay within the agent workspace.",
      });
    }
  }
  return issues;
}

export function validateConfigObject(
  raw: unknown,
): { ok: true; config: OpenClawConfig } | { ok: false; issues: ConfigValidationIssue[] } {
  const legacyIssues = findLegacyConfigIssues(raw);
  if (legacyIssues.length > 0) {
    return {
      ok: false,
      issues: legacyIssues.map((iss) => ({
        path: iss.path,
        message: iss.message,
      })),
    };
  }
  const validated = OpenClawSchema.safeParse(raw);
  if (!validated.success) {
    return {
      ok: false,
      issues: validated.error.issues.map((iss) => ({
        path: iss.path.join("."),
        message: iss.message,
      })),
    };
  }
  const duplicates = findDuplicateAgentDirs(validated.data as OpenClawConfig);
  if (duplicates.length > 0) {
    return {
      ok: false,
      issues: [
        {
          path: "agents.list",
          message: formatDuplicateAgentDirError(duplicates),
        },
      ],
    };
  }
  const avatarIssues = validateIdentityAvatar(validated.data as OpenClawConfig);
  if (avatarIssues.length > 0) {
    return { ok: false, issues: avatarIssues };
  }
  const teamIssues = validateTeamHierarchy(validated.data as OpenClawConfig);
  if (teamIssues.length > 0) {
    return { ok: false, issues: teamIssues };
  }
  return {
    ok: true,
    config: applyModelDefaults(
      applyAgentDefaults(applySessionDefaults(validated.data as OpenClawConfig)),
    ),
  };
}

const TIER_HIERARCHY: Record<string, string[]> = {
  "general-manager": ["operations", "manager"],
  manager: ["team-lead"],
  "team-lead": ["teammate"],
};

function validateTeamHierarchy(config: OpenClawConfig): ConfigValidationIssue[] {
  const agents = config.agents?.list;
  if (!Array.isArray(agents) || agents.length === 0) {
    return [];
  }
  const issues: ConfigValidationIssue[] = [];
  const agentIds = new Set(agents.map((a) => normalizeAgentId(a.id)));

  for (const [index, entry] of agents.entries()) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const reportsTo = typeof raw.reportsTo === "string" ? raw.reportsTo.trim() : undefined;
    const tier = typeof raw.tier === "string" ? raw.tier : undefined;

    // Validate reportsTo references an existing agent
    if (reportsTo) {
      const normalizedParent = normalizeAgentId(reportsTo);
      if (!agentIds.has(normalizedParent)) {
        issues.push({
          path: `agents.list.${index}.reportsTo`,
          message: `reportsTo references unknown agent "${reportsTo}".`,
        });
      }
      // Check for self-reference
      if (normalizedParent === normalizeAgentId(entry.id)) {
        issues.push({
          path: `agents.list.${index}.reportsTo`,
          message: `agent "${entry.id}" cannot report to itself.`,
        });
      }
    }

    // Validate tier-consistency: if both this agent and parent have tiers, parent should be higher
    if (reportsTo && tier) {
      const parentEntry = agents.find(
        (a) => normalizeAgentId(a.id) === normalizeAgentId(reportsTo),
      );
      const parentTier = parentEntry
        ? (parentEntry as Record<string, unknown>).tier
        : undefined;
      if (typeof parentTier === "string") {
        const allowedChildren = TIER_HIERARCHY[parentTier];
        if (allowedChildren && !allowedChildren.includes(tier)) {
          issues.push({
            path: `agents.list.${index}.tier`,
            message: `tier "${tier}" cannot report to tier "${parentTier}" (allowed children: ${allowedChildren.join(", ")}).`,
          });
        }
      }
    }

    // Validate agentTeams template references
    const agentTeams = raw.agentTeams as
      | { enabled?: boolean; templates?: string[] }
      | undefined;
    if (agentTeams?.templates && Array.isArray(agentTeams.templates)) {
      const templates = (config as Record<string, unknown>).teams as
        | { templates?: Record<string, unknown> }
        | undefined;
      const templateIds = templates?.templates
        ? new Set(Object.keys(templates.templates))
        : new Set<string>();
      for (const [tIdx, tId] of agentTeams.templates.entries()) {
        if (typeof tId === "string" && !templateIds.has(tId)) {
          issues.push({
            path: `agents.list.${index}.agentTeams.templates.${tIdx}`,
            message: `references unknown team template "${tId}".`,
          });
        }
      }
    }

    // Non-fatal: warn if manager has templates but no hierarchy folders
    // (hierarchy folders are auto-created on spawn, so this is informational only)
    // Note: we don't block validation here since scaffolding is automatic
  }

  // Check for circular reportsTo chains
  for (const entry of agents) {
    const visited = new Set<string>();
    let current: string | undefined = normalizeAgentId(entry.id);
    while (current) {
      if (visited.has(current)) {
        issues.push({
          path: "agents.list",
          message: `circular reportsTo chain detected involving agent "${entry.id}".`,
        });
        break;
      }
      visited.add(current);
      const currentEntry = agents.find(
        (a) => normalizeAgentId(a.id) === current,
      );
      const parent =
        currentEntry && typeof (currentEntry as Record<string, unknown>).reportsTo === "string"
          ? normalizeAgentId(
              (currentEntry as Record<string, unknown>).reportsTo as string,
            )
          : undefined;
      current = parent;
    }
  }

  return issues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function validateConfigObjectWithPlugins(raw: unknown):
  | {
      ok: true;
      config: OpenClawConfig;
      warnings: ConfigValidationIssue[];
    }
  | {
      ok: false;
      issues: ConfigValidationIssue[];
      warnings: ConfigValidationIssue[];
    } {
  const base = validateConfigObject(raw);
  if (!base.ok) {
    return { ok: false, issues: base.issues, warnings: [] };
  }

  const config = base.config;
  const issues: ConfigValidationIssue[] = [];
  const warnings: ConfigValidationIssue[] = [];
  const pluginsConfig = config.plugins;
  const normalizedPlugins = normalizePluginsConfig(pluginsConfig);

  const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
  const registry = loadPluginManifestRegistry({
    config,
    workspaceDir: workspaceDir ?? undefined,
  });

  const knownIds = new Set(registry.plugins.map((record) => record.id));

  for (const diag of registry.diagnostics) {
    let path = diag.pluginId ? `plugins.entries.${diag.pluginId}` : "plugins";
    if (!diag.pluginId && diag.message.includes("plugin path not found")) {
      path = "plugins.load.paths";
    }
    const pluginLabel = diag.pluginId ? `plugin ${diag.pluginId}` : "plugin";
    const message = `${pluginLabel}: ${diag.message}`;
    if (diag.level === "error") {
      issues.push({ path, message });
    } else {
      warnings.push({ path, message });
    }
  }

  const entries = pluginsConfig?.entries;
  if (entries && isRecord(entries)) {
    for (const pluginId of Object.keys(entries)) {
      if (!knownIds.has(pluginId)) {
        issues.push({
          path: `plugins.entries.${pluginId}`,
          message: `plugin not found: ${pluginId}`,
        });
      }
    }
  }

  const allow = pluginsConfig?.allow ?? [];
  for (const pluginId of allow) {
    if (typeof pluginId !== "string" || !pluginId.trim()) {
      continue;
    }
    if (!knownIds.has(pluginId)) {
      issues.push({
        path: "plugins.allow",
        message: `plugin not found: ${pluginId}`,
      });
    }
  }

  const deny = pluginsConfig?.deny ?? [];
  for (const pluginId of deny) {
    if (typeof pluginId !== "string" || !pluginId.trim()) {
      continue;
    }
    if (!knownIds.has(pluginId)) {
      issues.push({
        path: "plugins.deny",
        message: `plugin not found: ${pluginId}`,
      });
    }
  }

  const memorySlot = normalizedPlugins.slots.memory;
  if (typeof memorySlot === "string" && memorySlot.trim() && !knownIds.has(memorySlot)) {
    issues.push({
      path: "plugins.slots.memory",
      message: `plugin not found: ${memorySlot}`,
    });
  }

  const allowedChannels = new Set<string>(["defaults", ...CHANNEL_IDS]);
  for (const record of registry.plugins) {
    for (const channelId of record.channels) {
      allowedChannels.add(channelId);
    }
  }

  if (config.channels && isRecord(config.channels)) {
    for (const key of Object.keys(config.channels)) {
      const trimmed = key.trim();
      if (!trimmed) {
        continue;
      }
      if (!allowedChannels.has(trimmed)) {
        issues.push({
          path: `channels.${trimmed}`,
          message: `unknown channel id: ${trimmed}`,
        });
      }
    }
  }

  const heartbeatChannelIds = new Set<string>();
  for (const channelId of CHANNEL_IDS) {
    heartbeatChannelIds.add(channelId.toLowerCase());
  }
  for (const record of registry.plugins) {
    for (const channelId of record.channels) {
      const trimmed = channelId.trim();
      if (trimmed) {
        heartbeatChannelIds.add(trimmed.toLowerCase());
      }
    }
  }

  const validateHeartbeatTarget = (target: string | undefined, path: string) => {
    if (typeof target !== "string") {
      return;
    }
    const trimmed = target.trim();
    if (!trimmed) {
      issues.push({ path, message: "heartbeat target must not be empty" });
      return;
    }
    const normalized = trimmed.toLowerCase();
    if (normalized === "last" || normalized === "none") {
      return;
    }
    if (normalizeChatChannelId(trimmed)) {
      return;
    }
    if (heartbeatChannelIds.has(normalized)) {
      return;
    }
    issues.push({ path, message: `unknown heartbeat target: ${target}` });
  };

  validateHeartbeatTarget(
    config.agents?.defaults?.heartbeat?.target,
    "agents.defaults.heartbeat.target",
  );
  if (Array.isArray(config.agents?.list)) {
    for (const [index, entry] of config.agents.list.entries()) {
      validateHeartbeatTarget(entry?.heartbeat?.target, `agents.list.${index}.heartbeat.target`);
    }
  }

  let selectedMemoryPluginId: string | null = null;
  const seenPlugins = new Set<string>();
  for (const record of registry.plugins) {
    const pluginId = record.id;
    if (seenPlugins.has(pluginId)) {
      continue;
    }
    seenPlugins.add(pluginId);
    const entry = normalizedPlugins.entries[pluginId];
    const entryHasConfig = Boolean(entry?.config);

    const enableState = resolveEnableState(pluginId, record.origin, normalizedPlugins);
    let enabled = enableState.enabled;
    let reason = enableState.reason;

    if (enabled) {
      const memoryDecision = resolveMemorySlotDecision({
        id: pluginId,
        kind: record.kind,
        slot: memorySlot,
        selectedId: selectedMemoryPluginId,
      });
      if (!memoryDecision.enabled) {
        enabled = false;
        reason = memoryDecision.reason;
      }
      if (memoryDecision.selected && record.kind === "memory") {
        selectedMemoryPluginId = pluginId;
      }
    }

    const shouldValidate = enabled || entryHasConfig;
    if (shouldValidate) {
      if (record.configSchema) {
        const res = validateJsonSchemaValue({
          schema: record.configSchema,
          cacheKey: record.schemaCacheKey ?? record.manifestPath ?? pluginId,
          value: entry?.config ?? {},
        });
        if (!res.ok) {
          for (const error of res.errors) {
            issues.push({
              path: `plugins.entries.${pluginId}.config`,
              message: `invalid config: ${error}`,
            });
          }
        }
      } else {
        issues.push({
          path: `plugins.entries.${pluginId}`,
          message: `plugin schema missing for ${pluginId}`,
        });
      }
    }

    if (!enabled && entryHasConfig) {
      warnings.push({
        path: `plugins.entries.${pluginId}`,
        message: `plugin disabled (${reason ?? "disabled"}) but config is present`,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues, warnings };
  }

  return { ok: true, config, warnings };
}
