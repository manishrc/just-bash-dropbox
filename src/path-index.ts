/**
 * Maintains a synchronous index of all known filesystem paths.
 *
 * Temporary layer — will be deleted when just-bash supports async getAllPaths().
 * See: https://github.com/vercel-labs/just-bash/issues/181
 */
export class PathIndex {
  private paths = new Set<string>();

  /** Replace the entire index (e.g., from prefetchAllPaths). */
  load(paths: string[]): void {
    this.paths = new Set(paths);
  }

  /** Return all known paths, sorted for deterministic glob results. */
  getAllPaths(): string[] {
    return [...this.paths].sort();
  }

  /** Add a path and all its ancestor directories. */
  add(path: string): void {
    const parts = path.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      this.paths.add(`/${parts.slice(0, i).join("/")}`);
    }
  }

  /** Remove an exact path. */
  remove(path: string): void {
    this.paths.delete(path);
  }

  /** Remove a path and all its children. */
  removeTree(prefix: string): void {
    const withSlash = `${prefix}/`;
    for (const p of this.paths) {
      if (p === prefix || p.startsWith(withSlash)) {
        this.paths.delete(p);
      }
    }
  }

  /** Move a path (and children) from one location to another. */
  move(from: string, to: string): void {
    const fromSlash = `${from}/`;
    const toAdd: string[] = [];

    for (const p of this.paths) {
      if (p === from) {
        this.paths.delete(p);
        toAdd.push(to);
      } else if (p.startsWith(fromSlash)) {
        this.paths.delete(p);
        toAdd.push(to + p.slice(from.length));
      }
    }

    for (const p of toAdd) {
      this.add(p);
    }
  }
}
