import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TeamTemplate } from "../config/types.teams.js";
import type { ProjectInfo, TaskList } from "./types.js";
import { resolveStateDir } from "../config/paths.js";
import { resolveDefaultAgentWorkspaceDir } from "../agents/workspace.js";
import { ensureManagerHierarchyStructure } from "./team-bootstrap.js";
import { loadConfig } from "../config/config.js";

/** Resolve the root projects directory. */
export function resolveProjectsDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const stateDir = resolveStateDir(env, homedir);
  return path.join(stateDir, "projects");
}

/** Resolve a specific project's directory. */
export function resolveProjectDir(projectId: string): string {
  return path.join(resolveProjectsDir(), projectId);
}

/** Resolve a team's runtime directory within a project. */
export function resolveTeamDir(projectId: string, teamName: string): string {
  return path.join(resolveProjectDir(projectId), "teams", teamName);
}

/**
 * Create a new project workspace with standard directory structure.
 * Also scaffolds per-manager nested hierarchy directories
 * in the main agent workspace (/workspace/agents/<managerId>/teamleads/...).
 * Returns the project directory path.
 */
export async function createProjectWorkspace(
  projectId: string,
  brief?: string,
): Promise<string> {
  const projectDir = resolveProjectDir(projectId);

  // Create directory structure
  await fs.mkdir(path.join(projectDir, "shared", "artifacts"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "teams"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "memory", "daily"), { recursive: true });

  // Write PROJECT.md
  const projectMd = [
    `# Project: ${projectId}`,
    "",
    `Created: ${new Date().toISOString()}`,
    `Status: active`,
    "",
    "## Brief",
    "",
    brief ?? "_No brief provided. Update this file with project details._",
    "",
  ].join("\n");
  await writeIfMissing(path.join(projectDir, "PROJECT.md"), projectMd);

  // Write STATUS.md
  const statusMd = [
    `# ${projectId} — Status`,
    "",
    `Last updated: ${new Date().toISOString()}`,
    "",
    "## Teams",
    "",
    "_No teams spawned yet._",
    "",
    "## Progress",
    "",
    "_Awaiting team assignment._",
    "",
  ].join("\n");
  await writeIfMissing(path.join(projectDir, "STATUS.md"), statusMd);

  // Seed project-level MEMORY.md
  const memoryMd = [
    `# Project Memory: ${projectId}`,
    "",
    `Created: ${new Date().toISOString()}`,
    "",
    "## Notes",
    "",
    "_Project-level memory. Managers write findings and decisions here._",
    "",
  ].join("\n");
  await writeIfMissing(path.join(projectDir, "memory", "MEMORY.md"), memoryMd);

  // Write shared context files
  await writeIfMissing(
    path.join(projectDir, "shared", "brief.md"),
    brief ? `# Brief\n\n${brief}\n` : "# Brief\n\n_Update with project brief._\n",
  );
  await writeIfMissing(
    path.join(projectDir, "shared", "context.md"),
    "# Shared Context\n\n_Teams write shared findings and context here._\n",
  );
  await writeIfMissing(
    path.join(projectDir, "shared", "decisions.md"),
    "# Decisions Log\n\n_Record project decisions and rationale here._\n",
  );

  // Scaffold per-manager hierarchies if managers are configured
  const workspaceDir = resolveDefaultAgentWorkspaceDir();
  try {
    const cfg = loadConfig();
    const agents = cfg.agents?.list ?? [];
    const teams = (cfg as Record<string, unknown>).teams as
      | { templates?: Record<string, TeamTemplate> }
      | undefined;
    if (teams?.templates) {
      for (const agent of agents) {
        const raw = agent as Record<string, unknown>;
        const agentTeams = raw.agentTeams as { enabled?: boolean; templates?: string[] } | undefined;
        if (raw.tier === "manager" && agentTeams?.enabled && agentTeams.templates) {
          const assigned: Record<string, TeamTemplate> = {};
          for (const tId of agentTeams.templates) {
            if (teams.templates[tId]) {
              assigned[tId] = teams.templates[tId];
            }
          }
          if (Object.keys(assigned).length > 0) {
            await ensureManagerHierarchyStructure(workspaceDir, agent.id, assigned);
          }
        }
      }
    }
  } catch {
    // Non-fatal: hierarchy scaffolding is supplementary
  }

  return projectDir;
}

/**
 * Create a team's runtime directory within a project.
 * Initializes task-list.json, team-context.md, and mailbox directories.
 * Initializes task-list.json, team-context.md, and mailbox directories.
 */
