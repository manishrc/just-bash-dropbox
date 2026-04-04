/**
 * Basic file browsing — List files and read content from Dropbox.
 *
 * Usage:
 *   DROPBOX_TOKEN=sl.xxx npx tsx examples/basic-browsing.ts
 */

import { Bash } from "just-bash";
import { DropboxFs } from "just-bash-dropbox";

const token = process.env.DROPBOX_TOKEN;
if (!token) {
  console.error("Set DROPBOX_TOKEN environment variable");
  process.exit(1);
}

const fs = new DropboxFs({ accessToken: token });
const bash = new Bash({ fs });

// List root directory
console.log("=== Root directory ===");
const { stdout: rootListing } = await bash.exec("ls /");
console.log(rootListing);

// Show file details
console.log("\n=== Detailed listing ===");
const { stdout: detailed } = await bash.exec("ls -la /");
console.log(detailed);

// Read a file (try README or any text file you have)
console.log("\n=== Search for text files ===");
const { stdout: files } = await bash.exec("ls / | head -10");
console.log(files);
