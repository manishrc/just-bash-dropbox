/**
 * Token provider pattern — Production-ready auth with auto-refresh.
 *
 * Shows how to use getAccessToken for robust token management:
 * - Caches the current token
 * - Refreshes automatically when expired
 * - Works with any token storage (env vars, database, vault, etc.)
 *
 * Usage:
 *   DROPBOX_APP_KEY=xxx DROPBOX_APP_SECRET=xxx DROPBOX_REFRESH_TOKEN=xxx \
 *     npx tsx examples/token-provider.ts
 */

import { DropboxFs } from "just-bash-dropbox";
import { Bash } from "just-bash";

// Simple token cache with auto-refresh
function createTokenProvider(config: {
  appKey: string;
  appSecret: string;
  refreshToken: string;
}) {
  let cachedToken: string | null = null;
  let expiresAt = 0;

  return async function getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 5-minute buffer)
    if (cachedToken && Date.now() < expiresAt - 5 * 60 * 1000) {
      return cachedToken;
    }

    // Refresh the token
    const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: config.refreshToken,
        client_id: config.appKey,
        client_secret: config.appSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    cachedToken = data.access_token;
    expiresAt = Date.now() + data.expires_in * 1000;

    console.log("Token refreshed, expires in", data.expires_in, "seconds");
    return cachedToken;
  };
}

// --- Main ---

const appKey = process.env.DROPBOX_APP_KEY;
const appSecret = process.env.DROPBOX_APP_SECRET;
const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;

if (!appKey || !appSecret || !refreshToken) {
  console.error(
    "Set DROPBOX_APP_KEY, DROPBOX_APP_SECRET, and DROPBOX_REFRESH_TOKEN",
  );
  process.exit(1);
}

const getAccessToken = createTokenProvider({
  appKey,
  appSecret,
  refreshToken,
});

const fs = new DropboxFs({ getAccessToken });
const bash = new Bash({ fs });

// The token provider handles refresh transparently
const { stdout } = await bash.exec("ls /");
console.log(stdout);
