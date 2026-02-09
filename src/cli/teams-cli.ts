import type { Command } from "commander";
import {
  teamsCreateCommand,
  teamsListCommand,
  teamsScaffoldCommand,
  teamsSpawnCommand,
  teamsStatusCommand,
} from "../commands/teams.commands.js";
import { defaultRuntime } from "../runtime.js";
import { runCommandWithRuntime } from "./cli-utils.js";

function runTeamsCommand(action: () => Promise<void>) {
  return runCommandWithRuntime(defaultRuntime, action);
}

export function registerTeamsCli(program: Command) {
  const teams = program
    .command("teams")
    .description("Manage agent team templates and projects");

  teams
    .command("list")
    .description("List configured team templates")
    .option("--json", "Output JSON", false)
    .option("--hierarchy", "Show hierarchy folder structure", false)
    .action(async (opts) => {
      await runTeamsCommand(async () => {
        await teamsListCommand(opts, defaultRuntime);
      });
    });

  teams
    .command("create")
    .description("Create a new team template (interactive wizard)")
    .option("--name <name>", "Template ID")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runTeamsCommand(async () => {
        await teamsCreateCommand(opts, defaultRuntime);
      });
    });

  teams
    .command("spawn")
    .description("Spawn a team for a project from a template")
    .option("--template <id>", "Team template ID")
    .option("--project <id>", "Project ID")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runTeamsCommand(async () => {
        await teamsSpawnCommand(opts, defaultRuntime);
      });
    });

  teams
    .command("scaffold")
    .description("Scaffold or re-scaffold nested hierarchy folders for a manager")
    .option("--manager <id>", "Manager agent ID (omit to scaffold all managers)")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runTeamsCommand(async () => {
        await teamsScaffoldCommand(opts, defaultRuntime);
      });
    });

  teams
    .command("status")
    .description("Show project and team status")
    .option("--project <id>", "Project ID (omit to list all projects)")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runTeamsCommand(async () => {
        await teamsStatusCommand(opts, defaultRuntime);
      });
    });
}
