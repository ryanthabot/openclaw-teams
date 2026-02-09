/** Hierarchy tier for an agent within the company-of-teams structure. */
export type AgentTier =
  | "general-manager"
  | "operations"
  | "manager"
  | "team-lead"
  | "teammate";

/** A member definition within a team template (team lead or teammate). */
export type TeamMemberTemplate = {
  /** Role identifier (e.g. "architect", "tech-stack-researcher"). */
  role: string;
  /** Display name for this team member. */
  name?: string;
  /** Model override (provider/model). */
  model?: string;
  /** Path to persona directory containing SOUL.md / AGENTS.md for this role. */
  persona?: string;
};

/** A reusable team template defining a team lead and set of teammates. */
export type TeamTemplate = {
  /** Human-readable team name. */
  teamName: string;
  /** The team lead configuration. */
  teamLead: TeamMemberTemplate;
  /** List of teammate configurations. */
  teammates: TeamMemberTemplate[];
  /** Hook file paths keyed by hook event name. */
  hooks?: Record<string, string>;
  /** Default settings for this team. */
  defaults?: {
    /** How tasks are assigned: teammates self-claim or team lead assigns. */
    taskClaiming?: "self-claim" | "assigned";
    /** Display mode hint for UI (e.g. "split-panes"). */
    displayMode?: string;
    /** Whether the team lead must approve plans before execution. */
    requirePlanApproval?: boolean;
  };
};

/** Top-level teams configuration in openclaw.json. */
export type TeamsConfig = {
  /** Reusable team templates keyed by template ID. */
  templates?: Record<string, TeamTemplate>;
};

/** Agent hierarchy configuration fields added to AgentConfig. */
export type AgentHierarchyConfig = {
  /** This agent's tier in the company hierarchy. */
  tier?: AgentTier;
  /** The agent ID this agent reports to. */
  reportsTo?: string;
  /** Agent teams configuration for managers. */
  agentTeams?: {
    /** Whether agent teams are enabled for this agent. */
    enabled?: boolean;
    /** Template IDs this agent can spawn (references teams.templates keys). */
    templates?: string[];
  };
};
