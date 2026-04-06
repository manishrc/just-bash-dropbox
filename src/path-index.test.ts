import { describe, expect, it } from "vitest";
import { PathIndex } from "./path-index.js";

describe("PathIndex", () => {
  it("returns empty array when nothing has been added", () => {
    const idx = new PathIndex();
    expect(idx.getAllPaths()).toEqual([]);
  });

  // ─── load ───────────────────────────────────────────────

  it("load replaces all contents", () => {
    const idx = new PathIndex();
    idx.add("/old.txt");
    idx.load(["/a.txt", "/b.txt"]);

    const paths = idx.getAllPaths();
    expect(paths).toContain("/a.txt");
    expect(paths).toContain("/b.txt");
    expect(paths).not.toContain("/old.txt");
  });

  // ─── getAllPaths ────────────────────────────────────────

  it("getAllPaths returns sorted array", () => {
    const idx = new PathIndex();
    idx.load(["/z.txt", "/a.txt", "/m/b.txt"]);
    expect(idx.getAllPaths()).toEqual(["/a.txt", "/m/b.txt", "/z.txt"]);
  });

  // ─── add ───────────────────────────────────────────────

  it("add includes ancestor directories", () => {
    const idx = new PathIndex();
    idx.add("/a/b/c.txt");

    const paths = idx.getAllPaths();
    expect(paths).toContain("/a");
    expect(paths).toContain("/a/b");
    expect(paths).toContain("/a/b/c.txt");
  });

  it("add is idempotent", () => {
    const idx = new PathIndex();
    idx.add("/a/b.txt");
    idx.add("/a/b.txt");

    expect(idx.getAllPaths().filter((p) => p === "/a/b.txt")).toHaveLength(1);
  });

  it("add at root level has no ancestors", () => {
    const idx = new PathIndex();
    idx.add("/file.txt");
    expect(idx.getAllPaths()).toEqual(["/file.txt"]);
  });

  // ─── remove ────────────────────────────────────────────

  it("remove deletes exact path only", () => {
    const idx = new PathIndex();
    idx.load(["/a", "/a/b.txt", "/a/c.txt"]);
    idx.remove("/a/b.txt");

    const paths = idx.getAllPaths();
    expect(paths).not.toContain("/a/b.txt");
    expect(paths).toContain("/a");
    expect(paths).toContain("/a/c.txt");
  });

  it("remove on non-existent path is a no-op", () => {
    const idx = new PathIndex();
    idx.load(["/a.txt"]);
    idx.remove("/nope.txt");
    expect(idx.getAllPaths()).toEqual(["/a.txt"]);
  });

  // ─── removeTree ────────────────────────────────────────

  it("removeTree removes prefix and all children", () => {
    const idx = new PathIndex();
    idx.load([
      "/dir",
      "/dir/a.txt",
      "/dir/sub",
      "/dir/sub/b.txt",
      "/other.txt",
    ]);
    idx.removeTree("/dir");

    expect(idx.getAllPaths()).toEqual(["/other.txt"]);
  });

  it("removeTree does not remove partial prefix matches", () => {
    const idx = new PathIndex();
    idx.load(["/dir", "/dir/a.txt", "/directory/b.txt"]);
    idx.removeTree("/dir");

    expect(idx.getAllPaths()).toEqual(["/directory/b.txt"]);
  });

  it("removeTree on non-existent prefix is a no-op", () => {
    const idx = new PathIndex();
    idx.load(["/a.txt"]);
    idx.removeTree("/nope");
    expect(idx.getAllPaths()).toEqual(["/a.txt"]);
  });

  // ─── move ──────────────────────────────────────────────

  it("move relocates a single file", () => {
    const idx = new PathIndex();
    idx.load(["/a.txt"]);
    idx.move("/a.txt", "/b.txt");

    const paths = idx.getAllPaths();
    expect(paths).toContain("/b.txt");
    expect(paths).not.toContain("/a.txt");
  });

  it("move relocates an entire subtree", () => {
    const idx = new PathIndex();
    idx.load(["/old", "/old/a.txt", "/old/sub", "/old/sub/b.txt"]);
    idx.move("/old", "/new");

    const paths = idx.getAllPaths();
    expect(paths).toContain("/new");
    expect(paths).toContain("/new/a.txt");
    expect(paths).toContain("/new/sub");
    expect(paths).toContain("/new/sub/b.txt");
    expect(paths).not.toContain("/old");
    expect(paths).not.toContain("/old/a.txt");
  });

  it("move into deeper path adds ancestor directories", () => {
    const idx = new PathIndex();
    idx.load(["/a.txt"]);
    idx.move("/a.txt", "/deep/nested/b.txt");

    const paths = idx.getAllPaths();
    expect(paths).toContain("/deep");
    expect(paths).toContain("/deep/nested");
    expect(paths).toContain("/deep/nested/b.txt");
  });

  it("move does not affect partial prefix matches", () => {
    const idx = new PathIndex();
    idx.load(["/dir", "/dir/a.txt", "/directory/b.txt"]);
    idx.move("/dir", "/renamed");

    const paths = idx.getAllPaths();
    expect(paths).toContain("/renamed");
    expect(paths).toContain("/renamed/a.txt");
    expect(paths).toContain("/directory/b.txt");
    expect(paths).not.toContain("/dir");
  });
});
