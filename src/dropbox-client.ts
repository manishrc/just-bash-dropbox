import type { DropboxFsOptions } from "./types.js";

const RPC_HOST = "https://api.dropboxapi.com";
const CONTENT_HOST = "https://content.dropboxapi.com";
const MAX_RETRIES = 3;

export class DropboxApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorSummary: string,
    public readonly errorBody: unknown,
  ) {
    super(errorSummary);
    this.name = "DropboxApiError";
  }
}

export class DropboxClient {
  private readonly getToken: () => string | Promise<string>;

  constructor(
    options: Pick<DropboxFsOptions, "accessToken" | "getAccessToken">,
  ) {
    if (options.accessToken && options.getAccessToken) {
      throw new Error("Provide either accessToken or getAccessToken, not both");
    }
    if (!options.accessToken && !options.getAccessToken) {
      throw new Error("Provide either accessToken or getAccessToken");
    }

    this.getToken =
      options.getAccessToken ?? (() => options.accessToken as string);
  }

  /**
   * RPC-style request: JSON in body, JSON response.
   * Used for list_folder, get_metadata, create_folder, delete, copy, move.
   */
  async rpc<T>(endpoint: string, args: Record<string, unknown>): Promise<T> {
    return this.request(async (token) => {
      const response = await fetch(`${RPC_HOST}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      });
      return response;
    }) as Promise<T>;
  }

  /**
   * Content-upload: args in Dropbox-API-Arg header, file bytes in body.
   * Used for upload.
   */
  async contentUpload<T>(
    endpoint: string,
    args: Record<string, unknown>,
    content: Uint8Array,
  ): Promise<T> {
    return this.request(async (token) => {
      const response = await fetch(`${CONTENT_HOST}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify(args),
        },
        body: content as unknown as BodyInit,
      });
      return response;
    }) as Promise<T>;
  }

  /**
   * Content-download: args in Dropbox-API-Arg header, file bytes in response.
   * Used for download.
   */
  async contentDownload(
    endpoint: string,
    args: Record<string, unknown>,
  ): Promise<{ metadata: Record<string, unknown>; content: Uint8Array }> {
    const response = await this.requestRaw(async (token) => {
      const resp = await fetch(`${CONTENT_HOST}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": JSON.stringify(args),
        },
      });
      return resp;
    });

    const resultHeader = response.headers.get("Dropbox-API-Result");
    const metadata = resultHeader ? JSON.parse(resultHeader) : {};
    const content = new Uint8Array(await response.arrayBuffer());

    return { metadata, content };
  }

  /**
   * Low-level request with retry on 429.
   * Parses JSON response and throws DropboxApiError on error status.
   */
  private async request(
    doFetch: (token: string) => Promise<Response>,
  ): Promise<unknown> {
    const response = await this.requestRaw(doFetch);
    return response.json();
  }

  /**
   * Raw request with retry logic. Returns the Response object.
   */
  private async requestRaw(
    doFetch: (token: string) => Promise<Response>,
  ): Promise<Response> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const token = await this.getToken();
      const response = await doFetch(token);

      if (response.ok) {
        return response;
      }

      if (response.status === 429) {
        const parsed = Number(response.headers.get("Retry-After"));
        const retryAfter = Number.isFinite(parsed) ? parsed : 1;
        // Consume body to avoid leak
        await response.text();
        await sleep(retryAfter * 1000);
        lastError = new Error("Rate limited");
        continue;
      }

      // Parse error body for 409 and other errors
      const body = await response.json().catch(() => ({}));
      const summary =
        typeof body === "object" &&
        body !== null &&
        "error_summary" in body &&
        typeof (body as Record<string, unknown>).error_summary === "string"
          ? (body as Record<string, string>).error_summary
          : `HTTP ${response.status}`;

      throw new DropboxApiError(response.status, summary, body);
    }

    throw lastError ?? new Error("Request failed after retries");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
