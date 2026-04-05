/**
 * Compile-time check that DropboxFs satisfies IFileSystem.
 * This file is excluded from the build but checked by `tsc --noEmit`.
 */
import type { IFileSystem } from "just-bash";
import type { DropboxFs } from "./dropbox-fs.js";

// Fails to compile if DropboxFs drifts from IFileSystem
const _check: IFileSystem = {} as DropboxFs;
void _check;
