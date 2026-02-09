import type { AgentTier } from "../config/types.teams.js";
import type { MemoryAccessLevel, MemoryTier } from "./types.js";

/**
 * Three-tier memory permission matrix.
 *
 * | Memory Level     | Write Access               | Read Access            |
 * |------------------|----------------------------|------------------------|
 * | Company Memory   | GM + Operations only       | All managers           |
 * | Project Shared   | All team members           | All team members       |
 * | Team Memory      | Team Lead + Teammates      | Team Lead + Teammates  |
 */

/** Resolve memory access level for a given tier and memory tier. */
export function resolveMemoryAccess(
  agentTier: AgentTier | undefined,
  memoryTier: MemoryTier,
): MemoryAccessLevel {
  if (!agentTier) {
    return "read"; // no tier = legacy agent, default to read
  }

  switch (memoryTier) {
    case "company":
      return resolveCompanyMemoryAccess(agentTier);
    case "project-shared":
      return resolveProjectSharedAccess(agentTier);
    case "team":
      return resolveTeamMemoryAccess(agentTier);
    default:
      return "none";
  }
}

/** Check if an agent can write to company-wide memory. */
export function canWriteCompanyMemory(tier: AgentTier | undefined): boolean {
  if (!tier) {
    return false;
  }
  return tier === "general-manager" || tier === "operations";
}

/** Check if an agent can read company-wide memory. */
export function canReadCompanyMemory(tier: AgentTier | undefined): boolean {
  if (!tier) {
    return false;
  }
  return (
    tier === "general-manager" ||
    tier === "operations" ||
    tier === "manager"
  );
}

/** Check if an agent can write to project shared memory. */
export function canWriteProjectShared(tier: AgentTier | undefined): boolean {
  if (!tier) {
    return true; // legacy agents get write access
  }
  // All tiers except operations (read-only observer)
  return tier !== "operations";
}

/**
 * Check if an agent can access a specific team's memory.
 * Team leads and teammates can access their own team's memory.
 * Managers can read any team under them.
 */
export function canAccessTeamMemory(
  agentTier: AgentTier | undefined,
  isOwnTeam: boolean,
): MemoryAccessLevel {
  if (!agentTier) {
    return "none";
  }

  switch (agentTier) {
    case "general-manager":
      return "read"; // GM can read any team
    case "operations":
      return "read"; // Operations can read any team
    case "manager":
      return "read"; // Managers can read teams under them
    case "team-lead":
      return isOwnTeam ? "write" : "none";
    case "teammate":
      return isOwnTeam ? "write" : "none";
    default:
      return "none";
  }
}

// ---------------------------------------------------------------------------
// Composite validation for team_memory_* tools
// ---------------------------------------------------------------------------

/** Memory tier as used by the team_memory_* tools. */
export type ToolMemoryTier = "workspace" | "project" | "team";

/**
 * Validate whether an agent at a given tier is allowed to perform
 * a read or write operation on the specified memory tier.
 *
 * Rules:
 * - workspace: only GM and operations can write; GM, operations, managers can read
 * - project: managers and above can write; all tiers can read
 * - team: team-lead and teammate can write (own team); managers and above can read
 */
export function validateMemoryAccess(params: {
  agentTier: AgentTier | undefined;
  memoryTier: ToolMemoryTier;
  operation: "read" | "write";
  isOwnTeam?: boolean;
}): { allowed: boolean; reason?: string } {
  const { agentTier, memoryTier, operation, isOwnTeam } = params;

  if (!agentTier) {
    // Legacy agents without a tier: allow reads, deny writes
    return operation === "read"
      ? { allowed: true }
      : { allowed: false, reason: "Agent has no tier assigned; writes require a valid tier" };
  }

  switch (memoryTier) {
    case "workspace": {
      // Maps to company memory
      if (operation === "write") {
        const allowed = canWriteCompanyMemory(agentTier);
        return allowed
          ? { allowed: true }
          : { allowed: false, reason: `Tier "${agentTier}" cannot write to workspace memory (GM and operations only)` };
      }
      const allowed = canReadCompanyMemory(agentTier);
      return allowed
        ? { allowed: true }
        : { allowed: false, reason: `Tier "${agentTier}" cannot read workspace memory` };
    }

    case "project": {
      // Maps to project-shared memory
      if (operation === "write") {
        const allowed = canWriteProjectShared(agentTier);
        return allowed
          ? { allowed: true }
          : { allowed: false, reason: `Tier "${agentTier}" cannot write to project memory` };
      }
      // All tiers can read project memory
      return { allowed: true };
    }

    case "team": {
      // Maps to team memory
      const access = canAccessTeamMemory(agentTier, isOwnTeam ?? true);
      if (operation === "write") {
        return access === "write"
          ? { allowed: true }
          : { allowed: false, reason: `Tier "${agentTier}" cannot write to team memory` };
      }
      return access !== "none"
        ? { allowed: true }
        : { allowed: false, reason: `Tier "${agentTier}" cannot read team memory` };
    }

    default:
      return { allowed: false, reason: `Unknown memory tier: ${memoryTier}` };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveCompanyMemoryAccess(tier: AgentTier): MemoryAccessLevel {
  switch (tier) {
    case "general-manager":
    case "operations":
      return "write";
    case "manager":
      return "read";
    default:
      return "none";
  }
}

function resolveProjectSharedAccess(tier: AgentTier): MemoryAccessLevel {
  switch (tier) {
    case "operations":
      return "read";
    default:
      return "write";
  }
}

function resolveTeamMemoryAccess(tier: AgentTier): MemoryAccessLevel {
  switch (tier) {
    case "general-manager":
    case "operations":
    case "manager":
      return "read";
    case "team-lead":
    case "teammate":
      return "write"; // for own team only (caller must verify team membership)
    default:
      return "none";
  }
}
