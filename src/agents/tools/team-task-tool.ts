import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { resolveTeamDir } from "../../teams/team-engine.js";
import {
  claimTask,
  completeTask,
  createTask,
  listClaimableTasks,
  loadTaskList,
  updateTask,
} from "../../teams/task-list.js";
import { jsonResult, readStringParam } from "./common.js";

// ---------------------------------------------------------------------------
// team_task_create
// ---------------------------------------------------------------------------

const TaskCreateSchema = Type.Object({
  projectId: Type.String(),
  teamName: Type.String(),
  title: Type.String(),
  description: Type.Optional(Type.String()),
  dependsOn: Type.Optional(Type.Array(Type.Number())),
  assignedTo: Type.Optional(Type.String()),
});

export function createTeamTaskCreateTool(): AnyAgentTool {
  return {
    label: "Teams",
    name: "team_task_create",
    description:
      "Create a new task in a team's task list. Tasks can have dependencies on other tasks.",
    parameters: TaskCreateSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const projectId = readStringParam(params, "projectId", { required: true });
      const teamName = readStringParam(params, "teamName", { required: true });
      const title = readStringParam(params, "title", { required: true });
      const description = readStringParam(params, "description");
      const dependsOn = Array.isArray(params.dependsOn)
        ? (params.dependsOn as number[])
        : undefined;
      const assignedTo = readStringParam(params, "assignedTo");

      try {
        const teamDir = resolveTeamDir(projectId, teamName);
        const task = await createTask(teamDir, { title, description, dependsOn, assignedTo });
        return jsonResult({ status: "created", task });
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
// team_task_claim
// ---------------------------------------------------------------------------

const TaskClaimSchema = Type.Object({
  projectId: Type.String(),
  teamName: Type.String(),
  taskId: Type.Number(),
  role: Type.Optional(Type.String()),
});

export function createTeamTaskClaimTool(): AnyAgentTool {
  return {
    label: "Teams",
    name: "team_task_claim",
    description:
      "Claim an available task from the team's task list. The task must be pending and have all dependencies completed.",
    parameters: TaskClaimSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const projectId = readStringParam(params, "projectId", { required: true });
      const teamName = readStringParam(params, "teamName", { required: true });
      const taskId = typeof params.taskId === "number" ? params.taskId : 0;
      const role = readStringParam(params, "role") || "unknown";

      try {
        const teamDir = resolveTeamDir(projectId, teamName);
        const task = await claimTask(teamDir, taskId, role);
        return jsonResult({ status: "claimed", task });
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
// team_task_complete
// ---------------------------------------------------------------------------

const TaskCompleteSchema = Type.Object({
  projectId: Type.String(),
  teamName: Type.String(),
  taskId: Type.Number(),
});

export function createTeamTaskCompleteTool(): AnyAgentTool {
  return {
    label: "Teams",
    name: "team_task_complete",
    description:
      "Mark a task as completed. This will automatically unblock any tasks that depended on it.",
    parameters: TaskCompleteSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const projectId = readStringParam(params, "projectId", { required: true });
      const teamName = readStringParam(params, "teamName", { required: true });
      const taskId = typeof params.taskId === "number" ? params.taskId : 0;

      try {
        const teamDir = resolveTeamDir(projectId, teamName);
        const result = await completeTask(teamDir, taskId);
        return jsonResult({
          status: "completed",
          task: result.completed,
          newlyClaimable: result.newlyClaimable.map((t) => ({
            id: t.id,
            title: t.title,
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

// ---------------------------------------------------------------------------
// team_task_list
// ---------------------------------------------------------------------------

const TaskListSchema = Type.Object({
  projectId: Type.String(),
  teamName: Type.String(),
  filter: Type.Optional(Type.String()),
});

export function createTeamTaskListTool(): AnyAgentTool {
  return {
    label: "Teams",
    name: "team_task_list",
    description:
      "List all tasks in a team's task list. Optionally filter by status (pending, claimed, in_progress, completed, failed, claimable).",
    parameters: TaskListSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const projectId = readStringParam(params, "projectId", { required: true });
      const teamName = readStringParam(params, "teamName", { required: true });
      const filter = readStringParam(params, "filter");

      try {
        const teamDir = resolveTeamDir(projectId, teamName);

        if (filter === "claimable") {
          const claimable = await listClaimableTasks(teamDir);
          return jsonResult({ status: "ok", tasks: claimable, filter: "claimable" });
        }

        const taskList = await loadTaskList(teamDir);
        if (!taskList) {
          return jsonResult({ status: "error", error: "Task list not found." });
        }

        const tasks = filter
          ? taskList.tasks.filter((t) => t.status === filter)
          : taskList.tasks;

        return jsonResult({
          status: "ok",
          teamName: taskList.teamName,
          projectId: taskList.projectId,
          teamStatus: taskList.status,
          tasks,
          summary: {
            total: taskList.tasks.length,
            pending: taskList.tasks.filter((t) => t.status === "pending").length,
            claimed: taskList.tasks.filter((t) => t.status === "claimed").length,
            in_progress: taskList.tasks.filter((t) => t.status === "in_progress").length,
            completed: taskList.tasks.filter((t) => t.status === "completed").length,
            failed: taskList.tasks.filter((t) => t.status === "failed").length,
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
// team_task_update
// ---------------------------------------------------------------------------

const TaskUpdateSchema = Type.Object({
  projectId: Type.String(),
  teamName: Type.String(),
  taskId: Type.Number(),
  status: Type.Optional(Type.String()),
  assignedTo: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
});

export function createTeamTaskUpdateTool(): AnyAgentTool {
  return {
    label: "Teams",
    name: "team_task_update",
    description:
      "Update a task's properties (status, assignee, title, description). Use team_task_claim or team_task_complete for those specific transitions.",
    parameters: TaskUpdateSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const projectId = readStringParam(params, "projectId", { required: true });
      const teamName = readStringParam(params, "teamName", { required: true });
      const taskId = typeof params.taskId === "number" ? params.taskId : 0;

      try {
        const teamDir = resolveTeamDir(projectId, teamName);
        const task = await updateTask(teamDir, taskId, {
          status: readStringParam(params, "status") as
            | "pending"
            | "claimed"
            | "in_progress"
            | "completed"
            | "failed"
            | undefined,
          assignedTo: readStringParam(params, "assignedTo"),
          title: readStringParam(params, "title"),
          description: readStringParam(params, "description"),
        });
        return jsonResult({ status: "updated", task });
      } catch (err) {
        return jsonResult({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
