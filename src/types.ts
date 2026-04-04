/**
 * Options for creating a DropboxFs instance.
 */
export interface DropboxFsOptions {
  /** Static Dropbox access token. */
  accessToken?: string;
  /** Function that returns a fresh access token. Called before each API request. */
  getAccessToken?: () => string | Promise<string>;
  /** Scope all operations to this Dropbox folder (default: root). */
  rootPath?: string;
}

// --- Dropbox API response types ---

export interface DropboxFileMetadata {
  ".tag": "file";
  name: string;
  id: string;
  path_lower: string;
  path_display: string;
  rev: string;
  size: number;
  client_modified: string;
  server_modified: string;
  content_hash?: string;
  is_downloadable?: boolean;
}

export interface DropboxFolderMetadata {
  ".tag": "folder";
  name: string;
  id: string;
  path_lower: string;
  path_display: string;
}

export interface DropboxDeletedMetadata {
  ".tag": "deleted";
  name: string;
  path_lower: string;
  path_display: string;
}

export type DropboxMetadata =
  | DropboxFileMetadata
  | DropboxFolderMetadata
  | DropboxDeletedMetadata;

export interface DropboxListFolderResult {
  entries: DropboxMetadata[];
  cursor: string;
  has_more: boolean;
}

export interface DropboxErrorResponse {
  error_summary: string;
  error: {
    ".tag": string;
    [key: string]: unknown;
  };
}
