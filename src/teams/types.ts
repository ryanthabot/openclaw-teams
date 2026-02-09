/** Task status within a team's task list. */
export type TaskStatus = "pending" | "claimed" | "in_progress" | "completed" | "failed";

/** A single task in a team's task list. */
export type Task = {
  id: number;
  title: string;
  description?: string;
  status: TaskStatus;
  /** Role of the teammate assigned to or who claimed this task. */
  assignedTo?: string;
  /** Task IDs that must be completed before this task can be claimed. */
  dependsOn: number[];
  createdAt: string;
  completedAt?: string;
  /** Reason for failure (set when status is "failed"). */
  failedReason?: string;
};

/** A team's full task list for a project. */
export type TaskList = {
  teamName: string;
  projectId: string;
  status: "active" | "completed" | "archived";
  tasks: Task[];
};

/** A message in the team mailbox. */
export type MailboxMessage = {
  id: string;
  /** Role of the sender. */
  from: string;
  /** Role of the recipient, or "*" for broadcast to all teammates. */
  to: string | "*";
  timestamp: string;
  body: string;
  /** Whether this message has been read by the recipient. */
  read?: boolean;
};

/** Memory access level. */
export type MemoryAccessLevel = "read" | "write" | "none";

/** Memory tier in the three-tier memory system. */
export type MemoryTier = "company" | "project-shared" | "team";

/** Runtime state for a team instance within a project. */
export type TeamRuntime = {
  teamName: string;
  templateId: string;
  projectId: string;
  /** Absolute path to the team's runtime directory. */
  teamDir: string;
  /** Current task list. */
  taskList: TaskList;
};

/** Project metadata. */
export type ProjectInfo = {
  projectId: string;
  /** Absolute path to the project directory. */
  projectDir: string;
  createdAt: string;
  status: "active" | "completed" | "archived";
  brief?: string;
  /** List of active team names within this project. */
  teams: string[];
};