export async function createTeamRuntime(
  projectId: string,
  templateId: string,
  template: TeamTemplate,
): Promise<string> {
  const teamDir = resolveTeamDir(projectId, templateId);

  await fs.mkdir(path.join(teamDir, "mailbox", "messages"), { recursive: true });
  await fs.mkdir(path.join(teamDir, "mailbox", "broadcasts"), { recursive: true });
  await fs.mkdir(path.join(teamDir, "teammates"), { recursive: true });
  await fs.mkdir(path.join(teamDir, "memory", "daily"), { recursive: true });

  // Initialize empty task list
  const taskList: TaskList = {
    teamName: template.teamName,
    projectId,
    status: "active",
    tasks: [],
  };
  await writeIfMissing(
    path.join(teamDir, "task-list.json"),
    JSON.stringify(taskList, null, 2) + "\n",
  );

  // Seed team-level MEMORY.md
  const teamMemoryMd = [
    `# Team Memory: ${template.teamName}`,
    "",
    `Project: ${projectId}`,
    `Created: ${new Date().toISOString()}`,
    "",
    "## Notes",
    "",
    "_Team-level memory. Team leads and teammates write notes and decisions here._",
    "",
  ].join("\n");
  await writeIfMissing(path.join(teamDir, "memory", "MEMORY.md"), teamMemoryMd);

  // Team context — include bootstrap files info for agents to understand their workspace
  const teamContextLines = [
    `# ${template.teamName}`,
    "",
    `Project: ${projectId}`,
    `Template: ${templateId}`,
    `Team Lead: ${template.teamLead.role}${template.teamLead.name ? ` (${template.teamLead.name})` : ""}`,
    `Teammates: ${template.teammates.map((t) => t.role).join(", ")}`,
    "",
    "## Bootstrap Files",
    "",
    "Each tier has its own bootstrap workspace. The system uses a nested hierarchy",
    "structure where each manager owns its team leads and teammates:",
    "",
    "- Manager: /workspace/agents/<managerId>/",
    "- Team Lead: /workspace/agents/<managerId>/teamleads/<leadRole>/",
    "- Teammate: /workspace/agents/<managerId>/teamleads/<leadRole>/teammates/<mateRole>/",
    "",
    "Edit bootstrap files in these directories to customize agent behavior per agent.",
    "",
    "## Team Notes",
    "",
    "_Team-specific context and coordination notes go here._",
    "",
  ];
  await writeIfMissing(path.join(teamDir, "team-context.md"), teamContextLines.join("\n"));

  // Team config
  const teamConfig = {
    templateId,
    teamName: template.teamName,
    teamLead: template.teamLead,
    teammates: template.teammates,
    defaults: template.defaults ?? { taskClaiming: "self-claim" },
    createdAt: new Date().toISOString(),
  };
  await writeIfMissing(
    path.join(teamDir, "config.json"),
    JSON.stringify(teamConfig, null, 2) + "\n",
  );

  return teamDir;
}

/** List all projects. */
export async function listProjects(): Promise<ProjectInfo[]> {
  const projectsDir = resolveProjectsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(projectsDir);
  } catch {
    return [];
  }

  const projects: ProjectInfo[] = [];
  for (const entry of entries) {
    const projectDir = path.join(projectsDir, entry);
    const stat = await fs.stat(projectDir).catch(() => null);
    if (!stat?.isDirectory()) {
      continue;
    }

    const projectMdPath = path.join(projectDir, "PROJECT.md");
    let createdAt = stat.birthtime.toISOString();
    let status: ProjectInfo["status"] = "active";
    let brief: string | undefined;

    try {
      const content = await fs.readFile(projectMdPath, "utf-8");
      const createdMatch = content.match(/Created:\s*(.+)/);
      if (createdMatch) {
        createdAt = createdMatch[1].trim();
      }
      const statusMatch = content.match(/Status:\s*(.+)/);
      if (statusMatch) {
        const s = statusMatch[1].trim().toLowerCase();
        if (s === "completed" || s === "archived") {
          status = s;
        }
      }
    } catch {
      // PROJECT.md missing; use defaults
    }

    try {
      const briefContent = await fs.readFile(path.join(projectDir, "shared", "brief.md"), "utf-8");
      brief = briefContent.slice(0, 500);
    } catch {
      // no brief
    }

    // List teams
    const teamsDir = path.join(projectDir, "teams");
    let teams: string[] = [];
    try {
      const teamEntries = await fs.readdir(teamsDir);
      for (const te of teamEntries) {
        const teamStat = await fs.stat(path.join(teamsDir, te)).catch(() => null);
        if (teamStat?.isDirectory()) {
          teams.push(te);
        }
      }
    } catch {
      // no teams dir
    }

    projects.push({ projectId: entry, projectDir, createdAt, status, brief, teams });
  }

  return projects;
}

/** Get detailed status of a project. */
export async function getProjectStatus(
  projectId: string,
): Promise<{ project: ProjectInfo; teamStatuses: Array<{ team: string; taskList: TaskList | null }> } | null> {
  const projectDir = resolveProjectDir(projectId);
  try {
    await fs.stat(projectDir);
  } catch {
    return null;
  }

  const projects = await listProjects();
  const project = projects.find((p) => p.projectId === projectId);
  if (!project) {
    return null;
  }

  const teamStatuses: Array<{ team: string; taskList: TaskList | null }> = [];
  for (const teamName of project.teams) {
    const taskListPath = path.join(projectDir, "teams", teamName, "task-list.json");
    let taskList: TaskList | null = null;
    try {
      const raw = await fs.readFile(taskListPath, "utf-8");
      taskList = JSON.parse(raw) as TaskList;
    } catch {
      // no task list
    }
    teamStatuses.push({ team: teamName, taskList });
  }

  return { project, teamStatuses };
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.writeFile(filePath, content, { encoding: "utf-8", flag: "wx" });
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== "EEXIST") {
      throw err;
    }
  }
}
