/**
 * Team Bootstrap File Loading
 *
 * Loads and injects tier-specific bootstrap files into agent system prompts.
 * Each tier (manager, team-lead, teammate) gets its own set of bootstrap files
 * from the nested hierarchy or the reference templates.
 *
 * Nested hierarchy structure:
 *   /workspace/agents/<managerId>/                     — manager bootstrap files
 *   /workspace/agents/<managerId>/teamleads/<leadRole>/  — team lead bootstrap files
 *   /workspace/agents/<managerId>/teamleads/<leadRole>/teammates/<mateRole>/ — teammate files
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { AgentTier, TeamMemberTemplate, TeamTemplate } from "../config/types.teams.js";
import type { WorkspaceBootstrapFile, WorkspaceBootstrapFileName } from "../agents/workspace.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_MEMORY_FILENAME,
} from "../agents/workspace.js";
import { resolveWorkspaceTemplateDir } from "../agents/workspace-templates.js";

// Tier-specific bootstrap file names
export const MANAGER_FILENAME = "MANAGER.md" as WorkspaceBootstrapFileName;
export const TEAM_LEAD_FILENAME = "TEAM-LEAD.md" as WorkspaceBootstrapFileName;
export const TEAMMATE_FILENAME = "TEAMMATE.md" as WorkspaceBootstrapFileName;

/** Map from agent tier to the tier-specific bootstrap file. */
const TIER_BOOTSTRAP_FILE: Partial<Record<AgentTier, WorkspaceBootstrapFileName>> = {
  manager: MANAGER_FILENAME,
  "team-lead": TEAM_LEAD_FILENAME,
  teammate: TEAMMATE_FILENAME,
};

/**
 * The bootstrap files loaded for each tier, in order.
 * The tier-specific file (e.g. MANAGER.md) comes first, then
 * the standard files that the user can customize per tier.
 */
const TIER_BOOTSTRAP_ORDER: WorkspaceBootstrapFileName[] = [
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_MEMORY_FILENAME,
];

function stripFrontMatter(content: string): string {
  if (!content.startsWith("---")) {
    return content;
  }
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) {
    return content;
  }
  const start = endIndex + "\n---".length;
  let trimmed = content.slice(start);
  trimmed = trimmed.replace(/^\s+/, "");
  return trimmed;
}

async function loadTemplateFile(name: string): Promise<string | undefined> {
  try {
    const templateDir = await resolveWorkspaceTemplateDir();
    const templatePath = path.join(templateDir, name);
    const content = await fs.readFile(templatePath, "utf-8");
    return stripFrontMatter(content);
  } catch {
    return undefined;
  }
}

