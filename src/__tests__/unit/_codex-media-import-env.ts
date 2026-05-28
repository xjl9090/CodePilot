/**
 * Side-effect setup module — MUST be the first import in
 * `codex-media-import.test.ts`. Sets CLAUDE_GUI_DATA_DIR to a fresh temp
 * root so that when the @/lib chain transitively loads `src/lib/db.ts`
 * (which captures `process.env.CLAUDE_GUI_DATA_DIR` at module-load time,
 * not per-call), the DB path lands inside the test root — NOT in the real
 * `~/.codepilot/codepilot.db`.
 *
 * Tech-debt #25 root cause: the previous test set the env var inside
 * `beforeEach`, but ESM imports are hoisted, so `@/lib/db` had already
 * captured the real path before the env swap fired. Media files (read
 * env per-call) went to the temp dir; DB rows (captured path) went to
 * the real DB → 1896 dangling rows accumulated by 2026-05-28.
 *
 * Importing this module FIRST guarantees env-before-import (ES module
 * side effects run in declaration order across separate modules).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CODEX_MEDIA_TEST_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'codex-media-import-root-'),
);

process.env.CLAUDE_GUI_DATA_DIR = CODEX_MEDIA_TEST_ROOT;

/** Path to the user's REAL DB — used by the regression guard to assert
 *  this test file does NOT leak any new rows into it. */
export const REAL_USER_DB_PATH = path.join(os.homedir(), '.codepilot', 'codepilot.db');
