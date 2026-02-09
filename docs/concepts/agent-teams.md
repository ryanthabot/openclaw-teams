---
summary: "Hierarchical agent teams: setup, configuration, and management"
title: Agent Teams
read_when: "You want to set up a hierarchical multi-agent team system with managers, team leads, and teammates."
status: active
---

# Agent Teams

Agent Teams let you organize your agents into a company-like hierarchy where
managers oversee team leads who coordinate teammates. Teams collaborate through
shared task lists, peer messaging, and three-tier memory.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  YOU (Owner)                                            │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  TIER 0: GENERAL MANAGER                          │  │
│  │  Your main agent — global authority               │  │
│  │                                                   │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │  TIER 1: OPERATIONS (optional)              │  │  │
│  │  │  Monitors all teams, read-only oversight    │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  │                                                   │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │  TIER 2: FRANCHISE MANAGER                  │  │  │
│  │  │  Owns a department, manages agent teams     │  │  │
│  │  │                                             │  │  │
│  │  │  ┌───────────────────────────────────────┐  │  │  │
│  │  │  │  TIER 3: TEAM LEAD                    │  │  │  │
│  │  │  │  Manages task list, spawns teammates  │  │  │  │
│  │  │  │                                       │  │  │  │
│  │  │  │  ├── TIER 4: TEAMMATE                 │  │  │  │
│  │  │  │  ├── TIER 4: TEAMMATE                 │  │  │  │
│  │  │  │  └── TIER 4: TEAMMATE                 │  │  │  │
│  │  │  └───────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### The 5 Tiers

| Tier | Role | Can Spawn | Reports To |
|------|------|-----------|------------|
| 0 | **General Manager** | Operations, Managers | Owner (you) |
| 1 | **Operations** | Nobody (read-only) | General Manager |
| 2 | **Franchise Manager** | Team Leads | General Manager |
| 3 | **Team Lead** | Teammates | Franchise Manager |
| 4 | **Teammate** | Nobody | Team Lead |

Each tier enforces spawning rules. A manager cannot spawn another manager.
A teammate cannot spawn anyone. The hierarchy is enforced at the config
validation level and at runtime when using `sessions_spawn`.

---

## Quick Start

Get a working team in 4 steps:

### 1. Add your General Manager

Your first/default agent becomes the General Manager:

```bash
openclaw agents add general-manager
# When prompted:
#   Agent tier? → General Manager
```

