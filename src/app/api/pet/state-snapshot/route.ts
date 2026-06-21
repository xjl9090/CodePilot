import { NextResponse } from 'next/server';
import { getPetSetting, getAllPetSettings, getDb } from '@/lib/db';

/**
 * Internal endpoint for the Electron main process — it cannot import db.ts
 * directly in dev mode because better-sqlite3's native binding is compiled
 * for Node ABI inside `node_modules/`, not the Electron ABI the main process
 * runs under. (electron-rebuild happens at package time via after-pack.js;
 * dev never rebuilds because Next dev server is plain Node and works fine
 * with the Node-ABI binding.)
 *
 * The Electron main process polls this every 2s and forwards the result to
 * the pet BrowserWindow.
 *
 * State semantics (2026-06-21 revision — see plan §3 + handover):
 *   working  → there's a session whose runtime is actually executing right
 *              now. Two indicators, EITHER triggers:
 *                a) runtime_status='running' updated within last 5 min
 *                   (the source of truth; runtime sets/clears this).
 *                b) the most-recent message in the last 90s is from
 *                   role='user' — i.e. the user just sent something and
 *                   the assistant hasn't replied yet. Catches the tiny
 *                   window between "user submit" and "runtime flips
 *                   running=true".
 *   waiting  → most-recent message is from role='assistant' in the last
 *              5 min. Meaning: assistant replied, ball is in the user's
 *              court, pet looks expectant.
 *   idle     → none of the above. The 5-minute waiting window means the
 *              pet returns to idle after the conversation goes quiet,
 *              which is what users actually want — not "stuck on working
 *              forever because there was a message 9 minutes ago."
 *
 * Original Swift pet's heuristic was looser (10-min message window for
 * working). That was wrong: it conflated "you happened to chat 8 min ago"
 * with "the assistant is actively typing". This route fixes that.
 */
export async function GET() {
  try {
    const db = getDb();
    let raw: 'idle' | 'working' | 'waiting' = 'idle';

    // Demo override (2026-06-21): when pet_settings['demo_mode'] === '1',
    // ONLY the temp session '__pet_demo__' drives the state. Real chat
    // sessions are ignored. This lets us walk through all 4 states for
    // verification without touching real user data. Turn off by deleting
    // the demo_mode key; the helper script handles that on exit.
    const demoMode = getPetSetting('demo_mode') === '1';

    if (demoMode) {
      // Scope every query to id='__pet_demo__'.
      const runningRow = db.prepare(`
        SELECT 1 FROM chat_sessions
        WHERE id = '__pet_demo__'
          AND status = 'active'
          AND runtime_status = 'running'
          AND runtime_updated_at > datetime('now', '-5 minutes')
        LIMIT 1
      `).get();
      if (runningRow) {
        raw = 'working';
      } else {
        const latest = db.prepare(`
          SELECT role, created_at FROM messages
          WHERE session_id = '__pet_demo__'
          ORDER BY created_at DESC
          LIMIT 1
        `).get() as { role: string; created_at: string } | undefined;
        if (latest) {
          const ageMs = Date.now() - new Date(latest.created_at + 'Z').getTime();
          if (latest.role === 'user' && ageMs >= 0 && ageMs < 90_000) raw = 'working';
          else if (latest.role === 'assistant' && ageMs >= 0 && ageMs < 5 * 60_000) raw = 'waiting';
        }
      }
    } else {
      // Production path — original logic untouched.
      const runningRow = db.prepare(`
        SELECT 1 FROM chat_sessions
        WHERE status = 'active'
          AND runtime_status = 'running'
          AND runtime_updated_at > datetime('now', '-5 minutes')
        LIMIT 1
      `).get();
      if (runningRow) {
        raw = 'working';
      } else {
        const latest = db.prepare(`
          SELECT role, created_at FROM messages
          ORDER BY created_at DESC
          LIMIT 1
        `).get() as { role: string; created_at: string } | undefined;
        if (latest) {
          const ageMs = Date.now() - new Date(latest.created_at + 'Z').getTime();
          if (latest.role === 'user' && ageMs >= 0 && ageMs < 90_000) {
            raw = 'working';
          } else if (latest.role === 'assistant' && ageMs >= 0 && ageMs < 5 * 60_000) {
            raw = 'waiting';
          }
        }
      }
    }

    const settings = getAllPetSettings();
    return NextResponse.json({
      raw,
      currentThemeId: getPetSetting('current_theme_id') || null,
      muted: settings.muted === '1',
      enabled: settings.enabled === '1',
      demoMode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'state snapshot failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
