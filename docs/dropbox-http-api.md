# Dropbox HTTP API Reference

Source: https://www.dropbox.com/developers/documentation/http/documentation

---

## Architecture

### Three Endpoint Types

| Type | Host | Args Location | Result Location |
|------|------|--------------|-----------------|
| **RPC** | `api.dropboxapi.com` | JSON in request body | JSON in response body |
| **Content-upload** | `content.dropboxapi.com` | JSON in `Dropbox-API-Arg` header | JSON in response body |
| **Content-download** | `content.dropboxapi.com` | JSON in `Dropbox-API-Arg` header | JSON in `Dropbox-API-Result` response header; file content in response body |

Content-download endpoints also support HTTP GET, ETag caching (`If-None-Match`), and range requests.

### Authentication

All API calls use OAuth 2.0 Bearer tokens:

```
Authorization: Bearer <ACCESS_TOKEN>
```

**Token types:**
- **Short-lived access tokens** -- expire in ~4 hours (`expires_in: 14400`)
- **Refresh tokens** -- long-lived, used to obtain new access tokens
- **App auth tokens** -- for app-level (not user-level) endpoints

**OAuth2 flow (authorization code):**

1. Direct user to: `https://www.dropbox.com/oauth2/authorize?client_id=<APP_KEY>&response_type=code&token_access_type=offline`
2. User authorizes, gets redirected with `code`
3. Exchange code for tokens:

```bash
curl -X POST https://api.dropboxapi.com/oauth2/token \
  -d code=<CODE> \
  -d grant_type=authorization_code \
  -d client_id=<APP_KEY> \
  -d client_secret=<APP_SECRET>
```

Returns: `{ "access_token", "expires_in", "token_type": "bearer", "refresh_token", "scope", "account_id" }`

**Refresh an access token:**

```bash
curl -X POST https://api.dropboxapi.com/oauth2/token \
  -d grant_type=refresh_token \
  -d refresh_token=<REFRESH_TOKEN> \
  -d client_id=<APP_KEY> \
  -d client_secret=<APP_SECRET>
```

Returns: `{ "access_token", "expires_in", "token_type": "bearer" }`

**Required scopes for filesystem ops:**
- `files.metadata.read` -- list_folder, get_metadata
- `files.content.read` -- download
- `files.content.write` -- upload, create_folder, delete, copy, move

### Path Format

- Root folder = `""` (empty string)
- All other paths start with `/` (e.g., `/Documents/file.txt`)
- Paths are **case-insensitive** but **case-preserving**
- Files also have IDs: `"id:abc123xyz"` (accepted by most endpoints)
- Revisions: `"rev:a1c10ce0dd78"` (accepted by download/get_metadata)

### Date Format

ISO 8601 UTC: `2015-05-12T15:50:38Z`

---

## Error Handling

### HTTP Status Codes

| Code | Meaning | Body Format |
|------|---------|-------------|
| 400 | Bad input parameter | Plaintext |
| 401 | Bad/expired token | JSON `AuthError` |
| 403 | No access to endpoint/feature | JSON `AccessError` |
| 409 | **Endpoint-specific error** | JSON (see each endpoint) |
| 429 | Rate limited | JSON `RateLimitError` or plaintext |
| 5xx | Dropbox server error | -- |

### Error Response Format (409)

```json
{
  "error_summary": "path/not_found/...",
  "error": {
    ".tag": "path",
    "path": { ".tag": "not_found" }
  },
  "user_message": "optional human-readable message"
}
```

The `error_summary` is a `/`-delimited string of union tags with random `.` chars appended. Use prefix matching, not exact matching.

### Rate Limiting (429)

Response includes `Retry-After` header (seconds to wait). JSON body:

```json
{
  "error": {
    ".tag": "too_many_requests",
    "retry_after": 1
  }
}
```

Reasons: `too_many_requests`, `too_many_write_operations`

---

## Filesystem Endpoints

### 1. List Folder (readdir)

**`POST https://api.dropboxapi.com/2/files/list_folder`** -- RPC