Or if your main agent is already set up, you can add tier metadata manually
in `openclaw.json`:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        tier: "general-manager"
        // ... existing config
      }
    ]
  }
}
```

### 2. Add a Franchise Manager

```bash
openclaw agents add planning-mgr
# When prompted:
#   Agent tier? → Franchise Manager
#   Reports to? → main
#   Enable agent teams? → Yes
```

### 3. Create a Team Template

```bash
openclaw teams create
# When prompted:
#   Template ID: core-planning-team
#   Team name: Core Planning Team
#   Team lead role: team-lead
#   Team lead model: (leave empty for default)
#   Teammate 1 role: researcher
#   Teammate 2 role: architect
#   Teammate 3 role: reviewer
#   Task claiming mode: Self-claim
```

### 4. Spawn a Team for a Project

```bash
openclaw teams spawn
# When prompted:
#   Template: core-planning-team
#   Project ID: website-v2
```

This creates the project workspace at `~/.openclaw/projects/website-v2/` with:
- `PROJECT.md` — project metadata
- `STATUS.md` — status tracking
- `shared/brief.md` — project brief for all teams
- `shared/context.md` — cross-team shared knowledge
- `shared/decisions.md` — decision log
- `shared/artifacts/` — deliverables
- `teams/core-planning-team/` — team directory with task list and mailbox

---

## Configuration Reference

### Agent hierarchy fields

Added to each agent entry in `agents.list[]`:

```json5
{
  agents: {
    list: [
      {
        id: "planning-mgr",
        name: "Planning Manager",
        workspace: "~/.openclaw/workspace-planning-mgr",

        // Team hierarchy fields
        tier: "manager",           // general-manager | operations | manager | team-lead | teammate
        reportsTo: "main",         // agent ID of parent in hierarchy
        agentTeams: {
          enabled: true,           // this agent can manage teams
          templates: ["core-planning-team", "review-team"]  // allowed templates
        }
      }
    ]
  }
}
```

**Valid `tier` values:**

- `"general-manager"` — Top-level authority (Tier 0)
- `"operations"` — Read-only oversight (Tier 1)
- `"manager"` — Franchise manager, manages teams (Tier 2)
- `"team-lead"` — Leads a specific team (Tier 3)
- `"teammate"` — Individual contributor (Tier 4)

### Team templates

Defined under the top-level `teams` key:

```json5
{
  teams: {
    templates: {
      "core-planning-team": {
        teamName: "Core Planning Team",
        teamLead: {
          role: "team-lead",
          name: "Lead",            // optional display name
          model: "anthropic/claude-sonnet-4-5"  // optional model override
        },
        teammates: [
          { role: "researcher" },
          { role: "architect", model: "anthropic/claude-opus-4-6" },
          { role: "reviewer" },
          { role: "tester" }
        ],
        defaults: {
          taskClaiming: "self-claim"  // "self-claim" or "assigned"
        }
      },
      "review-team": {
        teamName: "Review Team",
        teamLead: { role: "review-lead" },
        teammates: [
          { role: "security-reviewer" },
          { role: "performance-reviewer" },
          { role: "devils-advocate" }
        ],
        defaults: {
          taskClaiming: "assigned"
        }
      }
    }
  }
}
```

**Template fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `teamName` | Yes | Display name for the team |
| `teamLead.role` | Yes | Role identifier for the team lead |
| `teamLead.name` | No | Display name |
| `teamLead.model` | No | Model override (e.g. `"anthropic/claude-opus-4-6"`) |
| `teammates` | Yes | Array of teammate definitions |
| `teammates[].role` | Yes | Role identifier (e.g. `"researcher"`, `"architect"`) |
| `teammates[].model` | No | Model override for this teammate |
| `defaults.taskClaiming` | No | `"self-claim"` (teammates pick tasks) or `"assigned"` (team lead assigns) |

---

## CLI Commands

### `openclaw teams list`

Show all configured team templates:

```bash
openclaw teams list
```

Output:
```
Team templates:

  core-planning-team
    Name:       Core Planning Team
    Team Lead:  team-lead
    Teammates:  researcher, architect, reviewer, tester
    Claiming:   self-claim

  review-team
    Name:       Review Team
    Team Lead:  review-lead
    Teammates:  security-reviewer, performance-reviewer, devils-advocate
    Claiming:   assigned
```

### `openclaw teams create`

Interactive wizard to create a new team template:

```bash
openclaw teams create
# or with a name:
openclaw teams create --name my-team
```

### `openclaw teams spawn`

Spawn a team for a project. Creates the project workspace (if needed) and
initializes the team's runtime directory:

```bash
openclaw teams spawn
# or non-interactively:
openclaw teams spawn --template core-planning-team --project website-v2
```

### `openclaw teams scaffold`

Scaffold or re-scaffold nested hierarchy folders for manager agents:

```bash
# Scaffold all managers
openclaw teams scaffold

# Scaffold a specific manager
openclaw teams scaffold --manager planning-mgr
```

This creates the nested folder structure based on templates assigned to each
manager. Existing files are preserved (only missing files are written).

### `openclaw teams status`

View project and team status:

```bash
# List all projects
openclaw teams status

# Detailed status for one project
openclaw teams status --project website-v2
```

Output:
```
Project: website-v2
Status: active
Created: 2026-02-07T10:30:00.000Z

  Team: core-planning-team
    Tasks: 3/8 completed
    Status: active

  Team: review-team
    Tasks: 0/4 completed
    Status: active
```

---

## Agent Tools

When agents are configured with team hierarchy, they get access to team tools.
These tools operate on the file-based team runtime (task lists, mailbox, shared memory).

### Task Tools

| Tool | Description |
|------|-------------|
| `team_task_create` | Create a task with title, description, and dependencies |
| `team_task_claim` | Claim an available task (all dependencies must be completed) |
| `team_task_complete` | Mark a claimed task as completed |
| `team_task_list` | List tasks, optionally filtered by status or claimable |
| `team_task_update` | Update task status, assignment, or description |

**Task states:**

```
pending → claimed → in_progress → completed
                               → failed
