# just-bash-dropbox

> **Beta** — API may change. Use at your own risk.

A Dropbox filesystem adapter for [just-bash](https://github.com/vercel-labs/just-bash). Lets AI agents access Dropbox files through bash commands.

```ts
import { Bash } from "just-bash";
import { DropboxFs } from "just-bash-dropbox";

const fs = new DropboxFs({ accessToken: process.env.DROPBOX_TOKEN });
const bash = new Bash({ fs });

const { stdout } = await bash.exec("ls /Documents");
// "report.csv\nphotos\n"

await bash.exec("cat /reports/q4-summary.md");
await bash.exec("grep 'revenue' /reports/*.csv | sort -t, -k2 -rn");
```

## Install

```bash
npm install just-bash-dropbox just-bash
```

No other dependencies. Uses native `fetch` — Node 18+.

## Authentication

`DropboxFs` needs a Dropbox access token. Provide it directly or via a function that returns a fresh token.

```ts
// Static token — scripts, testing, short-lived sessions
const fs = new DropboxFs({ accessToken: "sl...." });

// Token provider — production, long-running agents
// Called before each API request. You handle refresh and persistence.
const fs = new DropboxFs({
  getAccessToken: async () => {
    return await myTokenStore.getFreshToken(userId);
  },
});
```

Get a token: create a Dropbox app at [dropbox.com/developers](https://www.dropbox.com/developers) and generate an access token, or implement the [OAuth2 flow](https://www.dropbox.com/developers/documentation/http/documentation#authorization).

Access tokens expire after ~4 hours. For agents that run longer, use `getAccessToken` with a refresh token flow (see `examples/token-provider.ts`).

## Scoping to a folder

Restrict the filesystem to a Dropbox subfolder. The agent sees `/` but operations are scoped underneath. Use this to limit what an agent can access.

```ts
const fs = new DropboxFs({
  accessToken: "...",
  rootPath: "/work/project-x",
});

const bash = new Bash({ fs });
await bash.exec("ls /");          // lists /work/project-x
await bash.exec("cat /readme.md"); // reads /work/project-x/readme.md
```

## Safe mode (read-only mount)

Use just-bash's `MountableFs` to mount Dropbox at a path while keeping the rest in memory. Writes go to the in-memory base filesystem, not to Dropbox. **Recommended for untrusted agents.**

```ts
import { Bash, MountableFs } from "just-bash";
import { DropboxFs } from "just-bash-dropbox";

const dropbox = new DropboxFs({ accessToken: "..." });
const mfs = new MountableFs();
mfs.mount("/dropbox", dropbox);
const bash = new Bash({ fs: mfs });

await bash.exec("cat /dropbox/data.csv");             // reads from Dropbox
await bash.exec("echo 'hello' > /notes.txt");          // writes to in-memory fs
await bash.exec("cp /dropbox/data.csv /local-copy.csv"); // copies to memory
```

## API

### `new DropboxFs(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `accessToken` | `string` | — | Static Dropbox access token |
| `getAccessToken` | `() => string \| Promise<string>` | — | Returns a fresh token per request |
| `rootPath` | `string` | `"/"` (root) | Scope all operations to this folder |

Provide either `accessToken` or `getAccessToken`, not both.

### Supported operations

All standard bash file operations work:

```bash
ls /path                          # list directory
cat /path/file.txt                # read file
echo "content" > /path/file.txt   # write file
cp /src /dest                     # copy
mv /src /dest                     # move
rm /path/file.txt                 # delete
rm -r /path/dir                   # delete directory
mkdir -p /path/deep/nested        # create nested directories
```

### Not supported

Dropbox doesn't have these concepts. These operations throw `ENOSYS`:

- `chmod` — no file permissions
- `ln` / `ln -s` — no hard/symbolic links
- `readlink`, `realpath` — no symlinks to resolve

### Limitations

- **File size**: Single uploads are limited to 150 MB
- **Append**: `>>` works but downloads the entire file, appends, and re-uploads
- **Case sensitivity**: Dropbox paths are case-insensitive (`/README.md` and `/readme.md` are the same file)
- **Rate limits**: Handled automatically with retry + backoff; heavy usage may still hit Dropbox's per-user limits
- **No glob via `getAllPaths`**: Returns `[]` — glob matching works through `readdir` + `stat` instead

## Error handling

Errors are mapped to errno-style codes for natural bash output:

| Dropbox error | Mapped code | Meaning |
|---------------|-------------|---------|
| `path/not_found` | `ENOENT` | File or directory doesn't exist |
| `path/conflict` | `EEXIST` | Already exists |
| `path/not_file` | `EISDIR` | Expected file, got directory |
| `path/not_folder` | `ENOTDIR` | Expected directory, got file |
| `insufficient_quota` | `ENOSPC` | Dropbox quota exceeded |

```ts
import { FsError } from "just-bash-dropbox";

try {
  await fs.readFile("/missing.txt");
} catch (err) {
  if (err instanceof FsError && err.code === "ENOENT") {
    // file not found
  }
}
```

## Interactive CLI

Chat with an AI that has full access to your Dropbox:

```bash
DROPBOX_TOKEN=sl.xxx AI_GATEWAY_API_KEY=xxx npx tsx examples/chat-cli.ts
```

```
you: what files do I have?
  $ ls -la /
  welcome.md

ai: You have one file — `welcome.md`. Want me to read it?

you: create a project plan in /plan.md
  $ echo "# Project Plan" > /plan.md
  $ echo "## Phase 1: Research" >> /plan.md

ai: Created /plan.md with a project plan outline.
```

See [`examples/chat-cli.ts`](./examples/chat-cli.ts) for the implementation — it's ~100 lines using the Vercel AI SDK.

## Examples

See the [`examples/`](./examples) directory:

- **`chat-cli.ts`** — Interactive CLI chat agent (recommended starting point)
- **`ai-agent-sdk.ts`** — Single-prompt AI agent with Vercel AI SDK
- **`safe-mode.ts`** — Read-only mount with `MountableFs`
- **`token-provider.ts`** — Production auth with auto-refresh
- **`basic-browsing.ts`** — List and read files
- **`file-search.ts`** — `grep` and `awk` on Dropbox files
- **`ai-agent.ts`** — Scripted agent workflow (no LLM)

## License

Apache-2.0
