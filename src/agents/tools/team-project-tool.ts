import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import type { TeamTemplate } from "../../config/types.teams.js";
import { loadConfig } from "../../config/config.js";
import {
  createProjectWorkspace,
  createTeamRuntime,
  getProjectStatus,
  listProjects,
} from "../../teams/team-engine.js";
import { ensureManagerHierarchyStructure } from "../../teams/team-bootstrap.js";
import { resolveDefaultAgentWorkspaceDir } from "../workspace.js";
import { jsonResult, readStringParam } from "./common.js";

// ---------------------------------------------------------------------------
// team_project_create
// ---------------------------------------------------------------------------

const ProjectCreateSchema = Type.Object({
  projectId: Type.String(),
  brief: Type.Optional(Type.String()),
  spawnTeams: Type.Optional(Type.Array(Type.String())),
});

export function createTeamProjectCreateTool(): AnyAgentTool {
  return {
    label: "Teams",
    name: "team_project_create",
    description:
      "Create a new project workspace with shared memory directories. Optionally spawn team instances from configured templates.",
    parameters: ProjectCreateSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const projectId = readStringParam(params, "projectId", { required: true });
      const brief = readStringParam(params, "brief");
      const spawnTeams = Array.isArray(params.spawnTeams)
        ? (params.spawnTeams as string[])
        : undefined;

      try {
        const projectDir = await createProjectWorkspace(projectId, brief);
        const spawnedTeams: string[] = [];

        // Scaffold per-manager hierarchies
        const workspaceDir = resolveDefaultAgentWorkspaceDir();
        const cfg = loadConfig();
        const agents = cfg.agents?.list ?? [];
        const allTemplates = ((cfg as Record<string, unknown>).teams as
          | { templates?: Record<string, import("../../config/types.teams.js").TeamTemplate> }
          | undefined)?.templates;

        if (allTemplates) {
          for (const agent of agents) {
            const raw = agent as Record<string, unknown>;
            const agentTeams = raw.agentTeams as { enabled?: boolean; templates?: string[] } | undefined;
            if (raw.tier === "manager" && agentTeams?.enabled && agentTeams.templates) {
              const assigned: Record<string, import("../../config/types.teams.js").TeamTemplate> = {};
              for (const tId of agentTeams.templates) {
                if (allTemplates[tId]) {
                  assigned[tId] = allTemplates[tId];
                }
              }
              if (Object.keys(assigned).length > 0) {
                try {
                  await ensureManagerHierarchyStructure(workspaceDir, agent.id, assigned);
                } catch {
                  // Non-fatal
                }
              }
            }
          }
        }

        if (spawnTeams && spawnTeams.length > 0) {
          const cfg = loadConfig();
          const templates = (cfg as Record<string, unknown>).teams as
            | { templates?: Record<string, TeamTemplate> }
            | undefined;

          for (const templateId of spawnTeams) {
            const template = templates?.templates?.[templateId];
            if (!template) {
              return jsonResult({
                status: "error",
                error: `Team template "${templateId}" not found in config.`,
                projectDir,
              });
            }
            await createTeamRuntime(projectId, templateId, template);
            spawnedTeams.push(templateId);
          }
        }

        // Build hierarchy info for the response
        const hierarchyInfo: Record<string, { manager: string; teamleads: string }> = {};
        for (const agent of agents) {
          const raw = agent as Record<string, unknown>;
          const agentTeams = raw.agentTeams as { enabled?: boolean; templates?: string[] } | undefined;
          if (raw.tier === "manager" && agentTeams?.enabled) {
            hierarchyInfo[agent.id] = {
              manager: `${workspaceDir}/agents/${agent.id}/`,
              teamleads: `${workspaceDir}/agents/${agent.id}/teamleads/`,
            };
          }
        }

        return jsonResult({
          status: "created",
          projectId,
          projectDir,
          spawnedTeams,
          workspaceStructure: {
            hierarchy: hierarchyInfo,
            note: "Each manager owns its team leads and teammates in nested folders.",
          },
        });
      } catch (err) {
        return jsonResult({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// team_project_status
// ---------------------------------------------------------------------------

const ProjectStatusSchema = Type.Object({
  projectId: Type.Optional(Type.String()),
});

export function createTeamProjectStatusTool(): AnyAgentTool {
  return {
    label: "Teams",
    name: "team_project_status",
    description:
      "Get the status of a project including team progress and task summaries. If no projectId is provided, lists all projects.",
    parameters: ProjectStatusSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const projectId = readStringParam(params, "projectId");

      try {
        if (!projectId) {
          const projects = await listProjects();
          return jsonResult({
            status: "ok",
            projects: projects.map((p) => ({
              projectId: p.projectId,
              status: p.status,
              teams: p.teams,
              createdAt: p.createdAt,
            })),
          });
        }

        const result = await getProjectStatus(projectId);
        if (!result) {
          return jsonResult({ status: "error", error: `Project "${projectId}" not found.` });
        }

        return jsonResult({
          status: "ok",
          project: {
            projectId: result.project.projectId,
            status: result.project.status,
            createdAt: result.project.createdAt,
            teams: result.project.teams,
          },
          teamStatuses: result.teamStatuses.map((ts) => ({
            team: ts.team,
            taskListStatus: ts.taskList?.status ?? "no task list",
            taskSummary: ts.taskList
              ? {
                  total: ts.taskList.tasks.length,
                  pending: ts.taskList.tasks.filter((t) => t.status === "pending").length,
                  claimed: ts.taskList.tasks.filter((t) => t.status === "claimed").length,
                  in_progress: ts.taskList.tasks.filter(
                    (t) => t.status === "in_progress",
                  ).length,
                  completed: ts.taskList.tasks.filter((t) => t.status === "completed").length,
                  failed: ts.taskList.tasks.filter((t) => t.status === "failed").length,
                }
              : null,
          })),
        });
      } catch (err) {
        return jsonResult({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
