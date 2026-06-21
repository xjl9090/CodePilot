/**
 * Font size scale shared between layout.tsx (anti-FOUC inline script via
 * JSON.stringify) and AppearanceSection (live apply on user change).
 *
 * Strategy: scale `<html>` `font-size` so all rem-based Tailwind tokens
 * (text-*, p-*, m-*, rounded-*) shift proportionally with one knob.
 *
 * Discrete presets only (no slider) — predictable, easy to reset, less
 * surface for "everything looks slightly off and I don't know why".
 */

export const FONT_SCALE_KEY = 'codepilot_font_size';
export const FONT_SCALE_SETTING = 'font_size_scale';

export type FontScaleValue = 'compact' | 'default' | 'large' | 'xlarge';

/**
 * Maps preset → CSS percentage applied to `<html>`. Browser default is
 * 16px = 100%, so 87.5% ≈ 14px and 125% ≈ 20px base.
 */
export const FONT_SCALE_PERCENT: Record<FontScaleValue, string> = {
  compact: '87.5%',
  default: '100%',
  large: '112.5%',
  xlarge: '125%',
};

export const FONT_SCALE_VALUES: ReadonlyArray<FontScaleValue> = [
  'compact',
  'default',
  'large',
  'xlarge',
] as const;

export function isFontScaleValue(v: unknown): v is FontScaleValue {
  return typeof v === 'string' && v in FONT_SCALE_PERCENT;
}

export function normalizeFontScale(v: unknown): FontScaleValue {
  return isFontScaleValue(v) ? v : 'default';
}