```

- **pending**: Not yet claimed by anyone
- **claimed**: Reserved by a teammate
- **in_progress**: Actively being worked on
- **completed**: Done
- **failed**: Could not be completed (with reason)

**Dependencies:** Tasks can depend on other tasks by ID. A task cannot be
claimed until all of its dependencies are in the `completed` state. When a
task is completed, any tasks that were waiting on it become claimable if
all their other dependencies are also complete.

### Mailbox Tools

| Tool | Description |
|------|-------------|
| `team_message_send` | Send a direct message to a teammate or broadcast to all |
| `team_message_read` | Read unread messages (marks them as read) |
| `team_message_list` | List recent messages without marking them read |

**Direct vs broadcast:** Set `to` to a teammate's role for direct messages,
or `"*"` to broadcast to the entire team.

### Project Tools

| Tool | Description |
|------|-------------|
| `team_project_create` | Create a new project workspace, optionally with teams |
| `team_project_status` | View project status and team task summaries |

---

## Task Management

### Creating Tasks with Dependencies

Team leads create tasks with dependency chains. Here's an example flow:

```
team_task_create:
  projectId: "website-v2"
  teamName: "core-planning-team"
  title: "Research authentication patterns"
  description: "Survey OAuth, JWT, and session-based auth approaches"

team_task_create:
  projectId: "website-v2"
  teamName: "core-planning-team"
  title: "Design auth architecture"
  description: "Choose auth approach based on research findings"
  dependsOn: [1]    ← depends on task #1

team_task_create:
  projectId: "website-v2"
  teamName: "core-planning-team"
  title: "Implement auth endpoints"
  dependsOn: [2]    ← depends on task #2
```

When task #1 is completed, task #2 becomes claimable. When #2 is completed,
#3 becomes claimable.

### Self-Claim vs Assigned

**Self-claim** (`taskClaiming: "self-claim"`): Teammates check the task list
for available work and claim tasks themselves. Good for autonomous teams.

**Assigned** (`taskClaiming: "assigned"`): The team lead assigns tasks to
specific teammates. Good for structured workflows.

### Checking Available Work

Teammates use `team_task_list` with `filter: "claimable"` to see tasks
where all dependencies are completed and no one has claimed them yet.

---

## Memory Architecture

The team system uses three tiers of memory, each with different access rules.

### Tier 1: Company Memory

- **Location:** Agent workspace `MEMORY.md` files
- **Write access:** General Manager, Operations
- **Read access:** All agents
- **Purpose:** Organization-wide context, strategic decisions

### Tier 2: Project Shared Memory

- **Location:** `~/.openclaw/projects/<id>/shared/`
- **Write access:** All team members working on the project
- **Read access:** All team members working on the project
- **Contents:**
  - `brief.md` — Project requirements and goals
  - `context.md` — Shared findings and technical context
  - `decisions.md` — Decision log with rationale
  - `artifacts/` — Deliverables and output files

### Tier 3: Team Memory

- **Location:** `~/.openclaw/projects/<id>/teams/<team>/`
- **Write access:** Team members of that specific team
- **Read access:** Team members + their manager
- **Contents:**
  - `task-list.json` — Task state
  - `team-context.md` — Team-specific notes
  - `mailbox/` — Peer messages

### Permission Matrix

| Tier | Memory Level | Read | Write |
|------|-------------|------|-------|
| General Manager | Company | Yes | Yes |
| General Manager | Project | Yes | Yes |
| General Manager | Any Team | Yes | Yes |
| Operations | Company | Yes | Yes |
| Operations | Project | Yes | Read-only |
| Manager | Company | Yes | No |
| Manager | Project | Yes | Yes |
| Manager | Own Teams | Yes | Yes |
| Team Lead | Company | No | No |
| Team Lead | Project | Yes | Yes |
| Team Lead | Own Team | Yes | Yes |
| Teammate | Company | No | No |
| Teammate | Project | Yes | Yes |
| Teammate | Own Team | Yes | Yes |

---

## Peer Messaging

Teammates communicate through file-based mailboxes within their team directory.

### Direct Messages

```
team_message_send:
  projectId: "website-v2"
  teamName: "core-planning-team"
  to: "architect"
  body: "Research is done. OAuth 2.0 with PKCE is the recommendation. See shared/artifacts/auth-research.md"
```

### Broadcasts

```
team_message_send:
  projectId: "website-v2"
  teamName: "core-planning-team"
  to: "*"
  body: "Starting phase 2. All research tasks are complete. Check task list for newly available work."
```

### Reading Messages

Teammates check their inbox at the start of each session:

```
team_message_read:
  projectId: "website-v2"
  teamName: "core-planning-team"
