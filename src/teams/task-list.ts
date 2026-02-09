import fs from "node:fs/promises";
import path from "node:path";
import type { Task, TaskList, TaskStatus } from "./types.js";

/** Load a team's task list from disk. Returns null if not found. */
export async function loadTaskList(teamDir: string): Promise<TaskList | null> {
  const filePath = path.join(teamDir, "task-list.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as TaskList;
  } catch {
    return null;
  }
}

/** Save a team's task list to disk. */
export async function saveTaskList(teamDir: string, taskList: TaskList): Promise<void> {
  const filePath = path.join(teamDir, "task-list.json");
  await fs.writeFile(filePath, JSON.stringify(taskList, null, 2) + "\n", "utf-8");
}

/** Create a new task and add it to the task list. Returns the new task. */
export async function createTask(
  teamDir: string,
  params: {
    title: string;
    description?: string;
    dependsOn?: number[];
    assignedTo?: string;
  },
): Promise<Task> {
  const taskList = await loadTaskList(teamDir);
  if (!taskList) {
    throw new Error("Task list not found. Initialize team runtime first.");
  }

  const maxId = taskList.tasks.reduce((max, t) => Math.max(max, t.id), 0);
  const task: Task = {
    id: maxId + 1,
    title: params.title,
    description: params.description,
    status: "pending",
    assignedTo: params.assignedTo,
    dependsOn: params.dependsOn ?? [],
    createdAt: new Date().toISOString(),
  };

  taskList.tasks.push(task);
  await saveTaskList(teamDir, taskList);
  return task;
}

/**
 * Claim a pending task. Verifies all dependencies are completed.
 * Returns the claimed task or throws if claim is not allowed.
 */
export async function claimTask(
  teamDir: string,
  taskId: number,
  agentRole: string,
): Promise<Task> {
  const taskList = await loadTaskList(teamDir);
  if (!taskList) {
    throw new Error("Task list not found.");
  }

  const task = taskList.tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found.`);
  }

  if (task.status !== "pending") {
    throw new Error(`Task ${taskId} is "${task.status}", cannot claim.`);
  }

  // Check dependencies
  const unmetDeps = findUnmetDependencies(taskList, task);
  if (unmetDeps.length > 0) {
    throw new Error(
      `Task ${taskId} has unmet dependencies: ${unmetDeps.map((d) => `#${d.id} (${d.status})`).join(", ")}.`,
    );
  }

  task.status = "claimed";
  task.assignedTo = agentRole;
  await saveTaskList(teamDir, taskList);
  return task;
}

/**
 * Start working on a claimed task (move from claimed to in_progress).
 */
export async function startTask(
  teamDir: string,
  taskId: number,
): Promise<Task> {
  const taskList = await loadTaskList(teamDir);
  if (!taskList) {
    throw new Error("Task list not found.");
  }

  const task = taskList.tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found.`);
  }

  if (task.status !== "claimed") {
    throw new Error(`Task ${taskId} is "${task.status}", expected "claimed".`);
  }

  task.status = "in_progress";
  await saveTaskList(teamDir, taskList);
  return task;
}

/**
 * Complete a task. Returns the list of tasks that became claimable
 * as a result of this completion (dependency resolution).
 */
export async function completeTask(
  teamDir: string,
  taskId: number,
): Promise<{ completed: Task; newlyClaimable: Task[] }> {
  const taskList = await loadTaskList(teamDir);
  if (!taskList) {
    throw new Error("Task list not found.");
  }

  const task = taskList.tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found.`);
  }

  if (task.status !== "in_progress" && task.status !== "claimed") {
    throw new Error(`Task ${taskId} is "${task.status}", cannot complete.`);
  }

  task.status = "completed";
  task.completedAt = new Date().toISOString();
  await saveTaskList(teamDir, taskList);

  // Find tasks that just became claimable
  const newlyClaimable = taskList.tasks.filter((t) => {
    if (t.status !== "pending") {
      return false;
    }
    if (!t.dependsOn.includes(taskId)) {
      return false;
    }
    return findUnmetDependencies(taskList, t).length === 0;
  });

  // Check if all tasks are done
  const allDone = taskList.tasks.every(
    (t) => t.status === "completed" || t.status === "failed",
  );
  if (allDone) {
    taskList.status = "completed";
    await saveTaskList(teamDir, taskList);
  }

  return { completed: task, newlyClaimable };
}

/** Mark a task as failed with a reason. */
export async function failTask(
  teamDir: string,
  taskId: number,
  reason: string,
): Promise<Task> {
  const taskList = await loadTaskList(teamDir);
  if (!taskList) {
    throw new Error("Task list not found.");
  }

  const task = taskList.tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found.`);
  }

  task.status = "failed";
  task.failedReason = reason;
  await saveTaskList(teamDir, taskList);
  return task;
}

/** List all tasks that can currently be claimed (pending + all deps completed). */
export async function listClaimableTasks(teamDir: string): Promise<Task[]> {
  const taskList = await loadTaskList(teamDir);
  if (!taskList) {
    return [];
  }

  return taskList.tasks.filter((t) => {
    if (t.status !== "pending") {
      return false;
    }
    return findUnmetDependencies(taskList, t).length === 0;
  });
}

/** Get a single task by ID. */
export async function getTaskById(
  teamDir: string,
  taskId: number,
): Promise<Task | null> {
  const taskList = await loadTaskList(teamDir);
  if (!taskList) {
    return null;
  }
  return taskList.tasks.find((t) => t.id === taskId) ?? null;
}

/** Update a task's properties. */
export async function updateTask(
  teamDir: string,
  taskId: number,
  updates: { status?: TaskStatus; assignedTo?: string; title?: string; description?: string },
): Promise<Task> {
  const taskList = await loadTaskList(teamDir);
  if (!taskList) {
    throw new Error("Task list not found.");
  }

  const task = taskList.tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found.`);
  }

  if (updates.status !== undefined) {
    task.status = updates.status;
  }
  if (updates.assignedTo !== undefined) {
    task.assignedTo = updates.assignedTo;
  }
  if (updates.title !== undefined) {
    task.title = updates.title;
  }
  if (updates.description !== undefined) {
    task.description = updates.description;
  }

  await saveTaskList(teamDir, taskList);
  return task;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findUnmetDependencies(taskList: TaskList, task: Task): Task[] {
  return task.dependsOn
    .map((depId) => taskList.tasks.find((t) => t.id === depId))
    .filter((dep): dep is Task => dep !== undefined && dep.status !== "completed");
}
