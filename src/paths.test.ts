import { describe, expect, it } from "vitest";
import { resolvePath, toDropboxPath } from "./paths.js";

describe("toDropboxPath", () => {
  it("converts root / to empty string", () => {
    expect(toDropboxPath("/")).toBe("");
  });

  it("preserves normal paths", () => {
    expect(toDropboxPath("/Documents/file.txt")).toBe("/Documents/file.txt");
  });

  it("strips trailing slashes", () => {
    expect(toDropboxPath("/Documents/")).toBe("/Documents");
  });

  it("collapses double slashes", () => {
    expect(toDropboxPath("//Documents//photos//")).toBe("/Documents/photos");
  });

  it("ensures leading slash for bare paths", () => {
    expect(toDropboxPath("file.txt")).toBe("/file.txt");
  });

  describe("with rootPath", () => {
    it("prefixes rootPath to normal paths", () => {
      expect(toDropboxPath("/src/index.ts", "/work/project")).toBe(
        "/work/project/src/index.ts",
      );
    });

    it("maps root to rootPath itself", () => {
      expect(toDropboxPath("/", "/work/project")).toBe("/work/project");
    });

    it("strips trailing slash from rootPath", () => {
      expect(toDropboxPath("/src", "/work/")).toBe("/work/src");
    });

    it("handles rootPath with multiple trailing slashes", () => {
      expect(toDropboxPath("/file.txt", "/work///")).toBe("/work/file.txt");
    });
  });
});

describe("resolvePath", () => {
  it("returns absolute target unchanged", () => {
    expect(resolvePath("/base", "/absolute/path")).toBe("/absolute/path");
  });

  it("joins relative target with base", () => {
    expect(resolvePath("/base/dir", "file.txt")).toBe("/base/dir/file.txt");
  });

  it("resolves .. segments", () => {
    expect(resolvePath("/a/b/c", "../file.txt")).toBe("/a/b/file.txt");
  });

  it("resolves . segments", () => {
    expect(resolvePath("/a", "./b")).toBe("/a/b");
  });

  it("resolves multiple .. segments", () => {
    expect(resolvePath("/a/b/c", "../../file.txt")).toBe("/a/file.txt");
  });

  it("does not go above root", () => {
    expect(resolvePath("/a", "../../..")).toBe("/");
  });

  it("handles base with trailing slash", () => {
    expect(resolvePath("/base/", "file.txt")).toBe("/base/file.txt");
  });
});
