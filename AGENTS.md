# AGENTS.md - just-bash-dropbox

Instructions for AI agents using just-bash-dropbox in projects.

## What is just-bash-dropbox?

A Dropbox filesystem adapter for [just-bash](https://github.com/vercel-labs/just-bash). It implements the `IFileSystem` interface so you can access Dropbox files through bash commands — `ls`, `cat`, `grep`, `awk`, and everything else just-bash supports.

## Quick Reference

```typescript
import { Bash } from "just-bash";
import { DropboxFs } from "just-bash-dropbox";

const fs = new DropboxFs({ accessToken: process.env.DROPBOX_TOKEN });
const bash = new Bash({ fs });

const result = await bash.exec("cat /Documents/report.csv | head -5");
// result.stdout  - file content
// result.stderr  - error output
// result.exitCode - 0 = success
```

## Key Behaviors

1. **Every operation is an API call**: `readdir`, `stat`, `readFile` each hit the Dropbox API. There is no local cache. For repeated reads, wrap with `OverlayFs`.

2. **Paths are case-insensitive**: `/README.md` and `/readme.md` are the same file. This matches Dropbox behavior.

3. **Write operations are real**: `echo "x" > /file` uploads to Dropbox. Use `MountableFs` for safe, memory-only writes.

4. **Token expiry**: Access tokens expire after ~4 hours. Use `getAccessToken` for long sessions.

5. **Rate limits**: Automatically retried with backoff. Avoid tight loops over large directories.

## Safe Mode

**Recommended for untrusted code.** Mount Dropbox at a path, writes go to in-memory base:

```typescript
import { Bash, MountableFs } from "just-bash";
import { DropboxFs } from "just-bash-dropbox";

const dropbox = new DropboxFs({ accessToken: "..." });
const mfs = new MountableFs();
mfs.mount("/dropbox", dropbox);
const bash = new Bash({ fs: mfs });
// reads /dropbox/* from Dropbox, writes anywhere else go to memory
```

## Scoping

Restrict access to a subfolder:

```typescript
const fs = new DropboxFs({
  accessToken: "...",
  rootPath: "/work/project-x",
});
// Agent sees "/" but can only access /work/project-x and below
```

## Unsupported Operations

These throw `ENOSYS` — Dropbox doesn't support them:

- `chmod`, `ln`, `ln -s`, `readlink`, `realpath`

## Error Codes

| Code | Meaning |
|------|---------|
| `ENOENT` | File/directory not found |
| `EEXIST` | Already exists |
| `EISDIR` | Is a directory (expected file) |
| `ENOTDIR` | Not a directory (expected directory) |
| `ENOSPC` | Dropbox quota exceeded |
| `ENOSYS` | Operation not supported |

## Limitations

- Single uploads: 150 MB max
- `>>` (append): downloads, appends, re-uploads — slow for large files
- `getAllPaths()` returns `[]` — glob works via readdir + stat
