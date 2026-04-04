import { DropboxApiError } from "./dropbox-client.js";

/**
 * Maps Dropbox API errors to filesystem-style errors.
 * Uses errno-like codes so bash commands produce natural error output.
 */
export class FsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly path?: string,
  ) {
    super(path ? `${code}: ${message}, '${path}'` : `${code}: ${message}`);
    this.name = "FsError";
  }
}

export function enoent(path: string): FsError {
  return new FsError("ENOENT", "no such file or directory", path);
}

export function enotdir(path: string): FsError {
  return new FsError("ENOTDIR", "not a directory", path);
}

export function eisdir(path: string): FsError {
  return new FsError("EISDIR", "is a directory", path);
}

export function eexist(path: string): FsError {
  return new FsError("EEXIST", "file already exists", path);
}

export function enosys(operation: string): FsError {
  return new FsError("ENOSYS", `${operation} is not supported on Dropbox`);
}

export function enospc(path: string): FsError {
  return new FsError("ENOSPC", "no space left (Dropbox quota exceeded)", path);
}

/**
 * Maps a DropboxApiError to a filesystem error.
 * Uses error_summary prefix matching as recommended by Dropbox docs.
 */
export function mapDropboxError(err: unknown, path: string): FsError {
  if (!(err instanceof DropboxApiError)) {
    throw err;
  }

  const summary = err.errorSummary;

  if (
    summary.startsWith("path/not_found") ||
    summary.startsWith("path_lookup/not_found")
  ) {
    return enoent(path);
  }
  if (
    summary.startsWith("path/conflict") ||
    summary.startsWith("to/conflict")
  ) {
    return eexist(path);
  }
  if (summary.startsWith("path/not_file")) {
    return eisdir(path);
  }
  if (summary.startsWith("path/not_folder")) {
    return enotdir(path);
  }
  if (
    summary.startsWith("path/insufficient_space") ||
    summary.startsWith("insufficient_quota")
  ) {
    return enospc(path);
  }
  if (summary.startsWith("from_lookup/not_found")) {
    return enoent(path);
  }

  // HTTP status-based mapping
  if (err.status === 401) {
    return new FsError(
      "EACCES",
      "access token expired or invalid — refresh your token",
      path,
    );
  }
  if (err.status === 403) {
    return new FsError("EACCES", "access denied — check app permissions", path);
  }

  // For unmapped errors, wrap as-is with the path context
  return new FsError("EIO", summary, path);
}
