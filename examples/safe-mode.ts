/**
 * Safe mode — Mount Dropbox read-only, write to memory.
 *
 * Uses just-bash's MountableFs to create a safe sandbox where:
 * - Dropbox files are mounted at /dropbox (read from API)
 * - All other paths use the in-memory base filesystem
 * - Writes never touch Dropbox
 *
 * Perfect for AI agents that need to process files without risk
 * of modifying the user's Dropbox.
 *
 * Usage:
 *   DROPBOX_TOKEN=sl.xxx npx tsx examples/safe-mode.ts
 */

import { Bash, MountableFs } from "just-bash";
import { DropboxFs } from "just-bash-dropbox";

const token = process.env.DROPBOX_TOKEN;
if (!token) {
  console.error("Set DROPBOX_TOKEN environment variable");
  process.exit(1);
}

// Mount Dropbox at /dropbox, everything else is in-memory
const dropbox = new DropboxFs({ accessToken: token });
const mfs = new MountableFs();
mfs.mount("/dropbox", dropbox);

const bash = new Bash({ fs: mfs });

async function safeWorkflow() {
  // Read from Dropbox (goes through to the API)
  console.log("=== Reading from Dropbox ===");
  const { stdout } = await bash.exec("ls /dropbox/");
  console.log(stdout || "(empty Dropbox)");

  // Write to memory (does NOT touch Dropbox)
  console.log("=== Writing to memory only ===");
  await bash.exec('echo "This is a local note" > /notes.txt');
  await bash.exec('echo "Another note" >> /notes.txt');

  // Read back the local file
  const { stdout: notes } = await bash.exec("cat /notes.txt");
  console.log(`Local notes:\n${notes}`);

  // Copy a Dropbox file locally for processing
  console.log("=== Copy Dropbox file to memory for processing ===");
  const { stdout: files } = await bash.exec("ls /dropbox/ | head -1");
  if (files.trim()) {
    const firstFile = files.trim();
    await bash.exec(`cp /dropbox/${firstFile} /local-${firstFile}`);
    console.log(`Copied /dropbox/${firstFile} to /local-${firstFile}`);
  } else {
    console.log("No files in Dropbox to copy");
  }

  console.log("\n=== Dropbox is untouched ===");
  console.log("All writes went to the in-memory filesystem!");
}

safeWorkflow().catch(console.error);
