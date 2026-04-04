/**
 * Path normalization for Dropbox API.
 *
 * Dropbox quirks:
 * - Root is "" (empty string), not "/"
 * - All other paths start with "/"
 * - Paths are case-insensitive but case-preserving
 */

/**
 * Normalize a path for Dropbox API consumption.
 * Removes trailing slashes, collapses doubles, handles root.
 */
export function toDropboxPath(path: string, rootPath?: string): string {
  // Normalize separators and collapse doubles
  let normalized = path.replace(/\/+/g, "/");

  // Remove trailing slash (unless root)
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  // Apply rootPath prefix
  if (rootPath) {
    const cleanRoot = rootPath.replace(/\/+$/, "");
    if (normalized === "/") {
      normalized = cleanRoot;
    } else {
      normalized = `${cleanRoot}${normalized}`;
    }
  }

  // Dropbox root is "" not "/"
  if (normalized === "/") {
    return "";
  }

  // Ensure path starts with /
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  return normalized;
}

/**
 * Resolve a relative path against a base path.
 * Pure function — no Dropbox API calls.
 */
export function resolvePath(base: string, target: string): string {
  // Absolute path — ignore base
  if (target.startsWith("/")) {
    return normalizePath(target);
  }

  // Relative path — join with base
  const combined = base.endsWith("/")
    ? `${base}${target}`
    : `${base}/${target}`;
  return normalizePath(combined);
}

/**
 * Normalize a path: resolve . and .., collapse separators.
 */
function normalizePath(path: string): string {
  const parts = path.split("/");
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  return `/${resolved.join("/")}`;
}
