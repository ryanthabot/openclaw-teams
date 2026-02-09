import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { MailboxMessage } from "./types.js";

/** Send a direct message to a specific teammate. */
export async function sendMessage(
  teamDir: string,
  params: { from: string; to: string; body: string },
): Promise<MailboxMessage> {
  const messagesDir = path.join(teamDir, "mailbox", "messages");
  await fs.mkdir(messagesDir, { recursive: true });

  const message: MailboxMessage = {
    id: `msg-${crypto.randomUUID().slice(0, 8)}`,
    from: params.from,
    to: params.to,
    timestamp: new Date().toISOString(),
    body: params.body,
    read: false,
  };

  await fs.writeFile(
    path.join(messagesDir, `${message.id}.json`),
    JSON.stringify(message, null, 2) + "\n",
    "utf-8",
  );

  return message;
}

/** Broadcast a message to all teammates. */
export async function broadcastMessage(
  teamDir: string,
  params: { from: string; body: string },
): Promise<MailboxMessage> {
  const broadcastsDir = path.join(teamDir, "mailbox", "broadcasts");
  await fs.mkdir(broadcastsDir, { recursive: true });

  const message: MailboxMessage = {
    id: `broadcast-${crypto.randomUUID().slice(0, 8)}`,
    from: params.from,
    to: "*",
    timestamp: new Date().toISOString(),
    body: params.body,
    read: false,
  };

  await fs.writeFile(
    path.join(broadcastsDir, `${message.id}.json`),
    JSON.stringify(message, null, 2) + "\n",
    "utf-8",
  );

  return message;
}

/** Read unread messages for a specific recipient. Includes broadcasts. */
export async function readMessages(
  teamDir: string,
  recipientRole: string,
): Promise<MailboxMessage[]> {
  const messages: MailboxMessage[] = [];

  // Direct messages
  const messagesDir = path.join(teamDir, "mailbox", "messages");
  const directMessages = await loadMessagesFromDir(messagesDir);
  for (const msg of directMessages) {
    if ((msg.to === recipientRole || msg.to === "*") && !msg.read) {
      messages.push(msg);
    }
  }

  // Broadcasts (visible to all except sender)
  const broadcastsDir = path.join(teamDir, "mailbox", "broadcasts");
  const broadcasts = await loadMessagesFromDir(broadcastsDir);
  for (const msg of broadcasts) {
    if (msg.from !== recipientRole && !msg.read) {
      messages.push(msg);
    }
  }

  // Sort by timestamp
  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return messages;
}

/** List recent messages in the team mailbox. */
export async function listRecentMessages(
  teamDir: string,
  limit = 20,
): Promise<MailboxMessage[]> {
  const allMessages: MailboxMessage[] = [];

  const messagesDir = path.join(teamDir, "mailbox", "messages");
  allMessages.push(...(await loadMessagesFromDir(messagesDir)));

  const broadcastsDir = path.join(teamDir, "mailbox", "broadcasts");
  allMessages.push(...(await loadMessagesFromDir(broadcastsDir)));

  // Sort by timestamp descending (newest first), then take limit
  allMessages.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return allMessages.slice(0, limit);
}

/** Mark a message as read. */
export async function markRead(
  teamDir: string,
  messageId: string,
): Promise<boolean> {
  // Search in messages directory
  const messagesDir = path.join(teamDir, "mailbox", "messages");
  if (await markReadInDir(messagesDir, messageId)) {
    return true;
  }

  // Search in broadcasts directory
  const broadcastsDir = path.join(teamDir, "mailbox", "broadcasts");
  return markReadInDir(broadcastsDir, messageId);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function loadMessagesFromDir(dir: string): Promise<MailboxMessage[]> {
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const messages: MailboxMessage[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf-8");
      messages.push(JSON.parse(raw) as MailboxMessage);
    } catch {
      // skip malformed files
    }
  }
  return messages;
}

async function markReadInDir(dir: string, messageId: string): Promise<boolean> {
  const filePath = path.join(dir, `${messageId}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const message = JSON.parse(raw) as MailboxMessage;
    message.read = true;
    await fs.writeFile(filePath, JSON.stringify(message, null, 2) + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}
