/**
 * Team Quality Gate Hook
 *
 * Validates task completion quality. Runs as a tool_result_persist hook
 * for team_task_complete calls.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { TaskList } from "../../../teams/types.js";
import type { AgentTier } from "../../../config/types.teams.js";
import { resolveTeamDir } from "../../../teams/team-engine.js";
import { validateMemoryAccess, type ToolMemoryTier } from "../../../teams/memory-permissions.js";

type HookContext = {
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
};

export default async function handler(context: HookContext): Promise<{
  exitCode: number;
  feedback?: string;
}> {
  // Handle team_memory_write validation
  if (context.toolName === "team_memory_write") {
    return validateMemoryWrite(context);
  }

  // Only act on team_task_complete calls
  if (context.toolName !== "team_task_complete") {
    return { exitCode: 0 };
  }

  const projectId =
    typeof context.toolArgs?.projectId === "string"
      ? context.toolArgs.projectId
      : undefined;
  const teamName =
    typeof context.toolArgs?.teamName === "string"
      ? context.toolArgs.teamName
      : undefined;
  const taskId =
    typeof context.toolArgs?.taskId === "number"
      ? context.toolArgs.taskId
      : undefined;

  if (!projectId || !teamName || taskId === undefined) {
    return { exitCode: 0 }; // Missing params, let the tool handle validation
  }

  try {
    const teamDir = resolveTeamDir(projectId, teamName);
    const taskListPath = path.join(teamDir, "task-list.json");
    const raw = await fs.readFile(taskListPath, "utf-8");
    const taskList = JSON.parse(raw) as TaskList;

    const task = taskList.tasks.find((t) => t.id === taskId);
    if (!task) {
      return {
        exitCode: 2,
        feedback: `Quality gate failed: Task #${taskId} not found in task list.`,
      };
    }

    // Check task was assigned
    if (!task.assignedTo) {
      return {
        exitCode: 2,
        feedback: `Quality gate warning: Task #${taskId} "${task.title}" was completed without being assigned to a specific teammate.`,
      };
    }

    // Check that the task was properly in progress
    if (task.status !== "completed" && task.status !== "in_progress" && task.status !== "claimed") {
      return {
        exitCode: 2,
        feedback: `Quality gate failed: Task #${taskId} is in state "${task.status}" — expected "in_progress" or "claimed" before completion.`,
      };
    }

    // Check shared artifacts directory exists (basic quality check)
    const artifactsDir = path.join(
      resolveTeamDir(projectId, ".."),
      "..",
      "shared",
      "artifacts",
    );
    try {
      await fs.stat(artifactsDir);
    } catch {
      // Artifacts dir doesn't exist — this is informational, not blocking
    }

    return { exitCode: 0 };
  } catch {
    // If we can't read the task list, don't block completion
    return { exitCode: 0 };
  }
}

// ---------------------------------------------------------------------------
// team_memory_write validation
// ---------------------------------------------------------------------------

function validateMemoryWrite(context: HookContext): {
  exitCode: number;
  feedback?: string;
} {
  const memoryTier =
    typeof context.toolArgs?.memoryTier === "string"
      ? (context.toolArgs.memoryTier as ToolMemoryTier)
      : undefined;
  const teamName =
    typeof context.toolArgs?.teamName === "string"
      ? context.toolArgs.teamName
      : undefined;
  const agentTier =
    typeof context.toolArgs?.agentTier === "string"
      ? (context.toolArgs.agentTier as AgentTier)
      : undefined;

  if (!memoryTier) {
    return { exitCode: 0 }; // Let the tool handle missing params
  }

  // Validate workspace writes are restricted to GM/Operations
  if (memoryTier === "workspace" && agentTier) {
    const result = validateMemoryAccess({
      agentTier,
      memoryTier: "workspace",
      operation: "write",
    });
    if (!result.allowed) {
      return {
        exitCode: 2,
        feedback: `Memory gate failed: ${result.reason}`,
      };
    }
  }

  // Validate project writes are restricted to Manager+
  if (memoryTier === "project" && agentTier) {
    const result = validateMemoryAccess({
      agentTier,
      memoryTier: "project",
      operation: "write",
    });
    if (!result.allowed) {
      return {
        exitCode: 2,
        feedback: `Memory gate failed: ${result.reason}`,
      };
    }
  }

  // Validate team writes include a teamName
  if (memoryTier === "team" && !teamName) {
    return {
      exitCode: 2,
      feedback: 'Memory gate failed: teamName is required for team memory writes.',
    };
  }

  return { exitCode: 0 };
}
