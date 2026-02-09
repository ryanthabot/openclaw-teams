import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";
import {
  appendProjectDailyLog,
  appendTeamDailyLog,
  listProjectMemoryFiles,
  listTeamMemoryFiles,
  readProjectMemory,
  readTeamMemory,
  writeProjectMemory,
  writeTeamMemory,
} from "../../teams/project-memory.js";
import { resolveProjectDir, resolveTeamDir } from "../../teams/team-engine.js";
import fs from "node:fs/promises";

// ---------------------------------------------------------------------------
// team_memory_write
// ---------------------------------------------------------------------------

const MemoryWriteSchema = Type.Object({
  projectId: Type.String(),
  memoryTier: Type.Union([
    Type.Literal("workspace"),
    Type.Literal("project"),
    Type.Literal("team"),
  ]),
  teamName: Type.Optional(Type.String()),
  content: Type.String(),
  target: Type.Optional(
    Type.Union([Type.Literal("curated"), Type.Literal("daily")]),
  ),
});

export function createTeamMemoryWriteTool(): AnyAgentTool {
  return {
    label: "Teams",
    name: "team_memory_write",
    description:
      'Write to project or team memory. memoryTier: "project" writes to project-level memory, "team" writes to team-level memory. target: "curated" writes to MEMORY.md, "daily" (default) appends to today\'s daily log.',
    parameters: MemoryWriteSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const projectId = readStringParam(params, "projectId", { required: true });
      const memoryTier = readStringParam(params, "memoryTier", { required: true }) as
        | "workspace"
        | "project"
        | "team";
      const teamName = readStringParam(params, "teamName");
      const content = readStringParam(params, "content", { required: true });
      const target =
        (readStringParam(params, "target") as "curated" | "daily" | undefined) ?? "daily";

      try {
        if (memoryTier === "workspace") {
          // Workspace-level memory is handled by the agent's own memory system.
          // This tool provides a pass-through acknowledgment; actual workspace
          // writes should be done through the agent workspace MEMORY.md file.
          return jsonResult({
            status: "info",
            message:
              "Workspace memory writes should be done via your agent workspace MEMORY.md. " +
              "Use exec/file tools to write to your workspace memory directly.",
          });
        }

        if (memoryTier === "team") {
          if (!teamName) {
            return jsonResult({
              status: "error",
              error: 'teamName is required when memoryTier is "team"',
            });
          }
          // Validate team directory exists
          const teamDir = resolveTeamDir(projectId, teamName);
          try {
            await fs.stat(teamDir);
          } catch {
            return jsonResult({
              status: "error",
              error: `Team "${teamName}" not found in project "${projectId}"`,
            });
          }

          if (target === "curated") {
            await writeTeamMemory(projectId, teamName, content);
          } else {
            await appendTeamDailyLog(projectId, teamName, content);
          }
          return jsonResult({
            status: "ok",
            memoryTier,
            teamName,
            target,
          });
        }

        // memoryTier === "project"
        // Validate project directory exists
        const projectDir = resolveProjectDir(projectId);
        try {
          await fs.stat(projectDir);
        } catch {
          return jsonResult({
            status: "error",
            error: `Project "${projectId}" not found`,
          });
        }

        if (target === "curated") {
          await writeProjectMemory(projectId, content);
        } else {
          await appendProjectDailyLog(projectId, content);
        }
        return jsonResult({
          status: "ok",
          memoryTier,
          target,
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
// team_memory_read
// ---------------------------------------------------------------------------

const MemoryReadSchema = Type.Object({
  projectId: Type.String(),
  memoryTier: Type.Union([
    Type.Literal("workspace"),
    Type.Literal("project"),
    Type.Literal("team"),
  ]),
  teamName: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
});

export function createTeamMemoryReadTool(): AnyAgentTool {
  return {
    label: "Teams",
    name: "team_memory_read",
    description:
      'Read from project or team memory. Defaults to reading MEMORY.md. Specify path for a specific file (e.g. "daily/2026-01-15.md").',
    parameters: MemoryReadSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const projectId = readStringParam(params, "projectId", { required: true });
      const memoryTier = readStringParam(params, "memoryTier", { required: true }) as
        | "workspace"
        | "project"
        | "team";
      const teamName = readStringParam(params, "teamName");
      const relativePath = readStringParam(params, "path");

      try {
        if (memoryTier === "workspace") {
          return jsonResult({
            status: "info",
            message:
              "Workspace memory reads should be done via your agent workspace MEMORY.md. " +
              "Use exec/file tools to read your workspace memory directly.",
          });
        }

        if (memoryTier === "team") {
          if (!teamName) {
            return jsonResult({
              status: "error",
              error: 'teamName is required when memoryTier is "team"',
            });
          }
          const content = await readTeamMemory(projectId, teamName, relativePath || undefined);
          return jsonResult({
            status: "ok",
            memoryTier,
            teamName,
            path: relativePath || "MEMORY.md",
            content: content || "(empty)",
          });
        }

        // memoryTier === "project"
        const content = await readProjectMemory(projectId, relativePath || undefined);
        return jsonResult({
          status: "ok",
          memoryTier,
          path: relativePath || "MEMORY.md",
          content: content || "(empty)",
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
// team_memory_list
// ---------------------------------------------------------------------------

const MemoryListSchema = Type.Object({
  projectId: Type.String(),
  memoryTier: Type.Union([Type.Literal("project"), Type.Literal("team")]),
  teamName: Type.Optional(Type.String()),
});

export function createTeamMemoryListTool(): AnyAgentTool {
  return {
    label: "Teams",
    name: "team_memory_list",
    description:
      "List all memory files in the specified scope (project or team). Returns relative file paths.",
    parameters: MemoryListSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const projectId = readStringParam(params, "projectId", { required: true });
      const memoryTier = readStringParam(params, "memoryTier", { required: true }) as
        | "project"
        | "team";
      const teamName = readStringParam(params, "teamName");

      try {
        if (memoryTier === "team") {
          if (!teamName) {
            return jsonResult({
              status: "error",
              error: 'teamName is required when memoryTier is "team"',
            });
          }
          const files = await listTeamMemoryFiles(projectId, teamName);
          return jsonResult({
            status: "ok",
            memoryTier,
            teamName,
            files,
          });
        }

        // memoryTier === "project"
        const files = await listProjectMemoryFiles(projectId);
        return jsonResult({
          status: "ok",
          memoryTier,
          files,
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
