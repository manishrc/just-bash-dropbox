/**
 * File search workflow — Search across Dropbox files using grep and awk.
 *
 * Demonstrates using bash text processing tools on Dropbox files:
 * - grep for content search
 * - awk for data extraction
 * - sort/uniq for analysis
 *
 * Usage:
 *   DROPBOX_TOKEN=sl.xxx npx tsx examples/file-search.ts
 */

import { DropboxFs } from "just-bash-dropbox";
import { Bash } from "just-bash";

const token = process.env.DROPBOX_TOKEN;
if (!token) {
  console.error("Set DROPBOX_TOKEN environment variable");
  process.exit(1);
}

const fs = new DropboxFs({ accessToken: token });
const bash = new Bash({ fs });

async function searchWorkflow() {
  // List everything available
  console.log("=== Available files ===");
  const { stdout: listing } = await bash.exec("ls -R / 2>/dev/null | head -30");
  console.log(listing);

  // Search for a pattern across all text files
  const searchTerm = process.argv[2] || "TODO";
  console.log(`\n=== Searching for "${searchTerm}" ===`);

  const { stdout: results, exitCode } = await bash.exec(
    `grep -r "${searchTerm}" / 2>/dev/null | head -20`,
  );

  if (exitCode === 0 && results.trim()) {
    console.log(results);
  } else {
    console.log(`No matches found for "${searchTerm}"`);
  }
}

searchWorkflow().catch(console.error);