```

This returns unread direct messages and broadcasts, then marks them as read.

---

## Quality Gates

The **team-quality-gate** hook validates task completion. When a teammate
calls `team_task_complete`, the hook checks:

1. The task exists in the task list
2. The task was assigned to someone (not completed anonymously)
3. The task was in a completable state (`claimed` or `in_progress`)

If validation fails, the hook returns feedback explaining what needs to be
fixed, and the completion is blocked.

### Enabling the Quality Gate

The hook is bundled at `src/hooks/bundled/team-quality-gate/`. It listens
for `tool_result_persist` events on `team_task_complete` calls.

To enable it in your team template:

```json
{
  "hooks": {
    "TaskCompleted": "team-quality-gate"
  }
}
```

---

## Hierarchy Enforcement

The system enforces spawning rules based on tier:

| Requester | Can Spawn |
|-----------|-----------|
| General Manager | Operations, Manager |
| Manager | Team Lead |
| Team Lead | Teammate |
| Operations | Nobody |
| Teammate | Nobody |

If an agent tries to spawn an agent at a tier they're not allowed to create,
the `sessions_spawn` tool returns a `"forbidden"` status with a hierarchy
violation message.

### Validation

Config validation catches hierarchy issues at startup:

- `reportsTo` must reference an existing agent ID
- No agent can report to itself
- No circular reporting chains (A → B → C → A)
- Parent tier must logically allow the child tier
- `agentTeams.templates` must reference templates defined in `teams.templates`

---

## Directory Structure

After setting up a project with teams, your filesystem looks like this:

```
~/.openclaw/
├── openclaw.json              ← config with agents.list + teams.templates
├── workspace/
│   ├── AGENTS.md              ← General Manager bootstrap
│   ├── SOUL.md                ← General Manager persona
│   ├── TOOLS.md               ← Tool guidance
│   ├── IDENTITY.md            ← Agent identity
│   ├── USER.md                ← User profile
│   ├── HEARTBEAT.md           ← Heartbeat config
│   └── agents/                ← Team agent bootstrap directories
│       ├── planning-mgr/                  ← Manager's own bootstrap
│       │   ├── MANAGER.md
│       │   ├── AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md
│       │   ├── HEARTBEAT.md, BOOTSTRAP.md, MEMORY.md
│       │   └── teamleads/
│       │       ├── team-lead/             ← Team Lead's own bootstrap
│       │       │   ├── TEAM-LEAD.md
│       │       │   ├── AGENTS.md, SOUL.md, TOOLS.md, ...
│       │       │   └── teammates/
│       │       │       ├── researcher/    ← Teammate's own bootstrap
│       │       │       │   ├── TEAMMATE.md
│       │       │       │   └── AGENTS.md, SOUL.md, ...
│       │       │       ├── architect/
│       │       │       │   └── (same full set)
│       │       │       └── reviewer/
│       │       │           └── (same full set)
│       │       └── review-lead/
│       │           └── (same structure)
├── projects/
│   └── website-v2/
│       ├── PROJECT.md         ← project metadata
│       ├── STATUS.md          ← status tracking
│       ├── shared/
│       │   ├── brief.md       ← project brief
│       │   ├── context.md     ← cross-team shared knowledge
│       │   ├── decisions.md   ← decision log
│       │   └── artifacts/     ← deliverables
│       └── teams/
│           └── core-planning-team/
│               ├── config.json       ← team config (from template)
│               ├── task-list.json    ← task state
│               ├── team-context.md   ← team notes
│               ├── teammates/        ← per-teammate state
│               └── mailbox/
│                   ├── messages/     ← direct messages
│                   └── broadcasts/   ← team-wide messages
└── agents/
    ├── main/                  ← General Manager
    ├── planning-mgr/          ← Franchise Manager
    └── ...
