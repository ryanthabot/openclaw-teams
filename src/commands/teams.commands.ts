import fs from "node:fs/promises";
import path from "node:path";
import type { TeamTemplate } from "../config/types.teams.js";
import type { RuntimeEnv } from "../runtime.js";
import { loadConfig, writeConfigFile } from "../config/config.js";
import { logConfigUpdated } from "../config/logging.js";
import { defaultRuntime } from "../runtime.js";
import { shortenHomePath } from "../utils.js";
import { createClackPrompter } from "../wizard/clack-prompter.js";
import { WizardCancelledError } from "../wizard/prompts.js";
import {
  createProjectWorkspace,
  createTeamRuntime,
  getProjectStatus,
  listProjects,
  resolveProjectDir,
} from "../teams/team-engine.js";
import { resolveDefaultAgentWorkspaceDir } from "../agents/workspace.js";
import { ensureManagerHierarchyStructure } from "../teams/team-bootstrap.js";
import { listManagerTeamLeads, listTeamLeadTeammates } from "../agents/agent-scope.js";

// ---------------------------------------------------------------------------
// openclaw teams list
// ---------------------------------------------------------------------------

export async function teamsListCommand(
  _opts: { json?: boolean; hierarchy?: boolean },
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const cfg = loadConfig();
  const teams = (cfg as Record<string, unknown>).teams as
    | { templates?: Record<string, TeamTemplate> }
    | undefined;
  const templates = teams?.templates;

  if (!templates || Object.keys(templates).length === 0) {
    runtime.log("No team templates configured.");
    runtime.log("Add templates in openclaw.json under teams.templates.");
    return;
  }

  runtime.log("Team templates:\n");
  for (const [id, template] of Object.entries(templates)) {
    const teammates = template.teammates.map((t) => t.role).join(", ");
    runtime.log(`  ${id}`);
    runtime.log(`    Name:       ${template.teamName}`);
    runtime.log(`    Team Lead:  ${template.teamLead.role}${template.teamLead.name ? ` (${template.teamLead.name})` : ""}`);
    runtime.log(`    Teammates:  ${teammates || "(none)"}`);
    if (template.defaults?.taskClaiming) {
      runtime.log(`    Claiming:   ${template.defaults.taskClaiming}`);
    }
    runtime.log("");
  }

  // Show hierarchy folders if requested
  if (_opts.hierarchy) {
    const workspaceDir = resolveDefaultAgentWorkspaceDir();
    const agents = cfg.agents?.list ?? [];
    const managers = agents.filter((a) => {
      const raw = a as Record<string, unknown>;
      return raw.tier === "manager" && (raw.agentTeams as { enabled?: boolean } | undefined)?.enabled;
    });

    if (managers.length > 0) {
      runtime.log("Hierarchy folders:\n");
      for (const mgr of managers) {
        const managerId = mgr.id;
        runtime.log(`  Manager: ${managerId}`);
        const leads = listManagerTeamLeads(workspaceDir, managerId);
        if (leads.length === 0) {
          runtime.log("    (no team lead folders scaffolded)");
        }
        for (const lead of leads) {
          runtime.log(`    Team Lead: ${lead}`);
          const mates = listTeamLeadTeammates(workspaceDir, managerId, lead);
          if (mates.length > 0) {
            runtime.log(`      Teammates: ${mates.join(", ")}`);
          } else {
            runtime.log("      (no teammate folders)");
          }
        }
        runtime.log("");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// openclaw teams create
// ---------------------------------------------------------------------------

export async function teamsCreateCommand(
  opts: { name?: string; json?: boolean },
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const prompter = createClackPrompter();

  try {
    await prompter.intro("Create Team Template");

    const templateId =
      opts.name?.trim() ||
      (await prompter.text({
        message: "Template ID (e.g. core-planning-team)",
        validate: (v) => (v?.trim() ? undefined : "Required"),
      }));
    const id = String(templateId).trim().toLowerCase().replace(/\s+/g, "-");

    const teamName = await prompter.text({
      message: "Team display name",
      initialValue: id
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      validate: (v) => (v?.trim() ? undefined : "Required"),
    });

    const leadRole = await prompter.text({
      message: "Team lead role",
      initialValue: "team-lead",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    });

    const leadModel = await prompter.text({
      message: "Team lead model (provider/model, or leave empty for default)",
      initialValue: "",
    });

    // Collect teammates
    const teammates: TeamTemplate["teammates"] = [];
    let addMore = true;
    while (addMore) {
      const role = await prompter.text({
        message: `Teammate ${teammates.length + 1} role (e.g. architect, researcher)`,
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });

      const model = await prompter.text({
        message: `Teammate model (or leave empty)`,
        initialValue: "",
      });

      teammates.push({
        role: String(role).trim(),
        ...(String(model).trim() ? { model: String(model).trim() } : {}),
      });

      addMore = await prompter.confirm({
        message: "Add another teammate?",
        initialValue: false,
      });
    }

    const taskClaiming = (await prompter.select({
      message: "Task claiming mode",
      options: [
        { value: "self-claim", label: "Self-claim (teammates pick tasks)" },
        { value: "assigned", label: "Assigned (team lead assigns tasks)" },
      ],
    })) as "self-claim" | "assigned";

    const template: TeamTemplate = {
      teamName: String(teamName).trim(),
      teamLead: {
        role: String(leadRole).trim(),
        ...(String(leadModel).trim() ? { model: String(leadModel).trim() } : {}),
      },
      teammates,
      defaults: { taskClaiming },
    };

    // Save to config
    const cfg = loadConfig();
    const existingTeams = (cfg as Record<string, unknown>).teams as
      | { templates?: Record<string, TeamTemplate> }
      | undefined;

    const nextConfig = {
      ...cfg,
      teams: {
        ...existingTeams,
        templates: {
          ...existingTeams?.templates,
          [id]: template,
        },
      },
    };

    await writeConfigFile(nextConfig);
    logConfigUpdated(runtime);

    if (opts.json) {
      runtime.log(JSON.stringify({ templateId: id, template }, null, 2));
    } else {
      runtime.log(`\nTeam template "${id}" created.`);
      runtime.log(`  Team Lead: ${template.teamLead.role}`);
      runtime.log(`  Teammates: ${template.teammates.map((t) => t.role).join(", ")}`);
      runtime.log(`  Claiming:  ${taskClaiming}`);
    }

    await prompter.outro(`Template "${id}" saved to config.`);
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      runtime.exit(0);
      return;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// openclaw teams spawn
// ---------------------------------------------------------------------------

export async function teamsSpawnCommand(
  opts: { template?: string; project?: string; json?: boolean },
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const cfg = loadConfig();
  const teams = (cfg as Record<string, unknown>).teams as
    | { templates?: Record<string, TeamTemplate> }
    | undefined;
  const templates = teams?.templates;

  if (!templates || Object.keys(templates).length === 0) {
    runtime.error("No team templates configured. Run `openclaw teams create` first.");
    runtime.exit(1);
    return;
  }

  const prompter = createClackPrompter();

  try {
    await prompter.intro("Spawn Team for Project");

    const templateId =
      opts.template?.trim() ||
      ((await prompter.select({
        message: "Select team template",
        options: Object.entries(templates).map(([id, t]) => ({
          value: id,
          label: `${id} (${t.teamName})`,
        })),
      })) as string);

    const template = templates[templateId];
    if (!template) {
      runtime.error(`Template "${templateId}" not found.`);
      runtime.exit(1);
      return;
    }

    const projectId =
      opts.project?.trim() ||
      (await prompter.text({
        message: "Project ID (e.g. website-v2)",
        validate: (v) => (v?.trim() ? undefined : "Required"),
      }));
    const pid = String(projectId).trim().toLowerCase().replace(/\s+/g, "-");

    // Create project workspace if it doesn't exist
    const projectDir = resolveProjectDir(pid);
    try {
      await fs.stat(projectDir);
      await prompter.note(`Project "${pid}" already exists.`, "Project");
    } catch {
      await createProjectWorkspace(pid);
      runtime.log(`Project workspace created: ${shortenHomePath(projectDir)}`);
    }

    // Create team runtime
    const teamDir = await createTeamRuntime(pid, templateId, template);
    runtime.log(`Team "${templateId}" spawned for project "${pid}".`);
    runtime.log(`Team directory: ${shortenHomePath(teamDir)}`);

    // Scaffold hierarchy for managers that have this template assigned
    const workspaceDir = resolveDefaultAgentWorkspaceDir();
    const agents = cfg.agents?.list ?? [];
    const managersWithTemplate = agents.filter((a) => {
      const raw = a as Record<string, unknown>;
      const agentTeams = raw.agentTeams as { enabled?: boolean; templates?: string[] } | undefined;
      return raw.tier === "manager" && agentTeams?.enabled && agentTeams.templates?.includes(templateId);
    });

    for (const mgr of managersWithTemplate) {
      try {
        await ensureManagerHierarchyStructure(workspaceDir, mgr.id, { [templateId]: template });
        runtime.log(`Hierarchy scaffolded for manager "${mgr.id}".`);
      } catch {
        // Non-fatal
      }
    }

    // Show workspace structure info
    runtime.log("");
    if (managersWithTemplate.length > 0) {
      runtime.log("Nested hierarchy workspaces:");
      for (const mgr of managersWithTemplate) {
        const mgrPath = path.join(workspaceDir, "agents", mgr.id);
        runtime.log(`  Manager ${mgr.id}: ${shortenHomePath(mgrPath)}`);
        runtime.log(`    Team Lead: ${shortenHomePath(path.join(mgrPath, "teamleads", template.teamLead.role))}`);
        for (const tm of template.teammates) {
          runtime.log(`    Teammate:  ${shortenHomePath(path.join(mgrPath, "teamleads", template.teamLead.role, "teammates", tm.role))}`);
        }
      }
    } else {
      runtime.log("No manager agents have this template assigned.");
      runtime.log("Assign the template to a manager via `openclaw agents add` to scaffold the hierarchy.");
    }
    runtime.log("");
    runtime.log("Edit bootstrap files in these directories to customize agent behavior per tier.");

    if (opts.json) {
      runtime.log(
        JSON.stringify(
          { projectId: pid, templateId, teamDir, template },
          null,
          2,
        ),
      );
    }

    await prompter.outro(`Team ready. Use team tools to manage tasks and messaging.`);
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      runtime.exit(0);
      return;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// openclaw teams scaffold
// ---------------------------------------------------------------------------

export async function teamsScaffoldCommand(
  opts: { manager?: string; json?: boolean },
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const cfg = loadConfig();
  const teams = (cfg as Record<string, unknown>).teams as
    | { templates?: Record<string, TeamTemplate> }
    | undefined;
  const templates = teams?.templates;

  if (!templates || Object.keys(templates).length === 0) {
    runtime.error("No team templates configured. Run `openclaw teams create` first.");
    runtime.exit(1);
    return;
  }

  const agents = cfg.agents?.list ?? [];
  const managers = agents.filter((a) => {
    const raw = a as Record<string, unknown>;
    return raw.tier === "manager" && (raw.agentTeams as { enabled?: boolean } | undefined)?.enabled;
  });

  if (managers.length === 0) {
    runtime.error("No manager agents with teams enabled found. Run `openclaw agents add` to create one.");
    runtime.exit(1);
    return;
  }

  const targetManagers = opts.manager
    ? managers.filter((m) => m.id === opts.manager)
    : managers;

  if (opts.manager && targetManagers.length === 0) {
    runtime.error(`Manager "${opts.manager}" not found or doesn't have teams enabled.`);
    runtime.exit(1);
    return;
  }

  const workspaceDir = resolveDefaultAgentWorkspaceDir();

  for (const mgr of targetManagers) {
    const raw = mgr as Record<string, unknown>;
    const agentTeams = raw.agentTeams as { templates?: string[] } | undefined;
    const templateIds = agentTeams?.templates ?? [];

    // Collect templates assigned to this manager
    const assignedTemplates: Record<string, TeamTemplate> = {};
    for (const tId of templateIds) {
      if (templates[tId]) {
        assignedTemplates[tId] = templates[tId];
      }
    }

    if (Object.keys(assignedTemplates).length === 0) {
      runtime.log(`Manager "${mgr.id}" has no valid templates assigned. Skipping.`);
      continue;
    }

    try {
      const createdPaths = await ensureManagerHierarchyStructure(workspaceDir, mgr.id, assignedTemplates);
      runtime.log(`Scaffolded hierarchy for manager "${mgr.id}":`);
      for (const p of createdPaths) {
        runtime.log(`  ${shortenHomePath(p)}`);
      }
      runtime.log("");
    } catch (err) {
      runtime.error(`Failed to scaffold for "${mgr.id}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// openclaw teams status
// ---------------------------------------------------------------------------

export async function teamsStatusCommand(
  opts: { project?: string; json?: boolean },
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  if (!opts.project) {
    // List all projects
    const projects = await listProjects();
    if (projects.length === 0) {
      runtime.log("No projects found.");
      return;
    }

    runtime.log("Projects:\n");
    for (const project of projects) {
      runtime.log(`  ${project.projectId}`);
      runtime.log(`    Status: ${project.status}`);
      runtime.log(`    Teams:  ${project.teams.length > 0 ? project.teams.join(", ") : "(none)"}`);
      runtime.log(`    Created: ${project.createdAt}`);
      runtime.log("");
    }
    return;
  }

  const result = await getProjectStatus(opts.project);
  if (!result) {
    runtime.error(`Project "${opts.project}" not found.`);
    runtime.exit(1);
    return;
  }

  if (opts.json) {
    runtime.log(JSON.stringify(result, null, 2));
    return;
  }

  runtime.log(`Project: ${result.project.projectId}`);
  runtime.log(`Status: ${result.project.status}`);
  runtime.log(`Created: ${result.project.createdAt}`);
  runtime.log("");

  if (result.teamStatuses.length === 0) {
    runtime.log("No teams spawned.");
    return;
  }

  for (const ts of result.teamStatuses) {
    runtime.log(`  Team: ${ts.team}`);
    if (ts.taskList) {
      const t = ts.taskList.tasks;
      const done = t.filter((task) => task.status === "completed").length;
      const total = t.length;
      runtime.log(`    Tasks: ${done}/${total} completed`);
      runtime.log(`    Status: ${ts.taskList.status}`);
    } else {
      runtime.log("    No task list");
    }
    runtime.log("");
  }
}
