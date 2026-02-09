import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeEnv } from "../runtime.js";
import type { ChannelChoice } from "./onboard-types.js";
import {
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../agents/agent-scope.js";
import { ensureAuthProfileStore } from "../agents/auth-profiles.js";
import { resolveAuthStorePath } from "../agents/auth-profiles/paths.js";
import { writeConfigFile } from "../config/config.js";
import { logConfigUpdated } from "../config/logging.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "../routing/session-key.js";
import { defaultRuntime } from "../runtime.js";
import { resolveUserPath, shortenHomePath } from "../utils.js";
import { createClackPrompter } from "../wizard/clack-prompter.js";
import { WizardCancelledError } from "../wizard/prompts.js";
import {
  applyAgentBindings,
  buildChannelBindings,
  describeBinding,
  parseBindingSpecs,
} from "./agents.bindings.js";
import { createQuietRuntime, requireValidConfig } from "./agents.command-shared.js";
import type { AgentTier, TeamTemplate } from "../config/types.teams.js";
import { ensureManagerHierarchyStructure } from "../teams/team-bootstrap.js";
import { applyAgentConfig, findAgentEntryIndex, listAgentEntries } from "./agents.config.js";
import { promptAuthChoiceGrouped } from "./auth-choice-prompt.js";
import { applyAuthChoice, warnIfModelConfigLooksOff } from "./auth-choice.js";
import { setupChannels } from "./onboard-channels.js";
import { ensureWorkspaceAndSessions } from "./onboard-helpers.js";

type AgentsAddOptions = {
  name?: string;
  workspace?: string;
  model?: string;
  agentDir?: string;
  bind?: string[];
  nonInteractive?: boolean;
  json?: boolean;
};

async function fileExists(pathname: string): Promise<boolean> {
  try {
    await fs.stat(pathname);
    return true;
  } catch {
    return false;
  }
}

export async function agentsAddCommand(
  opts: AgentsAddOptions,
  runtime: RuntimeEnv = defaultRuntime,
  params?: { hasFlags?: boolean },
) {
  const cfg = await requireValidConfig(runtime);
  if (!cfg) {
    return;
  }

  const workspaceFlag = opts.workspace?.trim();
  const nameInput = opts.name?.trim();
  const hasFlags = params?.hasFlags === true;
  const nonInteractive = Boolean(opts.nonInteractive || hasFlags);

  if (nonInteractive && !workspaceFlag) {
    runtime.error(
      "Non-interactive mode requires --workspace. Re-run without flags to use the wizard.",
    );
    runtime.exit(1);
    return;
  }

  if (nonInteractive) {
    if (!nameInput) {
      runtime.error("Agent name is required in non-interactive mode.");
      runtime.exit(1);
      return;
    }
    if (!workspaceFlag) {
      runtime.error(
        "Non-interactive mode requires --workspace. Re-run without flags to use the wizard.",
      );
      runtime.exit(1);
      return;
    }
    const agentId = normalizeAgentId(nameInput);
    if (agentId === DEFAULT_AGENT_ID) {
      runtime.error(`"${DEFAULT_AGENT_ID}" is reserved. Choose another name.`);
      runtime.exit(1);
      return;
    }
    if (agentId !== nameInput) {
      runtime.log(`Normalized agent id to "${agentId}".`);
    }
    if (findAgentEntryIndex(listAgentEntries(cfg), agentId) >= 0) {
      runtime.error(`Agent "${agentId}" already exists.`);
      runtime.exit(1);
      return;
    }

    const workspaceDir = resolveUserPath(workspaceFlag);
    const agentDir = opts.agentDir?.trim()
      ? resolveUserPath(opts.agentDir.trim())
      : resolveAgentDir(cfg, agentId);
    const model = opts.model?.trim();
    const nextConfig = applyAgentConfig(cfg, {
      agentId,
      name: nameInput,
      workspace: workspaceDir,
      agentDir,
      ...(model ? { model } : {}),
    });

    const bindingParse = parseBindingSpecs({
      agentId,
      specs: opts.bind,
      config: nextConfig,
    });
    if (bindingParse.errors.length > 0) {
      runtime.error(bindingParse.errors.join("\n"));
      runtime.exit(1);
      return;
    }
    const bindingResult =
      bindingParse.bindings.length > 0
        ? applyAgentBindings(nextConfig, bindingParse.bindings)
        : { config: nextConfig, added: [], skipped: [], conflicts: [] };

    await writeConfigFile(bindingResult.config);
    if (!opts.json) {
      logConfigUpdated(runtime);
    }
    const quietRuntime = opts.json ? createQuietRuntime(runtime) : runtime;
    await ensureWorkspaceAndSessions(workspaceDir, quietRuntime, {
      skipBootstrap: Boolean(bindingResult.config.agents?.defaults?.skipBootstrap),
      agentId,
    });

    const payload = {
      agentId,
      name: nameInput,
      workspace: workspaceDir,
      agentDir,
      model,
      bindings: {
        added: bindingResult.added.map(describeBinding),
        skipped: bindingResult.skipped.map(describeBinding),
        conflicts: bindingResult.conflicts.map(
          (conflict) => `${describeBinding(conflict.binding)} (agent=${conflict.existingAgentId})`,
        ),
      },
    };
    if (opts.json) {
      runtime.log(JSON.stringify(payload, null, 2));
    } else {
      runtime.log(`Agent: ${agentId}`);
      runtime.log(`Workspace: ${shortenHomePath(workspaceDir)}`);
      runtime.log(`Agent dir: ${shortenHomePath(agentDir)}`);
      if (model) {
        runtime.log(`Model: ${model}`);
      }
      if (bindingResult.conflicts.length > 0) {
        runtime.error(
          [
            "Skipped bindings already claimed by another agent:",
            ...bindingResult.conflicts.map(
              (conflict) =>
                `- ${describeBinding(conflict.binding)} (agent=${conflict.existingAgentId})`,
            ),
          ].join("\n"),
        );
      }
    }
    return;
  }

  const prompter = createClackPrompter();
  try {
    await prompter.intro("Add OpenClaw agent");
    const name =
      nameInput ??
      (await prompter.text({
        message: "Agent name",
        validate: (value) => {
          if (!value?.trim()) {
            return "Required";
          }
          const normalized = normalizeAgentId(value);
          if (normalized === DEFAULT_AGENT_ID) {
            return `"${DEFAULT_AGENT_ID}" is reserved. Choose another name.`;
          }
          return undefined;
        },
      }));

    const agentName = String(name).trim();
    const agentId = normalizeAgentId(agentName);
    if (agentName !== agentId) {
      await prompter.note(`Normalized id to "${agentId}".`, "Agent id");
    }

    const existingAgent = listAgentEntries(cfg).find(
      (agent) => normalizeAgentId(agent.id) === agentId,
    );
    if (existingAgent) {
      const shouldUpdate = await prompter.confirm({
        message: `Agent "${agentId}" already exists. Update it?`,
        initialValue: false,
      });
      if (!shouldUpdate) {
        await prompter.outro("No changes made.");
        return;
      }
    }

    const workspaceDefault = resolveAgentWorkspaceDir(cfg, agentId);
    const workspaceInput = await prompter.text({
      message: "Workspace directory",
      initialValue: workspaceDefault,
      validate: (value) => (value?.trim() ? undefined : "Required"),
    });
    const workspaceDir = resolveUserPath(String(workspaceInput).trim() || workspaceDefault);
    const agentDir = resolveAgentDir(cfg, agentId);

    let nextConfig = applyAgentConfig(cfg, {
      agentId,
      name: agentName,
      workspace: workspaceDir,
      agentDir,
    });

    const defaultAgentId = resolveDefaultAgentId(cfg);
    if (defaultAgentId !== agentId) {
      const sourceAuthPath = resolveAuthStorePath(resolveAgentDir(cfg, defaultAgentId));
      const destAuthPath = resolveAuthStorePath(agentDir);
      const sameAuthPath =
        path.resolve(sourceAuthPath).toLowerCase() === path.resolve(destAuthPath).toLowerCase();
      if (
        !sameAuthPath &&
        (await fileExists(sourceAuthPath)) &&
        !(await fileExists(destAuthPath))
      ) {
        const shouldCopy = await prompter.confirm({
          message: `Copy auth profiles from "${defaultAgentId}"?`,
          initialValue: false,
        });
        if (shouldCopy) {
          await fs.mkdir(path.dirname(destAuthPath), { recursive: true });
          await fs.copyFile(sourceAuthPath, destAuthPath);
          await prompter.note(`Copied auth profiles from "${defaultAgentId}".`, "Auth profiles");
        }
      }
    }

    const wantsAuth = await prompter.confirm({
      message: "Configure model/auth for this agent now?",
      initialValue: false,
    });
    if (wantsAuth) {
      const authStore = ensureAuthProfileStore(agentDir, {
        allowKeychainPrompt: false,
      });
      const authChoice = await promptAuthChoiceGrouped({
        prompter,
        store: authStore,
        includeSkip: true,
      });

      const authResult = await applyAuthChoice({
        authChoice,
        config: nextConfig,
        prompter,
        runtime,
        agentDir,
        setDefaultModel: false,
        agentId,
      });
      nextConfig = authResult.config;
      if (authResult.agentModelOverride) {
        nextConfig = applyAgentConfig(nextConfig, {
          agentId,
          model: authResult.agentModelOverride,
        });
      }
    }

    await warnIfModelConfigLooksOff(nextConfig, prompter, {
      agentId,
      agentDir,
    });

    // --- Team hierarchy prompts ---
    const wantsTier = await prompter.confirm({
      message: "Configure team hierarchy role for this agent?",
      initialValue: false,
    });

    if (wantsTier) {
      const tierChoice = (await prompter.select({
        message: "Agent tier (role in the company hierarchy)",
        options: [
          { value: "general-manager", label: "General Manager — top-level authority" },
          { value: "manager", label: "Franchise Manager — manages agent teams" },
          { value: "operations", label: "Operations — monitors teams (read-only)" },
          { value: "team-lead", label: "Team Lead — coordinates a team" },
          { value: "teammate", label: "Teammate — individual worker" },
        ],
      })) as AgentTier;

      // Apply tier to config
      const agentsList = nextConfig.agents?.list ?? [];
      const agentIdx = agentsList.findIndex(
        (a) => normalizeAgentId(a.id) === agentId,
      );
      if (agentIdx >= 0) {
        const entry = agentsList[agentIdx];
        const updated = { ...entry, tier: tierChoice } as typeof entry;
        const nextList = [...agentsList];
        nextList[agentIdx] = updated;
        nextConfig = { ...nextConfig, agents: { ...nextConfig.agents, list: nextList } };
      }

      // Reports-to prompt
      const otherAgents = listAgentEntries(nextConfig).filter(
        (a) => normalizeAgentId(a.id) !== agentId,
      );
      if (otherAgents.length > 0) {
        const wantsReportsTo = await prompter.confirm({
          message: "Does this agent report to another agent?",
          initialValue: tierChoice !== "general-manager",
        });
        if (wantsReportsTo) {
          const parentChoice = (await prompter.select({
            message: "Reports to which agent?",
            options: otherAgents.map((a) => ({
              value: normalizeAgentId(a.id),
              label: `${a.id}${a.name ? ` (${a.name})` : ""}`,
            })),
          })) as string;

          const agentsList2 = nextConfig.agents?.list ?? [];
          const agentIdx2 = agentsList2.findIndex(
            (a) => normalizeAgentId(a.id) === agentId,
          );
          if (agentIdx2 >= 0) {
            const entry = agentsList2[agentIdx2];
            const updated = { ...entry, reportsTo: parentChoice } as typeof entry;
            const nextList = [...agentsList2];
            nextList[agentIdx2] = updated;
            nextConfig = { ...nextConfig, agents: { ...nextConfig.agents, list: nextList } };
          }
        }
      }

      // Agent teams prompt (for managers)
      if (tierChoice === "manager") {
        const templates = (nextConfig as Record<string, unknown>).teams as
          | { templates?: Record<string, TeamTemplate> }
          | undefined;
        const templateKeys = templates?.templates
          ? Object.keys(templates.templates)
          : [];

        if (templateKeys.length > 0) {
          const wantsTeams = await prompter.confirm({
            message: "Enable agent teams for this manager?",
            initialValue: true,
          });
          if (wantsTeams) {
            await prompter.note(
              `Available templates: ${templateKeys.join(", ")}`,
              "Team templates",
            );
            const agentsList3 = nextConfig.agents?.list ?? [];
            const agentIdx3 = agentsList3.findIndex(
              (a) => normalizeAgentId(a.id) === agentId,
            );
            if (agentIdx3 >= 0) {
              const entry = agentsList3[agentIdx3];
              const updated = {
                ...entry,
                agentTeams: { enabled: true, templates: templateKeys },
              } as typeof entry;
              const nextList = [...agentsList3];
              nextList[agentIdx3] = updated;
              nextConfig = {
                ...nextConfig,
                agents: { ...nextConfig.agents, list: nextList },
              };
            }
          }
        } else {
          await prompter.note(
            "No team templates configured yet.\nRun `openclaw teams create` to add templates.",
            "Teams",
          );
        }
      }
    }
    // --- Scaffold nested hierarchy if manager with templates ---
    if (tierChoice === "manager") {
      const teamsSection = (nextConfig as Record<string, unknown>).teams as
        | { templates?: Record<string, TeamTemplate> }
        | undefined;
      const agentEntry = (nextConfig.agents?.list ?? []).find(
        (a) => normalizeAgentId(a.id) === agentId,
      );
      const agentTeamsConfig = agentEntry
        ? (agentEntry as Record<string, unknown>).agentTeams as
            | { enabled?: boolean; templates?: string[] }
            | undefined
        : undefined;

      if (
        agentTeamsConfig?.enabled &&
        agentTeamsConfig.templates &&
        agentTeamsConfig.templates.length > 0 &&
        teamsSection?.templates
      ) {
        // Collect only templates assigned to this manager
        const assignedTemplates: Record<string, TeamTemplate> = {};
        for (const tId of agentTeamsConfig.templates) {
          if (teamsSection.templates[tId]) {
            assignedTemplates[tId] = teamsSection.templates[tId];
          }
        }

        if (Object.keys(assignedTemplates).length > 0) {
          try {
            const createdPaths = await ensureManagerHierarchyStructure(
              workspaceDir,
              agentId,
              assignedTemplates,
            );
            const hierarchyLines = [
              "Nested hierarchy scaffolded:",
              ...createdPaths.map((p) => `  ${shortenHomePath(p)}`),
            ];
            await prompter.note(hierarchyLines.join("\n"), "Hierarchy");
          } catch (err) {
            await prompter.note(
              `Warning: could not scaffold hierarchy: ${err instanceof Error ? err.message : String(err)}`,
              "Hierarchy",
            );
          }
        }
      }
    }
    // --- End team hierarchy prompts ---

    let selection: ChannelChoice[] = [];
    const channelAccountIds: Partial<Record<ChannelChoice, string>> = {};
    nextConfig = await setupChannels(nextConfig, runtime, prompter, {
      allowSignalInstall: true,
      onSelection: (value) => {
        selection = value;
      },
      promptAccountIds: true,
      onAccountId: (channel, accountId) => {
        channelAccountIds[channel] = accountId;
      },
    });

    if (selection.length > 0) {
      const wantsBindings = await prompter.confirm({
        message: "Route selected channels to this agent now? (bindings)",
        initialValue: false,
      });
      if (wantsBindings) {
        const desiredBindings = buildChannelBindings({
          agentId,
          selection,
          config: nextConfig,
          accountIds: channelAccountIds,
        });
        const result = applyAgentBindings(nextConfig, desiredBindings);
        nextConfig = result.config;
        if (result.conflicts.length > 0) {
          await prompter.note(
            [
              "Skipped bindings already claimed by another agent:",
              ...result.conflicts.map(
                (conflict) =>
                  `- ${describeBinding(conflict.binding)} (agent=${conflict.existingAgentId})`,
              ),
            ].join("\n"),
            "Routing bindings",
          );
        }
      } else {
        await prompter.note(
          [
            "Routing unchanged. Add bindings when you're ready.",
            "Docs: https://docs.openclaw.ai/concepts/multi-agent",
          ].join("\n"),
          "Routing",
        );
      }
    }

    await writeConfigFile(nextConfig);
    logConfigUpdated(runtime);
    await ensureWorkspaceAndSessions(workspaceDir, runtime, {
      skipBootstrap: Boolean(nextConfig.agents?.defaults?.skipBootstrap),
      agentId,
    });

    const payload = {
      agentId,
      name: agentName,
      workspace: workspaceDir,
      agentDir,
    };
    if (opts.json) {
      runtime.log(JSON.stringify(payload, null, 2));
    }
    await prompter.outro(`Agent "${agentId}" ready.`);
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      runtime.exit(0);
      return;
    }
    throw err;
  }
}
