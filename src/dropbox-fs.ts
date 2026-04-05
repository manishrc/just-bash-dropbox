import type {
  CpOptions,
  FileContent,
  FsStat,
  MkdirOptions,
  RmOptions,
} from "just-bash";
import { DropboxApiError, DropboxClient } from "./dropbox-client.js";
import { eisdir, enosys, FsError, mapDropboxError } from "./errors.js";
import { resolvePath as resolvePathUtil, toDropboxPath } from "./paths.js";
import type {
  DropboxFsOptions,
  DropboxListFolderResult,
  DropboxMetadata,
} from "./types.js";

// Types not exported from just-bash's main entry but needed for IFileSystem
interface DirentEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

interface ReadFileOptions {
  encoding?: string | null;
}

interface WriteFileOptions {
  encoding?: string;
}

export class DropboxFs {
  private readonly client: DropboxClient;
  private readonly rootPath: string | undefined;
  private cachedPaths: string[] = [];

  constructor(options: DropboxFsOptions) {
    this.client = new DropboxClient({
      accessToken: options.accessToken,
      getAccessToken: options.getAccessToken,
    });
    this.rootPath = options.rootPath;
  }

  // ─── Read operations ────────────────────────────────

  async readdir(path: string): Promise<string[]> {
    const entries = await this.listFolder(path);
    return entries.map((e) => e.name);
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const entries = await this.listFolder(path);
    return entries.map((e) => ({
      name: e.name,
      isFile: e[".tag"] === "file",
      isDirectory: e[".tag"] === "folder",
      isSymbolicLink: false,
    }));
  }

  async readFile(
    path: string,
    _options?: ReadFileOptions | string,
  ): Promise<string> {
    try {
      const dbxPath = this.toPath(path);
      const result = await this.client.contentDownload("/2/files/download", {
        path: dbxPath,
      });
      return new TextDecoder().decode(result.content);
    } catch (err) {
      throw mapDropboxError(err, path);
    }
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    try {
      const dbxPath = this.toPath(path);
      const result = await this.client.contentDownload("/2/files/download", {
        path: dbxPath,
      });
      return result.content;
    } catch (err) {
      throw mapDropboxError(err, path);
    }
  }

