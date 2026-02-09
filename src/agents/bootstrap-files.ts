import type { OpenClawConfig } from "../config/config.js";
import type { AgentTier, TeamMemberTemplate } from "../config/types.teams.js";
import type { EmbeddedContextFile } from "./pi-embedded-helpers.js";
import { applyBootstrapHookOverrides } from "./bootstrap-hooks.js";
import { buildBootstrapContextFiles, resolveBootstrapMaxChars } from "./pi-embedded-helpers.js";
import {
  filterBootstrapFilesForSession,
  loadWorkspaceBootstrapFiles,
  type WorkspaceBootstrapFile,
} from "./workspace.js";
import { loadTierBootstrapFiles } from "../teams/team-bootstrap.js";

export function makeBootstrapWarn(params: {
  sessionLabel: string;
  warn?: (message: string) => void;
}): ((message: string) => void) | undefined {
  if (!params.warn) {
    return undefined;
  }
  return (message: string) => params.warn?.(`${message} (sessionKey=${params.sessionLabel})`);
}

export async function resolveBootstrapFilesForRun(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  /** When set, loads tier-specific bootstrap files for team agents. */
  teamContext?: {
    tier: AgentTier;
    member?: TeamMemberTemplate;
    projectId?: string;
    teamName?: string;
    managerId?: string;
    leadRole?: string;
  };
}): Promise<WorkspaceBootstrapFile[]> {
  const sessionKey = params.sessionKey ?? params.sessionId;
  const isTeamAgent = !!params.teamContext;

  let bootstrapFiles: WorkspaceBootstrapFile[];

  if (params.teamContext) {
    // For team agents, load tier-specific bootstrap files
    bootstrapFiles = await loadTierBootstrapFiles({
      workspaceDir: params.workspaceDir,
      tier: params.teamContext.tier,
      member: params.teamContext.member,
      projectId: params.teamContext.projectId,
      teamName: params.teamContext.teamName,
      teamManagerId: params.teamContext.managerId,
      teamLeadRole: params.teamContext.leadRole,
    });
  } else {
    // Standard bootstrap loading for non-team agents
    bootstrapFiles = filterBootstrapFilesForSession(
      await loadWorkspaceBootstrapFiles(params.workspaceDir),
      sessionKey,
      { isTeamAgent },
    );
  }

  return applyBootstrapHookOverrides({
    files: bootstrapFiles,
    workspaceDir: params.workspaceDir,
    config: params.config,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    agentId: params.agentId,
  });
}

export async function resolveBootstrapContextForRun(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  warn?: (message: string) => void;
  /** When set, loads tier-specific bootstrap files for team agents. */
  teamContext?: {
    tier: AgentTier;
    member?: TeamMemberTemplate;
    projectId?: string;
    teamName?: string;
    managerId?: string;
    leadRole?: string;
  };
}): Promise<{
  bootstrapFiles: WorkspaceBootstrapFile[];
  contextFiles: EmbeddedContextFile[];
}> {
  const bootstrapFiles = await resolveBootstrapFilesForRun(params);
  const contextFiles = buildBootstrapContextFiles(bootstrapFiles, {
    maxChars: resolveBootstrapMaxChars(params.config),
    warn: params.warn,
  });
  return { bootstrapFiles, contextFiles };
}
