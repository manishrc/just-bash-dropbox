import { describe, expect, it } from "vitest";
import { DropboxApiError } from "./dropbox-client.js";
import { FsError, mapDropboxError } from "./errors.js";

describe("mapDropboxError", () => {
  it("maps path/not_found to ENOENT", () => {
    const err = new DropboxApiError(409, "path/not_found/", {});
    const result = mapDropboxError(err, "/missing.txt");

    expect(result).toBeInstanceOf(FsError);
    expect(result.code).toBe("ENOENT");
    expect(result.path).toBe("/missing.txt");
  });

  it("maps path_lookup/not_found to ENOENT", () => {
    const err = new DropboxApiError(409, "path_lookup/not_found/", {});
    const result = mapDropboxError(err, "/gone");

    expect(result.code).toBe("ENOENT");
  });

  it("maps from_lookup/not_found to ENOENT", () => {
    const err = new DropboxApiError(409, "from_lookup/not_found/", {});
    const result = mapDropboxError(err, "/source");

    expect(result.code).toBe("ENOENT");
  });

  it("maps path/conflict to EEXIST", () => {
    const err = new DropboxApiError(409, "path/conflict/folder/", {});
    const result = mapDropboxError(err, "/existing");

    expect(result.code).toBe("EEXIST");
  });

  it("maps to/conflict to EEXIST", () => {
    const err = new DropboxApiError(409, "to/conflict/file/", {});
    const result = mapDropboxError(err, "/dest");

    expect(result.code).toBe("EEXIST");
  });

  it("maps path/not_file to EISDIR", () => {
    const err = new DropboxApiError(409, "path/not_file/", {});
    const result = mapDropboxError(err, "/dir");

    expect(result.code).toBe("EISDIR");
  });

  it("maps path/not_folder to ENOTDIR", () => {
    const err = new DropboxApiError(409, "path/not_folder/", {});
    const result = mapDropboxError(err, "/file.txt");

    expect(result.code).toBe("ENOTDIR");
  });

  it("maps insufficient_quota to ENOSPC", () => {
    const err = new DropboxApiError(409, "insufficient_quota/", {});
    const result = mapDropboxError(err, "/large-file");

    expect(result.code).toBe("ENOSPC");
  });

  it("maps unknown errors to EIO", () => {
    const err = new DropboxApiError(409, "some_weird_error/thing", {});
    const result = mapDropboxError(err, "/path");

    expect(result.code).toBe("EIO");
    expect(result.message).toContain("some_weird_error");
  });

  it("maps HTTP 401 to EACCES with auth hint", () => {
    const err = new DropboxApiError(401, "HTTP 401", {});
    const result = mapDropboxError(err, "/file");

    expect(result.code).toBe("EACCES");
    expect(result.message).toContain("expired");
  });

  it("maps HTTP 403 to EACCES", () => {
    const err = new DropboxApiError(403, "HTTP 403", {});
    const result = mapDropboxError(err, "/file");

    expect(result.code).toBe("EACCES");
  });

  it("maps HTTP 400 with root unsupported to ENOENT", () => {
    const err = new DropboxApiError(400, "HTTP 400", {});
    const result = mapDropboxError(err, "/");

    expect(result.code).toBe("EIO");
  });

  it("re-throws non-DropboxApiError errors", () => {
    const err = new TypeError("network failure");

    expect(() => mapDropboxError(err, "/path")).toThrow(TypeError);
  });
});

describe("FsError", () => {
  it("formats message with path", () => {
    const err = new FsError("ENOENT", "no such file", "/test");
    expect(err.message).toBe("ENOENT: no such file, '/test'");
    expect(err.code).toBe("ENOENT");
    expect(err.path).toBe("/test");
  });

  it("formats message without path", () => {
    const err = new FsError("ENOSYS", "not supported");
    expect(err.message).toBe("ENOSYS: not supported");
  });
});
