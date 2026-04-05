import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DropboxFs } from "./dropbox-fs.js";

// Mock fetch — the system boundary
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockRpcResponse(body: unknown) {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function mockDownloadResponse(
  content: string,
  metadata: Record<string, unknown>,
) {
  mockFetch.mockResolvedValueOnce(
    new Response(new TextEncoder().encode(content), {
      status: 200,
      headers: { "Dropbox-API-Result": JSON.stringify(metadata) },
    }),
  );
}

function mock409(errorSummary: string) {
  mockFetch.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        error_summary: errorSummary,
        error: { ".tag": "path" },
      }),
      { status: 409 },
    ),
  );
}

function createFs(opts?: { rootPath?: string }) {
  return new DropboxFs({ accessToken: "test-token", ...opts });
}

function lastFetchBody(): Record<string, unknown> {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return JSON.parse(call[1].body);
}

function lastFetchUrl(): string {
  return mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
}

// ─── readdir ─────────────────────────────────────────────

describe("readdir", () => {
  it("lists files and folders in a directory", async () => {
    mockRpcResponse({
      entries: [
        { ".tag": "file", name: "report.csv", id: "id:1" },
        { ".tag": "folder", name: "photos", id: "id:2" },
      ],
      cursor: "cursor1",
      has_more: false,
    });

    const fs = createFs();
    const entries = await fs.readdir("/Documents");

    expect(entries).toEqual(["report.csv", "photos"]);
    expect(lastFetchBody().path).toBe("/Documents");
  });

  it("lists root directory using empty string path", async () => {
    mockRpcResponse({ entries: [], cursor: "", has_more: false });

    const fs = createFs();
    await fs.readdir("/");

    expect(lastFetchBody().path).toBe("");
  });

  it("paginates when has_more is true", async () => {
    mockRpcResponse({
      entries: [{ ".tag": "file", name: "a.txt", id: "id:1" }],
      cursor: "cursor-page1",
      has_more: true,
    });
    mockRpcResponse({
      entries: [{ ".tag": "file", name: "b.txt", id: "id:2" }],
      cursor: "cursor-page2",
      has_more: false,
    });

    const fs = createFs();
    const entries = await fs.readdir("/");

    expect(entries).toEqual(["a.txt", "b.txt"]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Second call should be list_folder/continue
    expect(mockFetch.mock.calls[1][0]).toContain("list_folder/continue");
  });

  it("applies rootPath prefix", async () => {
    mockRpcResponse({ entries: [], cursor: "", has_more: false });

    const fs = createFs({ rootPath: "/work/project-x" });
    await fs.readdir("/src");

    expect(lastFetchBody().path).toBe("/work/project-x/src");
  });

  it("throws ENOENT when path not found", async () => {
    mock409("path/not_found/");

    const fs = createFs();
    await expect(fs.readdir("/missing")).rejects.toThrow("ENOENT");
  });
});

// ─── readdirWithFileTypes ────────────────────────────────

describe("readdirWithFileTypes", () => {
  it("returns DirentEntry objects with type info", async () => {
    mockRpcResponse({
      entries: [
        { ".tag": "file", name: "doc.txt", id: "id:1" },
        { ".tag": "folder", name: "images", id: "id:2" },
      ],
      cursor: "",
      has_more: false,
    });

    const fs = createFs();
    const entries = await fs.readdirWithFileTypes("/");

    expect(entries).toEqual([
      {
        name: "doc.txt",
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
      },
      {
        name: "images",
        isFile: false,
        isDirectory: true,
        isSymbolicLink: false,
      },
    ]);
  });
});

// ─── readFile ────────────────────────────────────────────

describe("readFile", () => {
  it("reads file content as utf-8 string", async () => {
    mockDownloadResponse("hello world", {
      ".tag": "file",
      name: "test.txt",
      size: 11,
    });

    const fs = createFs();
    const content = await fs.readFile("/test.txt");

    expect(content).toBe("hello world");
    expect(lastFetchUrl()).toContain("content.dropboxapi.com");
  });

  it("applies rootPath to download path", async () => {
    mockDownloadResponse("data", { ".tag": "file", name: "data.csv", size: 4 });

    const fs = createFs({ rootPath: "/project" });
    await fs.readFile("/data.csv");

    const apiArg = JSON.parse(
      mockFetch.mock.calls[0][1].headers["Dropbox-API-Arg"],
    );
    expect(apiArg.path).toBe("/project/data.csv");
  });

  it("throws ENOENT for missing file", async () => {
    mock409("path/not_found/");

    const fs = createFs();
    await expect(fs.readFile("/missing.txt")).rejects.toThrow("ENOENT");
  });
});

// ─── readFileBuffer ──────────────────────────────────────

describe("readFileBuffer", () => {
  it("reads file content as Uint8Array", async () => {
    const binary = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    mockFetch.mockResolvedValueOnce(
      new Response(binary, {
        status: 200,
        headers: {
          "Dropbox-API-Result": JSON.stringify({
            ".tag": "file",
            name: "img.jpg",
            size: 4,
          }),
        },
      }),
    );

    const fs = createFs();
    const result = await fs.readFileBuffer("/img.jpg");

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result[0]).toBe(0xff);
    expect(result.length).toBe(4);
  });
});