```bash
curl -X POST https://api.dropboxapi.com/2/files/list_folder \
  --header "Authorization: Bearer <TOKEN>" \
  --header "Content-Type: application/json" \
  --data '{"path": "/Documents", "recursive": false, "include_deleted": false, "limit": 100}'
```

**Request body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | String | Yes | -- | Folder path. `""` for root |
| `recursive` | Boolean | No | false | Include subfolders recursively |
| `include_deleted` | Boolean | No | false | Include deleted entries |
| `include_mounted_folders` | Boolean | No | true | Include app/shared/team folders |
| `include_non_downloadable_files` | Boolean | No | true | Include Google Docs etc. |
| `limit` | UInt32 | No | -- | Max results per request (1-2000, approximate) |

**Response body:**

```json
{
  "entries": [
    {
      ".tag": "file",
      "name": "Prime_Numbers.txt",
      "id": "id:a4ayc_80_OEAAAAAAAAAXw",
      "path_lower": "/documents/prime_numbers.txt",
      "path_display": "/Documents/Prime_Numbers.txt",
      "rev": "a1c10ce0dd78",
      "size": 7212,
      "client_modified": "2015-05-12T15:50:38Z",
      "server_modified": "2015-05-12T15:50:38Z",
      "content_hash": "e3b0c44298fc1c149afbf4c8996fb924...",
      "is_downloadable": true
    },
    {
      ".tag": "folder",
      "name": "math",
      "id": "id:a4ayc_80_OEAAAAAAAAAXz",
      "path_lower": "/documents/math",
      "path_display": "/Documents/math"
    }
  ],
  "cursor": "ZtkX9_EHj3x7PMkVuFIhwKYXEpwpLwyxp9vMKomUhllil9q7eWiAu",
  "has_more": false
}
```

**Pagination:** If `has_more` is true, call `/list_folder/continue` with the `cursor`.

**Errors (409):** `ListFolderError` -- `path` (LookupError)

---

### 1b. List Folder Continue (pagination)

**`POST https://api.dropboxapi.com/2/files/list_folder/continue`** -- RPC

```bash
curl -X POST https://api.dropboxapi.com/2/files/list_folder/continue \
  --header "Authorization: Bearer <TOKEN>" \
  --header "Content-Type: application/json" \
  --data '{"cursor": "ZtkX9_EHj3x7PMkVuFIhwKYXEpwpLwyxp9vMKomUhllil9q7eWiAu"}'
```

**Request:** `{ "cursor": "<string>" }`

**Response:** Same as list_folder (`entries`, `cursor`, `has_more`)

**Errors (409):** `path` (LookupError), `reset` (cursor invalidated -- must restart with list_folder)

---

### 2. Download File (readFile)

**`POST https://content.dropboxapi.com/2/files/download`** -- Content-download

```bash
curl -X POST https://content.dropboxapi.com/2/files/download \
  --header "Authorization: Bearer <TOKEN>" \
  --header "Dropbox-API-Arg: {\"path\": \"/Documents/file.txt\"}"
```

**Parameters** (in `Dropbox-API-Arg` header):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | String | Yes | File path, id, or rev |

**Response:**
- **Body:** Raw file content (`application/octet-stream`)
- **`Dropbox-API-Result` header:** JSON FileMetadata (name, id, size, rev, client_modified, server_modified, content_hash, etc.)

**Errors (409):** `path` (LookupError), `unsupported_file` (use /export instead)

---

### 3. Upload File (writeFile)

**`POST https://content.dropboxapi.com/2/files/upload`** -- Content-upload

```bash
curl -X POST https://content.dropboxapi.com/2/files/upload \
  --header "Authorization: Bearer <TOKEN>" \
  --header "Dropbox-API-Arg: {\"path\": \"/Documents/file.txt\", \"mode\": \"overwrite\", \"autorename\": false, \"mute\": false}" \
  --header "Content-Type: application/octet-stream" \
  --data-binary @local_file.txt
```

**Parameters** (in `Dropbox-API-Arg` header):

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | String | Yes | -- | Destination path |
| `mode` | WriteMode | No | `"add"` | `"add"`, `"overwrite"`, or `{"update": "<rev>"}` |
| `autorename` | Boolean | No | false | Auto-rename on conflict |
| `mute` | Boolean | No | false | Suppress user notifications |
| `client_modified` | Timestamp | No | -- | Custom modification time |
| `strict_conflict` | Boolean | No | false | Stricter conflict detection |
| `content_hash` | String(64) | No | -- | SHA-256 content hash for integrity |

