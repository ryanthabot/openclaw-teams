import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { resolveTeamDir } from "../../teams/team-engine.js";
import {
  broadcastMessage,
  listRecentMessages,
  markRead,
  readMessages,
  sendMessage,
} from "../../teams/mailbox.js";
import { jsonResult, readStringParam } from "./common.js";

// ---------------------------------------------------------------------------
// team_message_send
// ---------------------------------------------------------------------------

const MessageSendSchema = Type.Object({
  projectId: Type.String(),
  teamName: Type.String(),
  from: Type.String(),
  to: Type.String(),
  body: Type.String(),
});

export function createTeamMessageSendTool(): AnyAgentTool {
  return {
    label: "Teams",
    name: "team_message_send",
    description:
      'Send a message to a teammate or broadcast to all. Use to="*" to broadcast, or specify a teammate role name for direct messaging.',
    parameters: MessageSendSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const projectId = readStringParam(params, "projectId", { required: true });
      const teamName = readStringParam(params, "teamName", { required: true });
      const from = readStringParam(params, "from", { required: true });
      const to = readStringParam(params, "to", { required: true });
      const body = readStringParam(params, "body", { required: true });

      try {
        const teamDir = resolveTeamDir(projectId, teamName);

        if (to === "*") {
          const message = await broadcastMessage(teamDir, { from, body });
          return jsonResult({ status: "broadcast", message });
        }

        const message = await sendMessage(teamDir, { from, to, body });
        return jsonResult({ status: "sent", message });
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
// team_message_read
// ---------------------------------------------------------------------------

const MessageReadSchema = Type.Object({
  projectId: Type.String(),
  teamName: Type.String(),
  role: Type.String(),
  markAsRead: Type.Optional(Type.Boolean()),
});

export function createTeamMessageReadTool(): AnyAgentTool {
  return {
    label: "Teams",
    name: "team_message_read",
    description:
      "Read unread messages for your role. Returns all unread direct messages and broadcasts addressed to you.",
    parameters: MessageReadSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const projectId = readStringParam(params, "projectId", { required: true });
      const teamName = readStringParam(params, "teamName", { required: true });
      const role = readStringParam(params, "role", { required: true });
      const shouldMarkRead = params.markAsRead !== false;

      try {
        const teamDir = resolveTeamDir(projectId, teamName);
        const messages = await readMessages(teamDir, role);

        if (shouldMarkRead) {
          for (const msg of messages) {
            await markRead(teamDir, msg.id);
          }
        }

        return jsonResult({
          status: "ok",
          count: messages.length,
          messages,
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
// team_message_list
// ---------------------------------------------------------------------------

const MessageListSchema = Type.Object({
  projectId: Type.String(),
  teamName: Type.String(),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
});

export function createTeamMessageListTool(): AnyAgentTool {
  return {
    label: "Teams",
    name: "team_message_list",
    description:
      "List recent messages in the team mailbox (both direct and broadcast). Returns newest first.",
    parameters: MessageListSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const projectId = readStringParam(params, "projectId", { required: true });
      const teamName = readStringParam(params, "teamName", { required: true });
      const limit =
        typeof params.limit === "number" && Number.isFinite(params.limit)
          ? Math.min(Math.max(1, Math.floor(params.limit)), 100)
          : 20;

      try {
        const teamDir = resolveTeamDir(projectId, teamName);
        const messages = await listRecentMessages(teamDir, limit);

        return jsonResult({
          status: "ok",
          count: messages.length,
          messages,
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
