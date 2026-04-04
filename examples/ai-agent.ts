/**
 * AI Agent example — An agent that can search and summarize Dropbox files.
 *
 * This shows how an AI agent can use just-bash + DropboxFs to interact
 * with Dropbox files using natural bash commands. The agent can:
 * - Browse directories
 * - Search file contents with grep
 * - Read and analyze files
 * - Create summaries and save them back
 *
 * Usage:
 *   DROPBOX_TOKEN=sl.xxx npx tsx examples/ai-agent.ts
 */

import { DropboxFs } from "just-bash-dropbox";
import { Bash } from "just-bash";

const token = process.env.DROPBOX_TOKEN;
if (!token) {
  console.error("Set DROPBOX_TOKEN environment variable");
  process.exit(1);
}

// Scope the agent to a specific project folder
const fs = new DropboxFs({
  accessToken: token,
  rootPath: "/work",
});
const bash = new Bash({ fs });

// Simulate what an AI agent would do when asked:
// "Find all CSV files and tell me what data they contain"

async function agentWorkflow() {
  console.log("Agent: Looking for CSV files...\n");

  // Find CSV files
  const { stdout: csvFiles } = await bash.exec(
    "find / -name '*.csv' 2>/dev/null",
  );

  if (!csvFiles.trim()) {
    console.log("Agent: No CSV files found in /work");
    return;
  }

  console.log(`Agent: Found these CSV files:\n${csvFiles}`);

  // Read the header of each CSV to understand its structure
  for (const file of csvFiles.trim().split("\n")) {
    console.log(`\nAgent: Analyzing ${file}...`);
    const { stdout: header } = await bash.exec(`head -3 ${file}`);
    console.log(`  Headers: ${header.split("\n")[0]}`);
    const { stdout: lineCount } = await bash.exec(`wc -l < ${file}`);
    console.log(`  Rows: ${lineCount.trim()}`);
  }
}

agentWorkflow().catch(console.error);
