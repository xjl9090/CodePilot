import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  listPetThemes,
  getPetTheme,
  createPetTheme,
  deletePetTheme,
} from '@/lib/db';

/**
 * Desktop pet theme registry.
 * - GET     list themes (sorted by created_at desc)
 * - POST    create a new (empty) theme; assets uploaded via /api/pet/themes/[id]/upload
 * - DELETE  ?id=…  remove theme + on-disk assets
 *
 * Plan: docs/exec-plans/active/desktop-pet.md §6, §10.
 */

function petAssetsBaseDir(): string {
  const root = process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.xjlpilot');
  return path.join(root, 'pet');
}

// User-supplied name → directory-safe slug. Falls back to a timestamp-based id
// if the name has no usable ASCII characters (Chinese-only names hit this).
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (slug) return slug;
  return `theme-${Date.now().toString(36)}`;
}

function uniqueId(base: string): string {
  let id = base;
  let n = 2;
  // Bound the loop — paranoia, not a real expected case.
  while (getPetTheme(id) && n < 1000) {
    id = `${base}-${n++}`;
  }
  return id;
}

export async function GET() {
  try {
    return NextResponse.json({ themes: listPetThemes() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list pet themes';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
    if (name.length > 60) return NextResponse.json({ error: 'name too long' }, { status: 400 });
    const id = uniqueId(slugify(name));
    createPetTheme(id, name);
    // Pre-create the on-disk dir so upload can write straight away.
    fs.mkdirSync(path.join(petAssetsBaseDir(), id), { recursive: true });
    return NextResponse.json({ theme: getPetTheme(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create pet theme';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    if (!getPetTheme(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
    deletePetTheme(id);
    // Best-effort directory cleanup — db row already gone, so an fs failure
    // here only leaves orphan files, not a broken state.
    try {
      const dir = path.join(petAssetsBaseDir(), id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn('[pet] failed to remove theme dir:', err);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete pet theme';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