  async stat(path: string): Promise<FsStat> {
    const dbxPath = this.toPath(path);

    // Dropbox API does not support get_metadata on root folder
    if (dbxPath === "" || dbxPath === "/") {
      return {
        isFile: false,
        isDirectory: true,
        isSymbolicLink: false,
        mode: 0o755,
        size: 0,
        mtime: new Date(0),
      };
    }

    try {
      const metadata = await this.client.rpc<DropboxMetadata>(
        "/2/files/get_metadata",
        { path: dbxPath },
      );
      return metadataToStat(metadata);
    } catch (err) {
      throw mapDropboxError(err, path);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }

  // ─── Write operations ───────────────────────────────

  async writeFile(
    path: string,
    content: FileContent,
    _options?: WriteFileOptions | string,
  ): Promise<void> {
    const dbxPath = this.toPath(path);
    const bytes =
      typeof content === "string" ? new TextEncoder().encode(content) : content;

    try {
      await this.client.contentUpload(
        "/2/files/upload",
        { path: dbxPath, mode: "overwrite", autorename: false, mute: true },
        bytes,
      );
    } catch (err) {
      throw mapDropboxError(err, path);
    }
  }

  async appendFile(
    path: string,
    content: FileContent,
    _options?: WriteFileOptions | string,
  ): Promise<void> {
    const dbxPath = this.toPath(path);

    // Download existing file with metadata (to get rev for optimistic locking)
    let existing: Uint8Array;
    let rev: string | undefined;
    try {
      const result = await this.client.contentDownload("/2/files/download", {
        path: dbxPath,
      });
      existing = result.content;
      rev = (result.metadata as Record<string, unknown>).rev as
        | string
        | undefined;
    } catch (err) {
      if (
        err instanceof DropboxApiError &&
        err.errorSummary.startsWith("path/not_found")
      ) {
        // File doesn't exist — create it
        await this.writeFile(path, content);
        return;
      }
      throw mapDropboxError(err, path);
    }

    const appendBytes =
      typeof content === "string" ? new TextEncoder().encode(content) : content;

    const combined = new Uint8Array(existing.length + appendBytes.length);
    combined.set(existing, 0);
    combined.set(appendBytes, existing.length);

    // Upload with rev-based optimistic locking to detect concurrent writes
    const mode = rev
      ? { ".tag": "update", update: rev }
      : ("overwrite" as const);

    try {
      await this.client.contentUpload(
        "/2/files/upload",
        { path: dbxPath, mode, autorename: false, mute: true },
        combined,
      );
    } catch (err) {
      throw mapDropboxError(err, path);
    }
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const dbxPath = this.toPath(path);

    if (options?.recursive) {
      await this.mkdirRecursive(dbxPath, path);
      return;
    }

    try {
      await this.client.rpc("/2/files/create_folder_v2", { path: dbxPath });
    } catch (err) {
      throw mapDropboxError(err, path);
    }
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    const dbxPath = this.toPath(path);

    // POSIX: rm without -r on a directory should fail
    if (!options?.recursive) {
      try {
        const s = await this.stat(path);
        if (s.isDirectory) {
          throw eisdir(path);
        }
      } catch (err) {
        if (err instanceof FsError && err.code === "EISDIR") throw err;
        // If stat fails (e.g. ENOENT), let delete_v2 handle it below
      }
    }

    try {
      await this.client.rpc("/2/files/delete_v2", { path: dbxPath });
    } catch (err) {
      if (
        options?.force &&
        err instanceof DropboxApiError &&
        err.errorSummary.startsWith("path_lookup/not_found")
      ) {
        return;
      }
      throw mapDropboxError(err, path);
    }
  }

  async cp(src: string, dest: string, _options?: CpOptions): Promise<void> {
    const fromPath = this.toPath(src);
    const toPath = this.toPath(dest);

    try {
      await this.client.rpc("/2/files/copy_v2", {
        from_path: fromPath,
        to_path: toPath,
      });
    } catch (err) {
      throw mapDropboxError(err, src);
    }
  }

  async mv(src: string, dest: string): Promise<void> {
    const fromPath = this.toPath(src);
    const toPath = this.toPath(dest);

    try {
      await this.client.rpc("/2/files/move_v2", {
        from_path: fromPath,
        to_path: toPath,
      });
    } catch (err) {
      throw mapDropboxError(err, src);
    }
  }

  // ─── Path operations ───────────────────────────────

  resolvePath(base: string, target: string): string {
    return resolvePathUtil(base, target);
  }

  getAllPaths(): string[] {
    return this.cachedPaths;
  }

  /**
   * Prefetch all file and folder paths via recursive list_folder.
   * Call this before operations that need getAllPaths() (like glob).
   * Results are cached until the next call to prefetchAllPaths().
   */
  async prefetchAllPaths(): Promise<string[]> {
    const dbxPath = this.toPath("/");
    const allPaths: string[] = [];

    try {
      let result = await this.client.rpc<DropboxListFolderResult>(
        "/2/files/list_folder",
        { path: dbxPath, recursive: true, include_deleted: false },
      );

      for (const entry of result.entries) {
        allPaths.push(entry.path_display);
      }

      while (result.has_more) {
        result = await this.client.rpc<DropboxListFolderResult>(
          "/2/files/list_folder/continue",
          { cursor: result.cursor },
        );
        for (const entry of result.entries) {
          allPaths.push(entry.path_display);
        }
      }
    } catch (err) {
      throw mapDropboxError(err, "/");
    }

    this.cachedPaths = allPaths;
    return allPaths;
  }

  // ─── Unsupported operations ─────────────────────────

  async chmod(_path: string, _mode: number): Promise<void> {
    throw enosys("chmod");
  }

  async symlink(_target: string, _linkPath: string): Promise<void> {
    throw enosys("symlink");
  }

  async link(_existingPath: string, _newPath: string): Promise<void> {
    throw enosys("link");
  }

  async readlink(_path: string): Promise<string> {
    throw enosys("readlink");
  }

  async lstat(path: string): Promise<FsStat> {
    // Dropbox has no symlinks — lstat is identical to stat
    return this.stat(path);
  }

  async realpath(path: string): Promise<string> {
    const dbxPath = this.toPath(path);
    // Root has no metadata endpoint
    if (dbxPath === "" || dbxPath === "/") {
      return "/";
    }
    try {
      const metadata = await this.client.rpc<DropboxMetadata>(
        "/2/files/get_metadata",
        { path: dbxPath },
      );
      // Return canonical casing from Dropbox
      return metadata.path_display;
    } catch (err) {
      throw mapDropboxError(err, path);
    }
  }

  async utimes(_path: string, _atime: Date, _mtime: Date): Promise<void> {
    throw enosys("utimes");
  }

  // ─── Private helpers ───────────────────────────────

  private toPath(path: string): string {
    return toDropboxPath(path, this.rootPath);
  }

  private async listFolder(path: string): Promise<DropboxMetadata[]> {
    const dbxPath = this.toPath(path);
    const allEntries: DropboxMetadata[] = [];

    try {
      let result = await this.client.rpc<DropboxListFolderResult>(
        "/2/files/list_folder",
        { path: dbxPath, include_deleted: false },
      );
      allEntries.push(...result.entries);

      while (result.has_more) {
        result = await this.client.rpc<DropboxListFolderResult>(
          "/2/files/list_folder/continue",
          { cursor: result.cursor },
        );
        allEntries.push(...result.entries);
      }
    } catch (err) {
      throw mapDropboxError(err, path);
    }

    return allEntries;
  }

  private async mkdirRecursive(
    dbxPath: string,
    originalPath: string,
  ): Promise<void> {
    // Build list of paths to create from root to leaf
    const parts = dbxPath.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      const segment = `/${parts.slice(0, i).join("/")}`;
      try {
        await this.client.rpc("/2/files/create_folder_v2", { path: segment });
      } catch (err) {
        // Ignore "already exists" errors during recursive creation
        if (
          err instanceof DropboxApiError &&
          err.errorSummary.startsWith("path/conflict")
        ) {
          continue;
        }
        throw mapDropboxError(err, originalPath);
      }
    }
  }
}

function metadataToStat(metadata: DropboxMetadata): FsStat {
  switch (metadata[".tag"]) {
    case "file":
      return {
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
        mode: 0o644,
        size: metadata.size,
        mtime: new Date(metadata.server_modified),
      };
    case "folder":
      return {
        isFile: false,
        isDirectory: true,
        isSymbolicLink: false,
        mode: 0o755,
        size: 0,
        mtime: new Date(0),
      };
    case "deleted":
      throw new FsError("ENOENT", "no such file or directory (deleted)");
  }
}
