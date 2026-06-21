import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getPetTheme, setPetThemeComplete } from '@/lib/db';

/**
 * Upload one or more state PNGs for a pet theme.
 * Plan §6: only PNG, ≤5MB per file, magic-byte verified, names fixed to
 * expr-{idle,working,waiting,done}.png.
 *
 * Form-data fields: state=<idle|working|waiting|done>, file=<File>.
 * Single-file per request keeps the route uniform; the UI calls 4 times
 * for a fresh theme (one per state).
 */

const VALID_STATES = ['idle', 'working', 'waiting', 'done'] as const;
type PetState = typeof VALID_STATES[number];
const MAX_BYTES = 5 * 1024 * 1024;
// PNG magic bytes — exact 8-byte signature.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function petAssetsBaseDir(): string {
  const root = process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.xjlpilot');
  return path.join(root, 'pet');
}

function isPng(buf: Buffer): boolean {
  return buf.length >= PNG_MAGIC.length && buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
}

function checkComplete(themeDir: string): boolean {
  return VALID_STATES.every((s) => fs.existsSync(path.join(themeDir, `expr-${s}.png`)));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!getPetTheme(id)) return NextResponse.json({ error: 'theme not found' }, { status: 404 });

    const form = await request.formData();
    const state = form.get('state');
    const file = form.get('file');
    if (typeof state !== 'string' || !VALID_STATES.includes(state as PetState)) {
      return NextResponse.json({ error: 'invalid state' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file required' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'file too large (max 5MB)' }, { status: 413 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (!isPng(buf)) {
      return NextResponse.json({ error: 'only PNG accepted' }, { status: 400 });
    }

    const themeDir = path.join(petAssetsBaseDir(), id);
    fs.mkdirSync(themeDir, { recursive: true });
    const target = path.join(themeDir, `expr-${state}.png`);
    fs.writeFileSync(target, buf);

    setPetThemeComplete(id, checkComplete(themeDir));
    return NextResponse.json({ ok: true, complete: checkComplete(themeDir) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to upload pet asset';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
