# Dropbox JavaScript SDK Evaluation

**Date:** 2026-04-04
**Package:** `dropbox` on npm
**Repository:** https://github.com/dropbox/dropbox-sdk-js

## 1. Maintenance Status

**Verdict: Effectively abandoned.**

| Metric | Value |
|--------|-------|
| Last npm release | v10.34.0 — **November 9, 2022** (3.5 years ago) |
| Last commit on main | July 18, 2023 (a README typo fix) |
| Last substantive commit | May 30, 2023 |
| GitHub release v10.35.0 | Tagged Nov 2022, **never published to npm** |
| Open issues | 96 (GitHub) / 30 (API-visible) |
| Open issues receiving maintainer responses | Essentially none in 2024-2026 |
| Last push to repo | Feb 2026 (likely a bot/dependabot) |
| Bus factor | 1 primary contributor (rileytomasek, 115 commits), plus DropboxBot for auto-generated code |

Community issues from 2024-2026 remain unanswered. The SDK is not formally deprecated or archived, but shows no signs of active maintenance.

## 2. Bundle Size

| Metric | Value |
|--------|-------|
| Unpacked size (npm) | **4.77 MB** |
| `types/dropbox_types.d.ts` | 1.1 MB (37,599 lines) — auto-generated, covers every Dropbox API namespace |
| `lib/routes.js` | 172 KB (3,783 lines) — auto-generated route definitions for every API endpoint |
| Core source (`src/`) | 783 lines total (lean) |

The package is bloated because it ships auto-generated bindings for the **entire** Dropbox API surface (files, team, sharing, paper, contacts, etc.). A filesystem adapter would use maybe 8-10 of the hundreds of routes.

## 3. API Surface

The SDK is a **thin wrapper** around the HTTP API. Here's what it actually does:

1. **Auto-generated route methods** — each one is a one-liner calling `this.request(path, arg, authType, host, style)`:
   ```js
   routes.filesListFolder = function (arg) {
     return this.request('files/list_folder', arg, 'app, user', 'api', 'rpc', 'files.metadata.read');
   };
   ```

2. **Three request styles** — `rpc` (JSON body), `download` (returns binary), `upload` (sends binary). Each is ~15 lines of fetch configuration.

3. **Auth handling** — OAuth2 token management with PKCE support, token refresh, app auth vs user auth. This is the most substantial part (~400 lines).

4. **Response parsing** — minimal, ~60 lines.

The entire core logic is under 800 lines. The SDK adds almost no abstraction beyond mapping method names to URL paths and handling the three request styles.

## 4. TypeScript Support

**Types are auto-generated from Dropbox's Stone API spec.** They are comprehensive (37,599 lines covering every API type) but:

- Written as ambient declarations, not proper module types
- The source code itself is plain JavaScript with JSDoc — not TypeScript
- Constructor types use `any` and `Function` in several places
- Open issues report type inaccuracies (e.g., `filesDownload` return type missing binary data fields)
- No updates to types since the last release

For our 8 methods, we'd write better types in an afternoon.

## 5. Dependencies

**One runtime dependency:** `node-fetch@^2.6.1`

This is a problem:
- `node-fetch` v2 is CommonJS-only and effectively EOL
- `node-fetch` v3+ is ESM-only (the SDK pins v2)
- Node 18+ has built-in `fetch` — the dependency is unnecessary in modern runtimes
- The SDK uses `require('node-fetch')` inline, which breaks in ESM-only contexts

Peer dependency: `@types/node-fetch@^2.5.7`

## 6. ESM Support

**Partial, with significant issues:**

- Has `"module": "es/index.js"` and `"jsnext:main"` fields (legacy ESM entry points)
- No `"exports"` field in package.json (modern Node ESM resolution)
- No `"type": "module"` declaration
- Source uses `export default` syntax but the CJS build uses Babel
- Auth module uses `require('node-fetch')` and `require('crypto')` at runtime — **breaks in strict ESM environments**
- The `es/` build is Babel-transpiled, not native ESM

Using this in a modern ESM-only project will cause issues.

## Recommendation: Raw HTTP Calls

**Use raw HTTP calls. Do not use the SDK.**

### Rationale

1. **The SDK adds almost no value for our use case.** The core abstraction is mapping method names to `POST https://api.dropboxapi.com/2/{path}` with JSON body. That's a one-liner with native `fetch`.

2. **The SDK is unmaintained.** No npm release in 3.5 years, no maintainer activity, unresolved issues piling up. This is exactly the scenario the user wants to avoid.

3. **Dependency baggage.** The SDK brings in `node-fetch` v2 (EOL, CJS-only) when modern Node has `fetch` built in. It also ships 4.77 MB of auto-generated code for hundreds of endpoints we'll never use.

4. **ESM compatibility issues.** The SDK's use of inline `require()` and lack of proper `"exports"` field makes it problematic in ESM-only projects.

5. **The HTTP API is simple.** Dropbox uses three patterns for all file operations:
   - **RPC** (metadata ops): `POST` with JSON body to `api.dropboxapi.com/2/{endpoint}`
   - **Upload**: `POST` with binary body + `Dropbox-API-Arg` header to `content.dropboxapi.com/2/{endpoint}`
   - **Download**: `POST` with `Dropbox-API-Arg` header to `content.dropboxapi.com/2/{endpoint}`, response body is binary

### What we'd need to implement ourselves

A minimal Dropbox HTTP client for ~8 filesystem methods:

```
POST /2/files/list_folder          — ls (RPC style)
POST /2/files/list_folder/continue — ls pagination (RPC style)
POST /2/files/get_metadata         — stat (RPC style)
POST /2/files/download             — read (Download style)
POST /2/files/upload               — write (Upload style)
POST /2/files/delete_v2            — rm (RPC style)
POST /2/files/create_folder_v2     — mkdir (RPC style)
POST /2/files/move_v2              — mv (RPC style)
POST /2/files/copy_v2              — cp (RPC style)
```

All of these follow the same pattern:
- Auth: `Authorization: Bearer {token}` header
- RPC: JSON in, JSON out
- Upload: JSON params in `Dropbox-API-Arg` header, binary in body
- Download: JSON params in `Dropbox-API-Arg` header, binary in response

This is ~100-150 lines of code with zero dependencies (using native `fetch`), good TypeScript types for just the endpoints we use, and full control over error handling.

### Cost of going raw

- We need to handle token refresh ourselves if using short-lived tokens (~30 lines)
- We write our own types for the 8 endpoint request/response shapes (~100 lines, but precisely what we need)
- No auto-generated method names — we call endpoints by path string (fine for 8 methods)

### What we avoid

- 4.77 MB dependency for 8 method calls
- `node-fetch` v2 transitive dependency
- ESM compatibility issues
- Risk of depending on an unmaintained package
- 37,599 lines of type definitions we don't need