```

### Nested Hierarchy

Each manager owns its team leads, and each team lead owns its teammates,
through a nested folder structure. This provides:
- **Containment**: Agents can only spawn sub-agents that exist in their folder
- **Customization**: Every individual agent has its own editable bootstrap files
- **Isolation**: Changes to one manager's team don't affect another

Bootstrap files resolve in this priority order:
1. Nested hierarchy folder (`workspace/agents/<managerId>/teamleads/<role>/...`)
2. Persona directory (if `persona` path is set in the template)
3. Main workspace directory (`workspace/`)
4. Reference templates (built-in defaults)

### Filesystem Containment

When spawning agents, the system verifies the requested role has a folder
in the parent's hierarchy directory. No folder = cannot spawn. This means:

- A manager can only spawn team leads listed in its `teamleads/` directory
- A team lead can only spawn teammates listed in its `teammates/` directory
- Adding a new teammate requires creating a folder in the team lead's `teammates/` dir

Use `openclaw teams scaffold` to automatically create hierarchy folders from templates.

---

## Bootstrap Files per Tier

Each tier gets its own bootstrap files injected into its system prompt when
spawned. This is how you make each tier behave differently — like having
separate instruction manuals for managers, team leads, and teammates.

### How Bootstrap Injection Works

When a team agent is spawned, the system loads bootstrap files in this priority:

1. **Nested hierarchy directory** (`/workspace/agents/<managerId>/teamleads/<role>/...`)
2. **Persona directory** (if `persona` path set in the template)
3. **Main workspace directory** (`/workspace/`)
4. **Reference templates** (built-in defaults)

The nested hierarchy allows per-agent customization while falling back to
the main workspace and reference templates for anything not overridden.

### Tier-Specific Bootstrap Files

| Tier | Primary File | Location |
|------|-------------|----------|
| General Manager | SOUL.md, AGENTS.md, etc. | `/workspace/` |
| Manager | MANAGER.md | `/workspace/agents/<managerId>/` |
| Team Lead | TEAM-LEAD.md | `/workspace/agents/<managerId>/teamleads/<leadRole>/` |
| Teammate | TEAMMATE.md | `/workspace/agents/<managerId>/teamleads/<leadRole>/teammates/<mateRole>/` |

### Customizing Tier Behavior

To customize how a specific agent behaves, edit the files in its hierarchy folder:

```bash
# Make the planning manager think like a startup CEO
edit ~/.openclaw/workspace/agents/planning-mgr/SOUL.md

# Give a specific team lead a structured methodology
edit ~/.openclaw/workspace/agents/planning-mgr/teamleads/team-lead/SOUL.md

# Make the researcher teammate focus on specific standards
edit ~/.openclaw/workspace/agents/planning-mgr/teamleads/team-lead/teammates/researcher/AGENTS.md
```

Each agent's directory contains the full set of bootstrap files:
- `SOUL.md` — Persona and tone
- `AGENTS.md` — Role definition and behavior rules
- `TOOLS.md` — Tool usage guidance
- `IDENTITY.md` — Identity context
- `HEARTBEAT.md` — Heartbeat configuration
- `BOOTSTRAP.md` — Bootstrap instructions
- `MEMORY.md` — Memory configuration
- Plus the tier-specific file (MANAGER.md, TEAM-LEAD.md, or TEAMMATE.md)

### Per-Member Persona Paths

For more granular control, use the `persona` field in team member templates
to point to a custom directory:

```json5
{
  teammates: [
    {
      role: "architect",
      persona: "personas/architect"  // relative to workspace
    },
    {
      role: "researcher",
      persona: "/absolute/path/to/researcher-persona"
    }
  ]
}
```

The persona directory can contain SOUL.md, AGENTS.md, and other bootstrap
files that override the tier defaults for that specific team member.

---

## Full Configuration Example

A complete `openclaw.json` with a General Manager, a Franchise Manager, and
two team templates:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        name: "General Manager",
        workspace: "~/.openclaw/workspace",
        tier: "general-manager"
      },
      {
        id: "planning-mgr",
        name: "Planning Manager",
        workspace: "~/.openclaw/workspace-planning-mgr",
        tier: "manager",
        reportsTo: "main",
        agentTeams: {
          enabled: true,
          templates: ["core-planning-team", "review-team"]
        }
      },
      {
        id: "ops-monitor",
        name: "Operations Monitor",
        workspace: "~/.openclaw/workspace-ops",
        tier: "operations",
        reportsTo: "main"
      }
    ]
  },

  teams: {
    templates: {
      "core-planning-team": {
        teamName: "Core Planning Team",
        teamLead: {
          role: "team-lead",
          model: "anthropic/claude-sonnet-4-5"
        },
        teammates: [
          { role: "researcher" },
          { role: "architect", model: "anthropic/claude-opus-4-6" },
          { role: "reviewer" },
          { role: "tester" }
        ],
        defaults: {
          taskClaiming: "self-claim"
        }
      },
      "review-team": {
        teamName: "Review Team",
        teamLead: { role: "review-lead" },
        teammates: [
          { role: "security-reviewer" },
          { role: "performance-reviewer" },
          { role: "devils-advocate" }
        ],
        defaults: {
          taskClaiming: "assigned"
        }
      }
    }
  },

  // Standard OpenClaw config continues...
  bindings: [
    { agentId: "main", match: { channel: "whatsapp" } }
  ]
}
```