**Request body:** Raw file content (`Content-Type: application/octet-stream`)

**Max file size: 150 MiB.** For larger files, use upload sessions (`upload_session/start`, `upload_session/append`, `upload_session/finish`).

**WriteMode values:**
- `"add"` -- Never overwrite; fail if file exists (unless autorename)
- `"overwrite"` -- Always overwrite
- `{"update": "<rev>"}` -- Overwrite only if rev matches (optimistic locking)

**Response body:** FileMetadata (same fields as download result)

**Errors (409):** `path` (UploadWriteFailed), `payload_too_large`, `content_hash_mismatch`

---

### 4. Get Metadata (stat)

**`POST https://api.dropboxapi.com/2/files/get_metadata`** -- RPC

```bash
curl -X POST https://api.dropboxapi.com/2/files/get_metadata \
  --header "Authorization: Bearer <TOKEN>" \
  --header "Content-Type: application/json" \
  --data '{"path": "/Documents/file.txt", "include_deleted": false}'
```

**Request body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | String | Yes | -- | Path, id, or rev |
| `include_deleted` | Boolean | No | false | Return DeletedMetadata for deleted items |
| `include_has_explicit_shared_members` | Boolean | No | false | -- |

**Response body:** Metadata (polymorphic via `.tag`):

- `.tag: "file"` -- FileMetadata: `name`, `id`, `path_lower`, `path_display`, `rev`, `size`, `client_modified`, `server_modified`, `content_hash`, `is_downloadable`
- `.tag: "folder"` -- FolderMetadata: `name`, `id`, `path_lower`, `path_display`
- `.tag: "deleted"` -- DeletedMetadata: `name`, `path_lower`, `path_display` (only if `include_deleted: true`)

**Errors (409):** `path` (LookupError) -- returns `not_found` if path doesn't exist

**Note:** Metadata for the root folder is unsupported.

---

### 5. Create Folder (mkdir)

**`POST https://api.dropboxapi.com/2/files/create_folder_v2`** -- RPC

```bash
curl -X POST https://api.dropboxapi.com/2/files/create_folder_v2 \
  --header "Authorization: Bearer <TOKEN>" \
  --header "Content-Type: application/json" \
  --data '{"path": "/Documents/new_folder", "autorename": false}'
```

**Request body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | String | Yes | -- | Path to create |
| `autorename` | Boolean | No | false | Auto-rename on conflict |

**Response body:**

```json
{
  "metadata": {
    "name": "new_folder",
    "id": "id:a4ayc_80_OEAAAAAAAAAXz",
    "path_lower": "/documents/new_folder",
    "path_display": "/Documents/new_folder"
  }
}
```

**Errors (409):** `path` (WriteError)

---

### 6. Delete (rm)

**`POST https://api.dropboxapi.com/2/files/delete_v2`** -- RPC

```bash
curl -X POST https://api.dropboxapi.com/2/files/delete_v2 \
  --header "Authorization: Bearer <TOKEN>" \
  --header "Content-Type: application/json" \
  --data '{"path": "/Documents/file.txt"}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | String | Yes | Path to delete |
| `parent_rev` | String | No | Only delete if rev matches (files only) |

Deletes file or folder (recursively). Moves to trash, not permanent delete.

**Response body:**

```json
{
  "metadata": { ".tag": "file", "name": "...", "id": "...", ... }
}
```

**Errors (409):** `path_lookup` (LookupError), `path_write` (WriteError), `too_many_write_operations`, `too_many_files`

---

### 7. Copy (cp)

**`POST https://api.dropboxapi.com/2/files/copy_v2`** -- RPC

```bash
curl -X POST https://api.dropboxapi.com/2/files/copy_v2 \
  --header "Authorization: Bearer <TOKEN>" \
  --header "Content-Type: application/json" \
  --data '{"from_path": "/Documents/file.txt", "to_path": "/Backup/file.txt", "autorename": false}'
```

