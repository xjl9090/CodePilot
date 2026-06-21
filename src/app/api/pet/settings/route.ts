import { NextRequest, NextResponse } from 'next/server';
import { getAllPetSettings, setPetSetting } from '@/lib/db';

/**
 * Pet settings (KV).
 * GET → all known KV pairs.
 * PUT → merge subset; only an allowlist can be written from the renderer.
 */

const WRITABLE = new Set(['enabled', 'muted', 'pos_x', 'pos_y', 'current_theme_id']);

export async function GET() {
  try {
    return NextResponse.json({ settings: getAllPetSettings() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read pet settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const incoming = body?.settings;
    if (!incoming || typeof incoming !== 'object') {
      return NextResponse.json({ error: 'settings object required' }, { status: 400 });
    }
    for (const [key, value] of Object.entries(incoming)) {
      if (!WRITABLE.has(key)) continue;
      setPetSetting(key, String(value ?? ''));
    }
    return NextResponse.json({ settings: getAllPetSettings() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to write pet settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