---

## Scaling Up

### Adding More Teams to a Manager

1. Create additional templates with `openclaw teams create`
2. Add the template ID to the manager's `agentTeams.templates` array
3. Spawn the team for a project with `openclaw teams spawn`

### Adding a New Franchise

1. Add a new manager agent: `openclaw agents add marketing-mgr`
2. Set tier to `manager`, reportsTo the General Manager
3. Create templates for the marketing department
4. The General Manager can now assign marketing objectives to this franchise

### Multiple Projects

Each project is independent. A single team template can be spawned for
multiple projects:

```bash
openclaw teams spawn --template core-planning-team --project website-v2
openclaw teams spawn --template core-planning-team --project mobile-app
openclaw teams spawn --template review-team --project website-v2
```

Each spawn creates an independent team runtime with its own task list
and mailbox.

---

## Workflow Example

Here's a complete workflow from project creation to completion:

1. **Owner** tells the General Manager: "Build a new marketing website"
2. **General Manager** creates a project:
   ```
   team_project_create: { projectId: "marketing-site", brief: "Build new marketing website with blog, pricing, and contact pages" }
   ```
3. **General Manager** delegates to the Planning Manager
4. **Planning Manager** spawns teams:
   ```
   openclaw teams spawn --template core-planning-team --project marketing-site
   ```
5. **Team Lead** creates tasks in the task list:
   ```
   team_task_create: { title: "Research competitor sites", ... }
   team_task_create: { title: "Design information architecture", dependsOn: [1] }
   team_task_create: { title: "Create wireframes", dependsOn: [2] }
   team_task_create: { title: "Build page components", dependsOn: [3] }
   team_task_create: { title: "Write copy", dependsOn: [2] }
   team_task_create: { title: "Final review", dependsOn: [4, 5] }
   ```
6. **Teammates** claim and complete tasks as dependencies resolve
7. **Team Lead** monitors progress and coordinates through mailbox
8. **Planning Manager** reviews output and reports to GM
9. **General Manager** delivers results to the Owner

---

## Model Parameter Tuning

Control temperature, nucleus sampling, token limits, thinking depth, and reasoning
visibility for all agents (including team agents) through `openclaw.json`.

### Per-model parameters

Set `temperature`, `topP`, and `maxTokens` under `agents.defaults.models`:

```json5
{
  agents: {
    defaults: {
      models: {
        "anthropic/claude-opus-4-6": {
          params: { temperature: 0.7, topP: 0.9, maxTokens: 8192 }
        },
        "zai/glm-4.7": {
          params: { temperature: 0.5, maxTokens: 4096 }
        }
      }
    }
  }
}
```

### Thinking and reasoning defaults

```json5
{
  agents: {
    defaults: {
      // Thinking depth: off | minimal | low | medium | high | xhigh
      thinkingDefault: "medium",
      // Reasoning visibility: off | on | stream
      reasoningDefault: "on",
    }
  }
}
```

- **thinkingDefault** controls how deeply the model reasons internally before responding.
  Override per-message with `/think <level>`.
- **reasoningDefault** controls whether reasoning output is visible in responses.
  Override per-session with `/reasoning <level>`.

### Per-role model overrides

Team member templates can specify a model per role, which inherits the
global params for that model:

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

---

## Troubleshooting

### "Template not found" when spawning

Make sure the template is defined in `teams.templates` in your `openclaw.json`.
Run `openclaw teams list` to verify.

### "Hierarchy violation" when spawning agents

Check the tier of both the requesting agent and the target agent. Only
allowed spawn relationships are permitted (see Hierarchy Enforcement above).

### Tasks not becoming claimable

Tasks with `dependsOn` arrays require all listed task IDs to be in
`completed` status. Check `team_task_list` to see which dependencies are
still pending.

### Config validation errors at startup

Run `openclaw doctor` to see detailed validation output. Common issues:
- `reportsTo` referencing a non-existent agent ID
- Circular reporting chains
- `agentTeams.templates` referencing a non-existent template
- Tier values must be one of: `general-manager`, `operations`, `manager`, `team-lead`, `teammate`