async function readFileOrUndefined(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

/**
 * Resolve the persona directory for a specific team member.
 * Returns the persona path if set on the member template, otherwise undefined.
 */
export function resolvePersonaDir(
  workspaceDir: string,
  _tier: AgentTier,
  member?: TeamMemberTemplate,
): string | undefined {
  if (member?.persona?.trim()) {
    const personaPath = member.persona.trim();
    if (path.isAbsolute(personaPath)) {
      return personaPath;
    }
    return path.join(workspaceDir, personaPath);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Nested hierarchy path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the nested hierarchy directory for a given agent.
 *
 * The hierarchy is:
 *   workspace/agents/<managerId>/                                  — manager
 *   workspace/agents/<managerId>/teamleads/<leadRole>/             — team lead
 *   workspace/agents/<managerId>/teamleads/<leadRole>/teammates/<mateRole>/ — teammate
 *
 * Returns undefined if insufficient context is provided for the tier.
 */
export function resolveAgentHierarchyDir(
  workspaceDir: string,
  tier: AgentTier,
  managerId?: string,
  leadRole?: string,
  mateRole?: string,
): string | undefined {
  if (!managerId) {
    return undefined;
  }
  const base = path.join(workspaceDir, "agents", managerId);
  if (tier === "manager") {
    return base;
  }
  if (tier === "team-lead") {
    if (!leadRole) {
      return undefined;
    }
    return path.join(base, "teamleads", leadRole);
  }
  if (tier === "teammate") {
    if (!leadRole || !mateRole) {
      return undefined;
    }
    return path.join(base, "teamleads", leadRole, "teammates", mateRole);
  }
  return undefined;
}

/** All bootstrap file names that should be scaffolded into each agent folder. */
const ALL_BOOTSTRAP_FILENAMES: WorkspaceBootstrapFileName[] = [
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_MEMORY_FILENAME,
];

/**
 * Scaffold the full nested hierarchy for a manager based on its assigned templates.
 *
 * Creates:
 *   workspace/agents/<managerId>/                         (+ MANAGER.md + all bootstrap files)
 *   workspace/agents/<managerId>/teamleads/<leadRole>/    (+ TEAM-LEAD.md + all bootstrap files)
 *   workspace/agents/<managerId>/teamleads/<leadRole>/teammates/<mateRole>/ (+ TEAMMATE.md + all bootstrap files)
 *
 * Only writes files that don't already exist (preserves user edits).
 */
export async function ensureManagerHierarchyStructure(
  workspaceDir: string,
  managerId: string,
  templates: Record<string, TeamTemplate>,
): Promise<string[]> {
  const createdPaths: string[] = [];

  const writeIfMissing = async (filePath: string, content: string) => {
    try {
      await fs.writeFile(filePath, content, { encoding: "utf-8", flag: "wx" });
      return true;
    } catch (err) {
      const anyErr = err as { code?: string };
      if (anyErr.code !== "EEXIST") {
        throw err;
      }
      return false;
    }
  };

  const scaffoldDir = async (
    dir: string,
    tierFile: WorkspaceBootstrapFileName,
  ) => {
    await fs.mkdir(dir, { recursive: true });
    createdPaths.push(dir);

    // Write tier-specific file
    const tierContent = await loadTemplateFile(tierFile);
    if (tierContent) {
      await writeIfMissing(path.join(dir, tierFile), tierContent);
    }

    // Write all standard bootstrap files
    for (const fileName of ALL_BOOTSTRAP_FILENAMES) {
      const content = await loadTemplateFile(fileName);
      if (content) {
        await writeIfMissing(path.join(dir, fileName), content);
      }
    }
  };

  // Scaffold manager directory
  const managerDir = path.join(workspaceDir, "agents", managerId);
  await scaffoldDir(managerDir, MANAGER_FILENAME);

  // Scaffold team leads and teammates from templates
  for (const template of Object.values(templates)) {
    const leadRole = template.teamLead.role;
    const leadDir = path.join(managerDir, "teamleads", leadRole);
    await scaffoldDir(leadDir, TEAM_LEAD_FILENAME);

    for (const teammate of template.teammates) {
      const mateDir = path.join(leadDir, "teammates", teammate.role);
      await scaffoldDir(mateDir, TEAMMATE_FILENAME);
    }
  }

  return createdPaths;
}

/**
 * Load bootstrap files for a specific agent tier.
 *
 * Loading priority:
 * 1. Nested hierarchy directory (workspace/agents/<managerId>/teamleads/<leadRole>/...)
 * 2. Persona directory (if the team member template has a persona path)
 * 3. Main workspace directory (/workspace/)
 * 4. Reference templates (docs/reference/templates/)
 *
 * The tier-specific file (MANAGER.md, TEAM-LEAD.md, TEAMMATE.md) is always
 * loaded from the reference templates if not found in the workspace.
 */
export async function loadTierBootstrapFiles(params: {
  workspaceDir: string;
  tier: AgentTier;
  member?: TeamMemberTemplate;
  projectId?: string;
  teamName?: string;
  /** Manager ID for nested hierarchy resolution. */
  teamManagerId?: string;
  /** Team lead role for nested hierarchy resolution (needed for teammates). */
  teamLeadRole?: string;
  /** Teammate role for nested hierarchy resolution. */
  teamMateRole?: string;
}): Promise<WorkspaceBootstrapFile[]> {
  const { workspaceDir, tier, member } = params;
  const tierFile = TIER_BOOTSTRAP_FILE[tier];
  const personaDir = resolvePersonaDir(workspaceDir, tier, member);

  // Resolve nested hierarchy directory
  const hierarchyDir = resolveAgentHierarchyDir(
    workspaceDir,
    tier,
    params.teamManagerId,
    params.teamLeadRole,
    params.teamMateRole,
  );

  const result: WorkspaceBootstrapFile[] = [];

  // 1. Load the tier-specific bootstrap file (MANAGER.md / TEAM-LEAD.md / TEAMMATE.md)
  if (tierFile) {
    let content: string | undefined;
    let resolvedPath = "";

    // Try nested hierarchy dir first
    if (hierarchyDir) {
      resolvedPath = path.join(hierarchyDir, tierFile);
      content = await readFileOrUndefined(resolvedPath);
    }
    // Try persona dir
    if (!content && personaDir) {
      resolvedPath = path.join(personaDir, tierFile);
      content = await readFileOrUndefined(resolvedPath);
    }
    // Try main workspace
    if (!content) {
      resolvedPath = path.join(workspaceDir, tierFile);
      content = await readFileOrUndefined(resolvedPath);
    }
    // Fall back to reference templates
    if (!content) {
      content = await loadTemplateFile(tierFile);
      resolvedPath = `templates/${tierFile}`;
    }

    if (content) {
      result.push({
        name: tierFile,
        path: resolvedPath,
        content,
        missing: false,
      });
    }
  }

  // 2. Load standard bootstrap files (AGENTS.md, SOUL.md, TOOLS.md, etc.)
  for (const fileName of TIER_BOOTSTRAP_ORDER) {
    let content: string | undefined;
    let resolvedPath = "";

    // Try nested hierarchy dir first
    if (hierarchyDir) {
      resolvedPath = path.join(hierarchyDir, fileName);
      content = await readFileOrUndefined(resolvedPath);
    }
    // Try persona dir
    if (!content && personaDir) {
      resolvedPath = path.join(personaDir, fileName);
      content = await readFileOrUndefined(resolvedPath);
    }
    // Try main workspace dir
    if (!content) {
      resolvedPath = path.join(workspaceDir, fileName);
      content = await readFileOrUndefined(resolvedPath);
    }

    if (content) {
      result.push({
        name: fileName,
        path: resolvedPath,
        content,
        missing: false,
      });
    }
  }

  return result;
}

/**
 * Build a tier-specific system prompt context section.
 * This is injected alongside the standard subagent prompt to give
 * team agents their role-specific instructions.
 */
export function buildTierContextSection(params: {
  tier: AgentTier;
  projectId?: string;
  teamName?: string;
  role?: string;
  memberName?: string;
  managerId?: string;
  leadRole?: string;
}): string {
  const { tier, projectId, teamName, role, memberName, managerId, leadRole } = params;

  const lines: string[] = [
    "# Team Agent Context",
    "",
    `**Tier:** ${tier}`,
  ];

  if (projectId) {
    lines.push(`**Project:** ${projectId}`);
  }
  if (teamName) {
    lines.push(`**Team:** ${teamName}`);
  }
  if (role) {
    lines.push(`**Role:** ${role}`);
  }
  if (memberName) {
    lines.push(`**Name:** ${memberName}`);
  }
  if (managerId) {
    lines.push(`**Manager:** ${managerId}`);
  }
  if (leadRole) {
    lines.push(`**Team Lead:** ${leadRole}`);
  }

  lines.push("");

  // Add hierarchy containment info
  if (managerId) {
    lines.push("## Hierarchy");
    lines.push("");
    if (tier === "manager") {
      lines.push(
        `Your bootstrap files are at: workspace/agents/${managerId}/`,
        `Your team leads are at: workspace/agents/${managerId}/teamleads/`,
        "You can only spawn team leads that exist in your teamleads/ folder.",
      );
    } else if (tier === "team-lead" && leadRole) {
      lines.push(
        `Your bootstrap files are at: workspace/agents/${managerId}/teamleads/${leadRole}/`,
        `Your teammates are at: workspace/agents/${managerId}/teamleads/${leadRole}/teammates/`,
        "You can only spawn teammates that exist in your teammates/ folder.",
      );
    } else if (tier === "teammate" && leadRole && role) {
      lines.push(
        `Your bootstrap files are at: workspace/agents/${managerId}/teamleads/${leadRole}/teammates/${role}/`,
        "You cannot spawn any agents.",
      );
    }
    lines.push("");
  }

  // Add sandbox scope note
  if (projectId) {
    lines.push(
      "## Workspace Scope",
      "",
      `You are scoped to project "${projectId}". All file operations should be`,
      "within the project workspace or shared directories. Do not access files",
      "outside your project scope.",
      "",
    );
  }

  return lines.join("\n");
}
