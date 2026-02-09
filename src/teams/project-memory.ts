import fs from "node:fs/promises";
import path from "node:path";
import { resolveProjectDir, resolveTeamDir } from "./team-engine.js";

// ---------------------------------------------------------------------------
// Path resolvers
// ---------------------------------------------------------------------------

/** Resolve the memory directory for a project. */
export function resolveProjectMemoryDir(projectId: string): string {
  return path.join(resolveProjectDir(projectId), "memory");
}

/** Resolve the memory directory for a team within a project. */
export function resolveTeamMemoryDir(projectId: string, teamName: string): string {
  return path.join(resolveTeamDir(projectId, teamName), "memory");
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/** Write (overwrite) the curated MEMORY.md for a project. */
export async function writeProjectMemory(projectId: string, content: string): Promise<void> {
  const memDir = resolveProjectMemoryDir(projectId);
  await ensureDirExists(memDir);
  await fs.writeFile(path.join(memDir, "MEMORY.md"), content, "utf-8");
}

/** Append an entry to today's daily log for a project. */
export async function appendProjectDailyLog(projectId: string, entry: string): Promise<void> {
  const dailyDir = path.join(resolveProjectMemoryDir(projectId), "daily");
  await ensureDirExists(dailyDir);
  const fileName = todayFileName();
  await appendToFile(path.join(dailyDir, fileName), entry);
}

/** Write (overwrite) the curated MEMORY.md for a team. */
export async function writeTeamMemory(
  projectId: string,
  teamName: string,
  content: string,
): Promise<void> {
  const memDir = resolveTeamMemoryDir(projectId, teamName);
  await ensureDirExists(memDir);
  await fs.writeFile(path.join(memDir, "MEMORY.md"), content, "utf-8");
}

/** Append an entry to today's daily log for a team. */
export async function appendTeamDailyLog(
  projectId: string,
  teamName: string,
  entry: string,
): Promise<void> {
  const dailyDir = path.join(resolveTeamMemoryDir(projectId, teamName), "daily");
  await ensureDirExists(dailyDir);
  const fileName = todayFileName();
  await appendToFile(path.join(dailyDir, fileName), entry);
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/** Read a file from project memory. Defaults to MEMORY.md. */
export async function readProjectMemory(
  projectId: string,
  relativePath?: string,
): Promise<string> {
  const memDir = resolveProjectMemoryDir(projectId);
  const target = relativePath ? path.join(memDir, relativePath) : path.join(memDir, "MEMORY.md");
  return safeReadFile(target);
}

/** Read a file from team memory. Defaults to MEMORY.md. */
export async function readTeamMemory(
  projectId: string,
  teamName: string,
  relativePath?: string,
): Promise<string> {
  const memDir = resolveTeamMemoryDir(projectId, teamName);
  const target = relativePath ? path.join(memDir, relativePath) : path.join(memDir, "MEMORY.md");
  return safeReadFile(target);
}

// ---------------------------------------------------------------------------
// List operations
// ---------------------------------------------------------------------------

/** List all memory files for a project (relative paths). */
export async function listProjectMemoryFiles(projectId: string): Promise<string[]> {
  const memDir = resolveProjectMemoryDir(projectId);
  return listFilesRecursive(memDir, memDir);
}

/** List all memory files for a team (relative paths). */
export async function listTeamMemoryFiles(
  projectId: string,
  teamName: string,
): Promise<string[]> {
  const memDir = resolveTeamMemoryDir(projectId, teamName);
  return listFilesRecursive(memDir, memDir);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function todayFileName(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}.md`;
}

async function ensureDirExists(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function appendToFile(filePath: string, entry: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const formatted = `\n---\n**${timestamp}**\n\n${entry}\n`;
  await fs.appendFile(filePath, formatted, "utf-8");
}

async function safeReadFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

async function listFilesRecursive(dir: string, baseDir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) {
      const nested = await listFilesRecursive(fullPath, baseDir);
      results.push(...nested);
    } else {
      results.push(path.relative(baseDir, fullPath).replace(/\\/g, "/"));
    }
  }
  return results;
}
