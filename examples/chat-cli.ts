#!/usr/bin/env npx tsx

/**
 * Dropbox PKM — A personal knowledge management CLI powered by AI.
 *
 * Chat with an AI that uses your Dropbox as a persistent knowledge base.
 * It can capture notes, find information, link ideas, and organize your files.
 *
 * Usage:
 *   DROPBOX_TOKEN=sl.xxx AI_GATEWAY_API_KEY=xxx npx tsx examples/chat-cli.ts
 *
 * Requires:
 *   npm install ai zod
 */

import * as readline from "node:readline/promises";
import { type ModelMessage, stepCountIs, streamText, tool } from "ai";
import { DropboxFs } from "just-bash-dropbox";
import { Bash } from "just-bash";
import { z } from "zod";

// --- Setup ---

const dropboxToken = process.env.DROPBOX_TOKEN;
if (!dropboxToken) {
  console.error("Set DROPBOX_TOKEN environment variable");
  process.exit(1);
}
if (!process.env.AI_GATEWAY_API_KEY) {
  console.error("Set AI_GATEWAY_API_KEY environment variable");
  process.exit(1);
}

const fs = new DropboxFs({ accessToken: dropboxToken });
const bash = new Bash({ fs });
const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const today = new Date().toISOString().split("T")[0];

const bashTool = tool({
  description:
    "Execute a bash command against the user's Dropbox knowledge base. " +
    "Available: ls, cat, head, tail, grep, awk, sed, sort, uniq, wc, jq, find, cp, mv, rm, mkdir, echo. " +
    "All paths relative to Dropbox root (/). Files persist across sessions.",
  inputSchema: z.object({
    command: z.string().describe("The bash command to execute"),
  }),
  execute: async ({ command }) => {
    process.stdout.write(`  \x1b[2m$ ${command}\x1b[0m\n`);
    const result = await bash.exec(command);
    if (result.stdout) {
      const lines = result.stdout.split("\n").filter(Boolean);
      const preview = lines.slice(0, 8).join("\n");
      process.stdout.write(
        `  \x1b[2m${preview}${lines.length > 8 ? `\n  ... (${lines.length - 8} more lines)` : ""}\x1b[0m\n`,
      );
    }
    if (result.stderr) {
      process.stdout.write(`  \x1b[31m${result.stderr.trim()}\x1b[0m\n`);
    }
    return {
      stdout: result.stdout || "(no output)",
      stderr: result.stderr || "",
      exitCode: result.exitCode,
    };
  },
});

const SYSTEM = `You are a personal knowledge management assistant. The user's Dropbox is their persistent knowledge base — notes, ideas, logs, and reference material stored as plain text files.

Today's date: ${today}

## Your capabilities
- **Capture**: Save notes, ideas, meeting notes, journal entries to markdown files
- **Find**: Search across all files with grep, find specific topics, surface relevant notes
- **Connect**: Find links between ideas, suggest related notes, build indices
- **Organize**: Create folders, move/rename files, maintain structure
- **Summarize**: Read and synthesize information across multiple files

## Conventions
- Use markdown files (.md) for notes
- Organize by topic: /notes/, /journal/, /projects/, /reference/
- Journal entries go in /journal/YYYY-MM-DD.md
- Use YAML frontmatter for metadata when useful
- Append to daily journal rather than overwriting
- Use [[wiki-links]] in content to reference other notes

## Behavior
- Be concise but thorough
- When capturing, confirm what was saved
- When searching, show relevant snippets
- Proactively suggest connections ("this relates to your note on X")
- Create directory structure as needed (mkdir -p)
- For multi-line content, use multiple echo commands with >>`;

// --- Chat loop ---

const messages: ModelMessage[] = [];

console.log("\x1b[1mdropbox pkm\x1b[0m — your Dropbox as a knowledge base");
console.log("\x1b[2mCapture ideas, search notes, connect thoughts.\x1b[0m");
console.log(
  '\x1b[2mTry: "jot down an idea about X" · "what do I know about Y" · "journal entry"\x1b[0m\n',
);

while (true) {
  const input = await terminal.question("\x1b[36m>\x1b[0m ");

  if (
    input.trim().toLowerCase() === "exit" ||
    input.trim().toLowerCase() === "quit"
  ) {
    console.log("Bye!");
    break;
  }

  if (!input.trim()) continue;

  messages.push({ role: "user", content: input });

  let looping = true;
  while (looping) {
    const result = streamText({
      model: "anthropic/claude-haiku-4.5",
      system: SYSTEM,
      messages,
      tools: { bash: bashTool },
      stopWhen: stepCountIs(15),
    });

    process.stdout.write("\n");

    for await (const chunk of result.fullStream) {
      if (chunk.type === "text-delta") {
        process.stdout.write(chunk.text);
      }
    }

    const responseMessages = (await result.response).messages;
    messages.push(...responseMessages);

    const finishReason = await result.finishReason;
    if (finishReason !== "tool-calls") {
      looping = false;
    }
  }

  process.stdout.write("\n\n");
}

terminal.close();
