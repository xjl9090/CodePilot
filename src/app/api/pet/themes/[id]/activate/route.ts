import { NextResponse } from 'next/server';
import { getPetTheme, setPetSetting } from '@/lib/db';

/**
 * Activate a theme: sets pet_settings.current_theme_id.
 * Plan §6: incomplete themes (missing any of 4 state PNGs) cannot be activated.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const theme = getPetTheme(id);
    if (!theme) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!theme.is_complete) {
      return NextResponse.json(
        { error: 'theme is incomplete — upload all 4 state images first' },
        { status: 409 },
      );
    }
    setPetSetting('current_theme_id', id);
    return NextResponse.json({ ok: true, themeId: id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to activate pet theme';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