**Request body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `from_path` | String | Yes | -- | Source path or id |
| `to_path` | String | Yes | -- | Destination path or id |
| `autorename` | Boolean | No | false | Auto-rename on conflict |
| `allow_ownership_transfer` | Boolean | No | false | Allow ownership change (moves only) |

**Response body:**

```json
{
  "metadata": { ".tag": "file", "name": "...", "id": "...", ... }
}
```

**Errors (409):** `RelocationError` -- `from_lookup`, `from_write`, `to`, `cant_copy_shared_folder`, `too_many_files`, `duplicated_or_nested_paths`, `insufficient_quota`, `internal_error`

---

### 8. Move (mv)

**`POST https://api.dropboxapi.com/2/files/move_v2`** -- RPC

```bash
curl -X POST https://api.dropboxapi.com/2/files/move_v2 \
  --header "Authorization: Bearer <TOKEN>" \
  --header "Content-Type: application/json" \
  --data '{"from_path": "/Documents/file.txt", "to_path": "/Archive/file.txt", "autorename": false}'
```

**Request & Response:** Same as copy_v2 (uses same `RelocationArg` / `RelocationResult`).

**Additional errors:** `cant_move_folder_into_itself`, `cant_move_shared_folder`

**Note:** Case-only renaming is not supported.

---

### 9. Check If Path Exists

There is no dedicated "exists" endpoint. Use `get_metadata` and check for errors:

```bash
curl -X POST https://api.dropboxapi.com/2/files/get_metadata \
  --header "Authorization: Bearer <TOKEN>" \
  --header "Content-Type: application/json" \
  --data '{"path": "/Documents/maybe.txt"}'
```

- **200** -- path exists (response contains metadata)
- **409** with `error.path.".tag" == "not_found"` -- path does not exist

---

## Quirks & Implementation Notes

1. **Two different hosts:** RPC endpoints use `api.dropboxapi.com`; content endpoints use `content.dropboxapi.com`. Getting this wrong returns confusing errors.

2. **Dropbox-API-Arg header JSON encoding:** Must be ASCII-safe. Non-ASCII characters must be escaped as `\uXXXX`. The header value must be valid JSON.

3. **`.tag` field:** Identifies subtypes in polymorphic responses. FileMetadata has `.tag: "file"`, FolderMetadata has `.tag: "folder"`.

4. **WriteMode shorthand:** For void union members, you can pass just the string: `"mode": "add"` instead of `"mode": {".tag": "add"}`.

5. **v2 suffix endpoints:** `create_folder_v2`, `delete_v2`, `copy_v2`, `move_v2` wrap their result in a `{ "metadata": ... }` object. The older versions (without `_v2`) return metadata directly. Prefer the v2 versions.

6. **Content hash:** SHA-256 based, computed in 4 MiB blocks. See Dropbox content hash docs for algorithm.

7. **Rate limiting on list_folder:** Simultaneous `list_folder` or `list_folder/continue` calls with the same parameters for the same user may trigger `RateLimitError`.

8. **Upload sessions for large files:** Files > 150 MiB must use the upload session flow: `upload_session/start` -> `upload_session/append` (repeat) -> `upload_session/finish`.

9. **Paths are case-insensitive:** `/A/B.txt` and `/a/b.txt` refer to the same file. Use `path_display` for display, `path_lower` for comparisons.

10. **Cursor invalidation:** If a cursor expires, `list_folder/continue` returns a `reset` error. You must restart with `list_folder`.

---

## Quick Reference: Headers by Endpoint Type

### RPC Endpoints (list_folder, get_metadata, create_folder, delete, copy, move)
```
Authorization: Bearer <TOKEN>
Content-Type: application/json
```
Body: JSON arguments

### Content-upload (upload)
```
Authorization: Bearer <TOKEN>
Content-Type: application/octet-stream
Dropbox-API-Arg: <JSON args>
```
Body: Raw file bytes

### Content-download (download)
```
Authorization: Bearer <TOKEN>
Dropbox-API-Arg: <JSON args>
```
Response body: Raw file bytes
Response header `Dropbox-API-Result`: JSON metadata
