import { NextRequest } from 'next/server';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Stream a pet asset PNG by (theme, state).
 *
 * The pet BrowserWindow loads from http:// (Next dev/prod server), so a
 * file:// <img> would hit a mixed-scheme block. This route is the bridge:
 * it reads the file under ~/.xjlpilot/pet/{theme}/expr-{state}.png and
 * pipes the bytes back. Same route also serves the settings panel
 * thumbnails — the UI just appends a cache-busting query.
 *
 * Path traversal defense: theme & state are validated against allow-lists
 * derived from the slug rules in /api/pet/themes route.
 */

const VALID_STATES = new Set(['idle', 'working', 'waiting', 'done']);
const VALID_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;

function petAssetsBaseDir(): string {
  const root = process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.xjlpilot');
  return path.join(root, 'pet');
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const theme = searchParams.get('theme') || '';
  const state = searchParams.get('state') || '';

  if (!VALID_ID.test(theme)) return new Response('bad theme', { status: 400 });
  if (!VALID_STATES.has(state)) return new Response('bad state', { status: 400 });

  const file = path.join(petAssetsBaseDir(), theme, `expr-${state}.png`);
  // Defense in depth: confirm the resolved path stays under petAssetsBaseDir.
  const base = petAssetsBaseDir();
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(base) + path.sep)) {
    return new Response('forbidden', { status: 403 });
  }

  if (!fs.existsSync(resolved)) return new Response('not found', { status: 404 });
  const buf = fs.readFileSync(resolved);
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    },
  });
}
