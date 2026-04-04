# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`just-bash-dropbox` implements the `IFileSystem` interface from [just-bash](https://github.com/vercel-labs/just-bash) backed by the Dropbox HTTP API. Zero runtime dependencies — uses native `fetch`.

## Commands

```bash
bun install                              # install dependencies
bun vitest                               # run tests in watch mode
bun vitest run                           # run tests once
bun vitest run src/dropbox-fs.test.ts    # run a single test file
bunx tsc --noEmit                        # typecheck only
bunx tsc                                 # build to dist/
bunx biome check .                       # lint + format check
bunx biome check --write .               # auto-fix
```

## Architecture

```
DropboxFs (IFileSystem)  →  DropboxClient (HTTP)  →  Dropbox API
     ↑                            ↑
  public API               system boundary
  (behavior tests)          (mocked in tests)
```

- **`src/dropbox-fs.ts`** — `DropboxFs` class, all IFileSystem methods
- **`src/dropbox-client.ts`** — thin HTTP client: three patterns (RPC, upload, download), retry on 429
- **`src/errors.ts`** — maps Dropbox API errors → errno-style (`ENOENT`, `EEXIST`, etc.)
- **`src/paths.ts`** — path normalization (root = `""`, trailing slashes, rootPath prefix)
- **`src/types.ts`** — Dropbox API response types, `DropboxFsOptions`

Tests mock `fetch` globally — that's the system boundary. No mocking of internal modules.

## Toolchain

- **TypeScript** with `tsc` (no bundler)
- **vitest** for tests
- **biome** for lint + format
- **bun** as package manager and runner
- **ESM-only** (`"type": "module"`)

## Development approach

Strict TDD: one failing test → minimal code to pass → repeat. Vertical slices, not horizontal.

## Dropbox API

- RPC endpoints: `api.dropboxapi.com` (JSON body → JSON response)
- Content endpoints: `content.dropboxapi.com` (file bytes, args in `Dropbox-API-Arg` header)
- Auth: `Authorization: Bearer <token>`
- Root path is `""` (empty string), not `"/"`
- Paths are case-insensitive
- See `docs/dropbox-http-api.md` for endpoint reference