// ─── stat ────────────────────────────────────────────────

describe("stat", () => {
  it("returns stat for a file", async () => {
    mockRpcResponse({
      ".tag": "file",
      name: "report.csv",
      id: "id:abc",
      size: 1024,
      server_modified: "2025-01-15T10:30:00Z",
    });

    const fs = createFs();
    const s = await fs.stat("/report.csv");

    expect(s.isFile).toBe(true);
    expect(s.isDirectory).toBe(false);
    expect(s.isSymbolicLink).toBe(false);
    expect(s.size).toBe(1024);
    expect(s.mtime).toEqual(new Date("2025-01-15T10:30:00Z"));
    expect(s.mode).toBe(0o644);
  });

  it("returns stat for a folder", async () => {
    mockRpcResponse({
      ".tag": "folder",
      name: "Documents",
      id: "id:xyz",
    });

    const fs = createFs();
    const s = await fs.stat("/Documents");

    expect(s.isFile).toBe(false);
    expect(s.isDirectory).toBe(true);
    expect(s.size).toBe(0);
    expect(s.mode).toBe(0o755);
    expect(s.mtime).toEqual(new Date(0)); // deterministic, not Date.now()
  });

  it("returns synthetic stat for root path without API call", async () => {
    const fs = createFs();
    const s = await fs.stat("/");

    expect(s.isFile).toBe(false);
    expect(s.isDirectory).toBe(true);
    expect(s.mode).toBe(0o755);
    // No fetch call — root metadata is unsupported by Dropbox API
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls API for root when rootPath is set (rootPath is a real folder)", async () => {
    mockRpcResponse({ ".tag": "folder", name: "work", id: "id:1" });

    const fs = createFs({ rootPath: "/work" });
    const s = await fs.stat("/");

    expect(s.isDirectory).toBe(true);
    expect(lastFetchBody().path).toBe("/work");
  });

  it("throws ENOENT for missing path", async () => {
    mock409("path/not_found/");

    const fs = createFs();
    await expect(fs.stat("/nope")).rejects.toThrow("ENOENT");
  });

  it("applies rootPath", async () => {
    mockRpcResponse({ ".tag": "folder", name: "src", id: "id:1" });

    const fs = createFs({ rootPath: "/work" });
    await fs.stat("/src");

    expect(lastFetchBody().path).toBe("/work/src");
  });
});

// ─── exists ──────────────────────────────────────────────

describe("exists", () => {
  it("returns true when path exists", async () => {
    mockRpcResponse({ ".tag": "file", name: "test.txt", id: "id:1" });

    const fs = createFs();
    expect(await fs.exists("/test.txt")).toBe(true);
  });

  it("returns false when path does not exist", async () => {
    mock409("path/not_found/");

    const fs = createFs();
    expect(await fs.exists("/missing")).toBe(false);
  });
});

// ─── writeFile ───────────────────────────────────────────

describe("writeFile", () => {
  it("uploads string content", async () => {
    mockRpcResponse({ ".tag": "file", name: "test.txt", id: "id:1", size: 5 });

    const fs = createFs();
    await fs.writeFile("/test.txt", "hello");

    expect(lastFetchUrl()).toContain("content.dropboxapi.com/2/files/upload");
    const apiArg = JSON.parse(
      mockFetch.mock.calls[0][1].headers["Dropbox-API-Arg"],
    );
    expect(apiArg.path).toBe("/test.txt");
    expect(apiArg.mode).toBe("overwrite");
  });

  it("uploads Uint8Array content", async () => {
    mockRpcResponse({ ".tag": "file", name: "img.png", id: "id:1", size: 4 });

    const fs = createFs();
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await fs.writeFile("/img.png", data);

    const body = mockFetch.mock.calls[0][1].body;
    expect(body).toBeInstanceOf(Uint8Array);
  });

  it("applies rootPath", async () => {
    mockRpcResponse({ ".tag": "file", name: "test.txt", id: "id:1", size: 5 });

    const fs = createFs({ rootPath: "/project" });
    await fs.writeFile("/test.txt", "hello");

    const apiArg = JSON.parse(
      mockFetch.mock.calls[0][1].headers["Dropbox-API-Arg"],
    );
    expect(apiArg.path).toBe("/project/test.txt");
  });
});

