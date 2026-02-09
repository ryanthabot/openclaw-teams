---
summary: "Step-by-step guide to setting up and using agent teams"
read_when:
  - You want to set up agent teams
  - You need help creating managers, team leads, or teammates
  - You want to know the CLI commands for teams
title: "Agent Teams Setup Guide"
---

# Agent Teams Setup Guide

Agent Teams organize your agents into a hierarchy: **General Manager** > **Manager** > **Team Lead** > **Teammate**. This guide walks through the complete setup.

## How It Works

You create agents and team templates via CLI. At runtime, Managers spawn Team Leads and Teammates automatically using the agent tools. You do **not** create Team Leads or Teammates manually via CLI.

```
You (Owner)
 └─ General Manager (your main agent)
     └─ Franchise Manager (you create this via CLI)
         └─ Team Lead (spawned at runtime by Manager)
             ├─ Teammate: researcher (spawned at runtime)
             ├─ Teammate: architect (spawned at runtime)
             └─ Teammate: reviewer (spawned at runtime)
```

## Step 1: Create Your General Manager

Your default agent (`main`) is typically the General Manager. Add the tier:

```bash
openclaw agents add
```

During the wizard:
1. Enter agent name (or use your existing `main` agent)
2. When asked **"Configure team hierarchy role?"** select **Yes**
3. Select **General Manager** as the tier
4. Skip "reports to" (GM is top-level)

## Step 2: Create a Franchise Manager

```bash
openclaw agents add
```

During the wizard:
1. Name it (e.g. `planning-mgr`)
2. Set workspace directory
3. Select **"Configure team hierarchy role?"** > **Yes**
4. Select **Franchise Manager** as the tier
5. Select **"Reports to"** > your General Manager agent
6. If team templates exist, enable agent teams when prompted

## Step 3: Create a Team Template

```bash
openclaw teams create
```

The wizard prompts for:
- **Template ID** (e.g. `core-planning-team`)
- **Team display name**
- **Team lead role** (e.g. `team-lead`)
- **Team lead model** (e.g. `anthropic/claude-sonnet-4-5-20250929`, or blank for default)
- **Teammate roles** (e.g. `researcher`, `architect`, `reviewer` - add as many as needed)
- **Task claiming mode**: `self-claim` (teammates pick tasks) or `assigned` (lead assigns)

## Step 4: Spawn a Team for a Project

```bash
openclaw teams spawn
```

Or non-interactively:

```bash
openclaw teams spawn --template core-planning-team --project my-website
```

This creates the project workspace at `~/.openclaw/projects/my-website/` with shared memory, task lists, and mailbox directories. It also scaffolds the nested hierarchy folders for any managers that have this template assigned.

## Step 4b: Scaffold Hierarchy (Optional)

If you add new templates or want to re-scaffold the folder structure:

```bash
# Scaffold all managers
openclaw teams scaffold

# Scaffold a specific manager
openclaw teams scaffold --manager planning-mgr
```

This creates the nested folder structure:
```
workspace/agents/planning-mgr/
├── MANAGER.md, AGENTS.md, SOUL.md, ...
└── teamleads/
    └── team-lead/
        ├── TEAM-LEAD.md, AGENTS.md, SOUL.md, ...
        └── teammates/
            ├── researcher/
            │   └── TEAMMATE.md, AGENTS.md, SOUL.md, ...
            ├── architect/
            └── reviewer/
```

Each agent gets its own copy of all bootstrap files that you can customize independently.

## Step 5: Check Status

```bash
# List all projects
openclaw teams status

# Detailed status for a project
openclaw teams status --project my-website

# List all templates
openclaw teams list
```

## What Happens at Runtime

Once a team is spawned, the **Manager** agent uses built-in tools to orchestrate:

1. Manager sends tasks to the Team Lead via `team_message_send`
2. Team Lead creates tasks with `team_task_create` (including dependencies)
3. Teammates claim tasks with `team_task_claim` (in self-claim mode)
4. Teammates complete work and call `team_task_complete`
5. Dependencies auto-resolve, unlocking the next tasks
6. Team communicates via mailbox (`team_message_send` / `team_message_read`)

Team Leads and Teammates are spawned automatically by the Manager using `sessions_spawn` with the appropriate bootstrap files (MANAGER.md, TEAM-LEAD.md, TEAMMATE.md).

**Hierarchy threading:** When spawning, agents pass `teamManagerId` and `teamLeadRole` params so bootstrap files resolve from the correct nested hierarchy folder. The system enforces containment — agents can only spawn sub-agents that have a folder in their hierarchy directory.

## Tuning Model Parameters

You can control model behavior globally through `openclaw.json`:

```json5
{
  agents: {
    defaults: {
      // Per-model parameter overrides
      models: {
        "anthropic/claude-opus-4-6": {
          params: {
            temperature: 0.7,    // Creativity (0.0-1.0)
            topP: 0.9,           // Nucleus sampling (0.0-1.0)
            maxTokens: 8192      // Max output tokens
          }
        },
        "zai/glm-4.7": {
          params: { temperature: 0.5 }
        }
      },

      // Thinking depth: off | minimal | low | medium | high | xhigh
      thinkingDefault: "medium",

      // Reasoning visibility: off | on | stream
      reasoningDefault: "on",
    }
  }
}
```

Team member templates can also override the model per role:

```json5
{
  teams: {
    templates: {
      "my-team": {
        teamLead: { role: "lead", model: "anthropic/claude-opus-4-6" },
        teammates: [
          { role: "researcher", model: "anthropic/claude-sonnet-4-5-20250929" },
          { role: "coder", model: "zai/glm-4.7" }
        ]
      }
    }
  }
}
```

## Example Config

A minimal working `openclaw.json`:

```json5
{
  agents: {
    list: [
      { id: "main", tier: "general-manager" },
      {
        id: "planning-mgr",
        tier: "manager",
        reportsTo: "main",
        agentTeams: { enabled: true, templates: ["core-team"] }
      }
    ],
    defaults: {
      thinkingDefault: "medium",
      reasoningDefault: "on",
      models: {
        "anthropic/claude-opus-4-6": {
          params: { temperature: 0.7 }
        }
      }
    }
  },
  teams: {
    templates: {
      "core-team": {
        teamName: "Core Team",
        teamLead: { role: "team-lead" },
        teammates: [
          { role: "researcher" },
          { role: "architect" },
          { role: "reviewer" }
        ],
        defaults: { taskClaiming: "self-claim" }
      }
    }
  }
}
```

## Common Issues

| Problem | Solution |
|---------|----------|
| "No team templates configured" | Run `openclaw teams create` first |
| "Template not found" | Check `openclaw teams list` to verify template ID |
| "Hierarchy violation" | Check tier compatibility (GM > Manager > Team Lead > Teammate) |
| "not found in hierarchy" | Run `openclaw teams scaffold` to create missing folders |
| Tasks stuck as pending | Check `dependsOn` - all deps must be `completed` |
| Config validation errors | Run `openclaw doctor` for detailed diagnostics |

## Further Reading

- [Agent Teams reference](/concepts/agent-teams) - full architecture, tools, memory model
- [Multi-agent routing](/concepts/multi-agent) - general multi-agent concepts
