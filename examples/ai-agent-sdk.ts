/**
 * AI Agent with Vercel AI SDK — An agent that can browse and analyze Dropbox files.
 *
 * Uses generateText with tools via the Vercel AI Gateway to give an LLM
 * access to your Dropbox through bash commands.
 *
 * Usage:
 *   DROPBOX_TOKEN=sl.xxx AI_GATEWAY_API_KEY=xxx npx tsx examples/ai-agent-sdk.ts
 *   DROPBOX_TOKEN=sl.xxx AI_GATEWAY_API_KEY=xxx npx tsx examples/ai-agent-sdk.ts "Find all TODO items"
 *
 * Requires:
 *   npm install ai zod
 */

import { generateText, stepCountIs, tool } from "ai";
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

// --- Agent ---

const { text, steps } = await generateText({
  model: "anthropic/claude-sonnet-4.5",
  system: `You are a helpful file assistant with access to a Dropbox filesystem via bash commands.
You can list files, read contents, search with grep, and process data with standard Unix tools.
When the user asks about their files, use the bash tool to explore and analyze.
Be concise in your responses. Show relevant file contents when helpful.`,

  tools: {
    bash: tool({
      description:
        "Execute a bash command against the user's Dropbox filesystem. " +
        "Available commands: ls, cat, head, tail, grep, awk, sed, sort, uniq, wc, jq, find, cp, mv, rm, mkdir, echo. " +
        "All paths are relative to the Dropbox root. Use / for root.",
      inputSchema: z.object({
        command: z
          .string()
          .describe(
            "The bash command to execute, e.g. 'ls -la /' or 'cat /readme.md'",
          ),
      }),
      execute: async ({ command }) => {
        console.log(`  > ${command}`);
        const result = await bash.exec(command);
        return {
          stdout: result.stdout || "(no output)",
          stderr: result.stderr || "",
          exitCode: result.exitCode,
        };
      },
    }),
  },

  stopWhen: stepCountIs(10),

  prompt:
    process.argv[2] ||
    "What files are in my Dropbox? Give me an overview of what's there.",
});

// --- Output ---

console.log(`\n${"═".repeat(60)}`);
console.log("Agent response:");
console.log("═".repeat(60));
console.log(text);
console.log(`\n(${steps.length} steps)`);