// ─── appendFile ──────────────────────────────────────────

describe("appendFile", () => {
  it("downloads existing content, appends, and re-uploads with rev", async () => {
    // First: download existing file (includes rev in metadata)
    mockDownloadResponse("existing ", {
      ".tag": "file",
      name: "log.txt",
      size: 9,
      rev: "abc123",
    });
    // Second: upload combined content
    mockRpcResponse({ ".tag": "file", name: "log.txt", id: "id:1", size: 18 });

    const fs = createFs();
    await fs.appendFile("/log.txt", "new data");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Second call should be upload with rev-based mode
    const uploadApiArg = JSON.parse(
      mockFetch.mock.calls[1][1].headers["Dropbox-API-Arg"],
    );
    expect(uploadApiArg.mode).toEqual({ ".tag": "update", update: "abc123" });
  });

  it("creates file if it does not exist", async () => {
    // First: download fails with not_found
    mock409("path/not_found/");
    // Second: upload new content
    mockRpcResponse({ ".tag": "file", name: "new.txt", id: "id:1", size: 5 });

    const fs = createFs();
    await fs.appendFile("/new.txt", "hello");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ─── mkdir ───────────────────────────────────────────────

describe("mkdir", () => {
  it("creates a directory", async () => {
    mockRpcResponse({
      metadata: { ".tag": "folder", name: "new-dir", id: "id:1" },
    });

    const fs = createFs();
    await fs.mkdir("/new-dir");

    expect(lastFetchUrl()).toContain("/2/files/create_folder_v2");
    expect(lastFetchBody().path).toBe("/new-dir");
  });

  it("creates nested directories with recursive option", async () => {
    // Create parent (succeeds)
    mockRpcResponse({
      metadata: { ".tag": "folder", name: "parent", id: "id:1" },
    });
    // Create child (succeeds)
    mockRpcResponse({
      metadata: { ".tag": "folder", name: "child", id: "id:2" },
    });

    const fs = createFs();
    await fs.mkdir("/parent/child", { recursive: true });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("ignores conflicts during recursive mkdir", async () => {
    // Create parent — already exists (conflict)
    mock409("path/conflict/folder/");
    // Create child — succeeds
    mockRpcResponse({
      metadata: { ".tag": "folder", name: "child", id: "id:2" },
    });

    const fs = createFs();
    await fs.mkdir("/parent/child", { recursive: true });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws EEXIST when directory already exists (non-recursive)", async () => {
    mock409("path/conflict/folder/");

    const fs = createFs();
    await expect(fs.mkdir("/existing")).rejects.toThrow("EEXIST");
  });
});

// ─── rm ──────────────────────────────────────────────────

describe("rm", () => {
  it("deletes a file", async () => {
    // stat check (file, not directory)
    mockRpcResponse({
      ".tag": "file",
      name: "trash.txt",
      id: "id:1",
      size: 0,
      server_modified: "2025-01-01T00:00:00Z",
    });
    // delete call
    mockRpcResponse({
      metadata: { ".tag": "file", name: "trash.txt", id: "id:1" },
    });

    const fs = createFs();
    await fs.rm("/trash.txt");

    expect(lastFetchUrl()).toContain("/2/files/delete_v2");
  });

  it("throws EISDIR when deleting directory without recursive", async () => {
    // stat returns folder
    mockRpcResponse({
      ".tag": "folder",
      name: "my-dir",
      id: "id:1",
    });

    const fs = createFs();
    await expect(fs.rm("/my-dir")).rejects.toThrow("EISDIR");
  });

  it("deletes directory with recursive option", async () => {
    mockRpcResponse({
      metadata: { ".tag": "folder", name: "my-dir", id: "id:1" },
    });

    const fs = createFs();
    await fs.rm("/my-dir", { recursive: true });

    expect(lastFetchUrl()).toContain("/2/files/delete_v2");
  });

  it("throws ENOENT when file not found (without force)", async () => {
    // stat fails with not_found
    mock409("path/not_found/");
    // delete also fails
    mock409("path_lookup/not_found/");

    const fs = createFs();
    await expect(fs.rm("/missing.txt")).rejects.toThrow("ENOENT");
  });

  it("does not throw when file not found with force option", async () => {
    // stat fails (ENOENT falls through)
    mock409("path/not_found/");
    // delete also fails with not_found
    mock409("path_lookup/not_found/");

    const fs = createFs();
    await expect(
      fs.rm("/missing.txt", { force: true }),
    ).resolves.toBeUndefined();
  });
});

// ─── cp ──────────────────────────────────────────────────

describe("cp", () => {
  it("copies a file", async () => {
    mockRpcResponse({
      metadata: { ".tag": "file", name: "copy.txt", id: "id:2" },
    });

    const fs = createFs();
    await fs.cp("/src.txt", "/dest.txt");

    expect(lastFetchUrl()).toContain("/2/files/copy_v2");
    const body = lastFetchBody();
    expect(body.from_path).toBe("/src.txt");
    expect(body.to_path).toBe("/dest.txt");
  });

  it("applies rootPath to both paths", async () => {
    mockRpcResponse({
      metadata: { ".tag": "file", name: "copy.txt", id: "id:2" },
    });

    const fs = createFs({ rootPath: "/work" });
    await fs.cp("/a.txt", "/b.txt");

    const body = lastFetchBody();
    expect(body.from_path).toBe("/work/a.txt");
    expect(body.to_path).toBe("/work/b.txt");
  });
});

// ─── mv ──────────────────────────────────────────────────

describe("mv", () => {
  it("moves a file", async () => {
    mockRpcResponse({
      metadata: { ".tag": "file", name: "moved.txt", id: "id:1" },
    });

    const fs = createFs();
    await fs.mv("/old.txt", "/new.txt");

    expect(lastFetchUrl()).toContain("/2/files/move_v2");
    const body = lastFetchBody();
    expect(body.from_path).toBe("/old.txt");
    expect(body.to_path).toBe("/new.txt");
  });
});

// ─── resolvePath ─────────────────────────────────────────

describe("resolvePath", () => {
  it("resolves absolute path (ignores base)", () => {
    const fs = createFs();
    expect(fs.resolvePath("/base", "/absolute")).toBe("/absolute");
  });

  it("resolves relative path against base", () => {
    const fs = createFs();
    expect(fs.resolvePath("/base/dir", "file.txt")).toBe("/base/dir/file.txt");
  });

  it("handles .. in path", () => {
    const fs = createFs();
    expect(fs.resolvePath("/a/b/c", "../file.txt")).toBe("/a/b/file.txt");
  });

  it("handles . in path", () => {
    const fs = createFs();
    expect(fs.resolvePath("/a", "./b")).toBe("/a/b");
  });
});

// ─── unsupported operations ──────────────────────────────

describe("unsupported operations", () => {
  it("chmod throws ENOSYS", async () => {
    const fs = createFs();
    await expect(fs.chmod("/file", 0o644)).rejects.toThrow("ENOSYS");
  });

  it("symlink throws ENOSYS", async () => {
    const fs = createFs();
    await expect(fs.symlink("/target", "/link")).rejects.toThrow("ENOSYS");
  });

  it("link throws ENOSYS", async () => {
    const fs = createFs();
    await expect(fs.link("/existing", "/new")).rejects.toThrow("ENOSYS");
  });

  it("readlink throws ENOSYS", async () => {
    const fs = createFs();
    await expect(fs.readlink("/link")).rejects.toThrow("ENOSYS");
  });

  it("lstat delegates to stat (no symlinks on Dropbox)", async () => {
    mockRpcResponse({
      ".tag": "file",
      name: "file.txt",
      id: "id:1",
      size: 100,
      server_modified: "2025-01-01T00:00:00Z",
    });

    const fs = createFs();
    const s = await fs.lstat("/file.txt");

    expect(s.isFile).toBe(true);
    expect(s.size).toBe(100);
  });

  it("realpath verifies path exists and returns canonical casing", async () => {
    mockRpcResponse({
      ".tag": "file",
      name: "README.md",
      id: "id:1",
      path_display: "/Documents/README.md",
      path_lower: "/documents/readme.md",
      size: 100,
      server_modified: "2025-01-01T00:00:00Z",
    });

    const fs = createFs();
    const p = await fs.realpath("/documents/readme.md");

    expect(p).toBe("/Documents/README.md");
  });

  it("realpath throws ENOENT for missing path", async () => {
    mock409("path/not_found/");

    const fs = createFs();
    await expect(fs.realpath("/missing")).rejects.toThrow("ENOENT");
  });

  it("realpath returns / for root", async () => {
    const fs = createFs();
    const p = await fs.realpath("/");

    expect(p).toBe("/");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("utimes throws ENOSYS", async () => {
    const fs = createFs();
    await expect(fs.utimes("/file", new Date(), new Date())).rejects.toThrow(
      "ENOSYS",
    );
  });
});

// ─── getAllPaths ──────────────────────────────────────────

describe("getAllPaths", () => {
  it("returns empty array (sync method cannot do async API calls)", () => {
    const fs = createFs();
    expect(fs.getAllPaths()).toEqual([]);
  });

  it("returns cached paths after prefetch", async () => {
    mockRpcResponse({
      entries: [
        {
          ".tag": "file",
          name: "a.txt",
          id: "id:1",
          path_display: "/a.txt",
          path_lower: "/a.txt",
        },
        {
          ".tag": "folder",
          name: "docs",
          id: "id:2",
          path_display: "/docs",
          path_lower: "/docs",
        },
      ],
      cursor: "c1",
      has_more: true,
    });
    mockRpcResponse({
      entries: [
        {
          ".tag": "file",
          name: "b.md",
          id: "id:3",
          path_display: "/docs/b.md",
          path_lower: "/docs/b.md",
        },
      ],
      cursor: "c2",
      has_more: false,
    });

    const fs = createFs();
    await fs.prefetchAllPaths();

    const paths = fs.getAllPaths();
    expect(paths).toContain("/a.txt");
    expect(paths).toContain("/docs");
    expect(paths).toContain("/docs/b.md");
    expect(paths).toHaveLength(3);
  });
});

// ─── path edge cases ────────────────────────────────────

describe("path normalization", () => {
  it("handles trailing slashes", async () => {
    mockRpcResponse({ entries: [], cursor: "", has_more: false });

    const fs = createFs();
    await fs.readdir("/Documents/");

    expect(lastFetchBody().path).toBe("/Documents");
  });

  it("handles double slashes", async () => {
    mockRpcResponse({ entries: [], cursor: "", has_more: false });

    const fs = createFs();
    await fs.readdir("//Documents//photos//");

    expect(lastFetchBody().path).toBe("/Documents/photos");
  });

  it("rootPath at root maps correctly", async () => {
    mockRpcResponse({ entries: [], cursor: "", has_more: false });

    const fs = createFs({ rootPath: "/work" });
    await fs.readdir("/");

    expect(lastFetchBody().path).toBe("/work");
  });

  it("rootPath with trailing slash is normalized", async () => {
    mockRpcResponse({ entries: [], cursor: "", has_more: false });

    const fs = createFs({ rootPath: "/work/" });
    await fs.readdir("/src");

    expect(lastFetchBody().path).toBe("/work/src");
  });
});

// ─── mv with rootPath ───────────────────────────────────

describe("mv with rootPath", () => {
  it("applies rootPath to both src and dest", async () => {
    mockRpcResponse({
      metadata: { ".tag": "file", name: "moved.txt", id: "id:1" },
    });

    const fs = createFs({ rootPath: "/work" });
    await fs.mv("/a.txt", "/b.txt");

    const body = lastFetchBody();
    expect(body.from_path).toBe("/work/a.txt");
    expect(body.to_path).toBe("/work/b.txt");
  });
});

// ─── exists error propagation ────────────────────────────

describe("exists error propagation", () => {
  it("propagates non-ENOENT errors", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_access_token" }), {
        status: 401,
      }),
    );

    const fs = createFs();
    await expect(fs.exists("/test")).rejects.toThrow();
  });
});

// ─── appendFile with binary content ──────────────────────

describe("appendFile with binary", () => {
  it("appends Uint8Array content to existing file", async () => {
    mockDownloadResponse("hello", { ".tag": "file", name: "bin", size: 5 });
    mockRpcResponse({ ".tag": "file", name: "bin", id: "id:1", size: 9 });

    const fs = createFs();
    await fs.appendFile("/bin", new Uint8Array([0x20, 0x21, 0x22, 0x23]));

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
