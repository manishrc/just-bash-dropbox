import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DropboxClient } from "./dropbox-client.js";

// Mock fetch at the global level — this is our system boundary
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DropboxClient", () => {
  describe("rpc", () => {
    it("sends a JSON RPC request with auth header", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ entries: [], cursor: "", has_more: false }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

      const client = new DropboxClient({ accessToken: "test-token" });
      const result = await client.rpc("/2/files/list_folder", { path: "" });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.dropboxapi.com/2/files/list_folder");
      expect(options.method).toBe("POST");
      expect(options.headers.Authorization).toBe("Bearer test-token");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(options.body)).toEqual({ path: "" });
      expect(result).toEqual({ entries: [], cursor: "", has_more: false });
    });

    it("uses getAccessToken when provided", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 }),
      );

      const getToken = vi.fn().mockResolvedValue("dynamic-token");
      const client = new DropboxClient({ getAccessToken: getToken });
      await client.rpc("/2/files/get_metadata", { path: "/test" });

      expect(getToken).toHaveBeenCalledOnce();
      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers.Authorization).toBe("Bearer dynamic-token");
    });

    it("throws DropboxApiError on 409 response", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error_summary: "path/not_found/",
            error: { ".tag": "path", path: { ".tag": "not_found" } },
          }),
          { status: 409 },
        ),
      );

      const client = new DropboxClient({ accessToken: "test-token" });
      await expect(
        client.rpc("/2/files/get_metadata", { path: "/missing" }),
      ).rejects.toThrow("path/not_found/");
    });
  });

  describe("contentUpload", () => {
    it("sends file content with args in header", async () => {
      const metadata = {
        ".tag": "file",
        name: "test.txt",
        id: "id:abc",
        size: 5,
      };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(metadata), { status: 200 }),
      );

      const client = new DropboxClient({ accessToken: "test-token" });
      const content = new TextEncoder().encode("hello");
      const result = await client.contentUpload(
        "/2/files/upload",
        {
          path: "/test.txt",
          mode: "overwrite",
        },
        content,
      );

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://content.dropboxapi.com/2/files/upload");
      expect(options.headers["Content-Type"]).toBe("application/octet-stream");
      expect(JSON.parse(options.headers["Dropbox-API-Arg"])).toEqual({
        path: "/test.txt",
        mode: "overwrite",
      });
      expect(options.body).toBe(content);
      expect(result).toEqual(metadata);
    });
  });

  describe("contentDownload", () => {
    it("returns file content and metadata", async () => {
      const metadata = {
        ".tag": "file",
        name: "test.txt",
        id: "id:abc",
        size: 5,
      };
      const body = new TextEncoder().encode("hello");

      mockFetch.mockResolvedValueOnce(
        new Response(body, {
          status: 200,
          headers: {
            "Dropbox-API-Result": JSON.stringify(metadata),
          },
        }),
      );

      const client = new DropboxClient({ accessToken: "test-token" });
      const result = await client.contentDownload("/2/files/download", {
        path: "/test.txt",
      });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://content.dropboxapi.com/2/files/download");
      expect(JSON.parse(options.headers["Dropbox-API-Arg"])).toEqual({
        path: "/test.txt",
      });
      expect(result.metadata).toEqual(metadata);
      expect(new TextDecoder().decode(result.content)).toBe("hello");
    });
  });

  describe("retry on 429", () => {
    it("retries on rate limit with backoff", async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: { ".tag": "too_many_requests", retry_after: 0 },
            }),
            { status: 429, headers: { "Retry-After": "0" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ result: "ok" }), { status: 200 }),
        );

      const client = new DropboxClient({ accessToken: "test-token" });
      const result = await client.rpc("/2/files/get_metadata", {
        path: "/test",
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ result: "ok" });
    });

    it("throws after exhausting all retries", async () => {
      // Mock 4 consecutive 429 responses (MAX_RETRIES + 1)
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: { ".tag": "too_many_requests", retry_after: 0 },
            }),
            { status: 429, headers: { "Retry-After": "0" } },
          ),
        );
      }

      const client = new DropboxClient({ accessToken: "test-token" });
      await expect(
        client.rpc("/2/files/get_metadata", { path: "/test" }),
      ).rejects.toThrow("Rate limited");

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe("validation", () => {
    it("requires either accessToken or getAccessToken", () => {
      expect(() => new DropboxClient({})).toThrow();
    });

    it("rejects both accessToken and getAccessToken", () => {
      expect(
        () =>
          new DropboxClient({
            accessToken: "token",
            getAccessToken: () => "token",
          }),
      ).toThrow();
    });
  });
});
