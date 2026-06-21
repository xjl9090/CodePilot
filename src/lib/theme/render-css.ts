import type { ThemeFamily, ThemeColors } from './types';

/**
 * Per-key overrides for cases where the camelCase JSON key shouldn't
 * mechanically convert to its kebab equivalent.
 *
 * Magic Glass tokens use the `--mg-` shorthand in CSS (shorter to type
 * in components than `--magic-accent-from`), but the JSON keys spell
 * out `magicAccent…` for searchability. This map bridges the two
 * representations without forcing components to use long names.
 */
const KEY_TO_CSS_VAR_OVERRIDES: Record<string, string> = {
  magicAccentFrom:       '--mg-accent-from',
  magicAccentTo:         '--mg-accent-to',
  magicAccentForeground: '--mg-accent-foreground',
  magicGlow:             '--mg-glow',
  magicSurfaceTint:      '--mg-surface-tint',
  magicEdge:             '--mg-edge',
  magicActiveBgFrom:     '--mg-active-bg-from',
  magicActiveBgTo:       '--mg-active-bg-to',
};

/** Convert camelCase key to CSS variable name: cardForeground → --card-foreground */
export function colorKeyToCssVar(key: string): string {
  if (KEY_TO_CSS_VAR_OVERRIDES[key]) return KEY_TO_CSS_VAR_OVERRIDES[key];
  // Insert hyphens before uppercase letters, then lowercase
  // Special handling for numbered keys like chart1 → --chart-1
  const kebab = key
    .replace(/([A-Z])/g, '-$1')
    .replace(/(\d+)/g, '-$1')
    .toLowerCase();
  return `--${kebab}`;
}

function renderColorBlock(colors: ThemeColors): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(colors)) {
    if (value === undefined || value === null) continue;
    lines.push(`  ${colorKeyToCssVar(key)}: ${value};`);
  }
  return lines.join('\n');
}

/**
 * Generate CSS for all theme families.
 *
 * Specificity:
 *   html[data-theme-family="x"]       → (0,1,0) — beats :root (0,0,1)
 *   html.dark[data-theme-family="x"]  → (0,2,0) — beats .dark (0,1,0)
 *
 * The globals.css :root/.dark blocks remain as fallback when data-theme-family is absent.
 */
export function renderThemeFamilyCSS(families: ThemeFamily[]): string {
  const blocks: string[] = [];

  for (const family of families) {
    // Light mode
    blocks.push(
      `html[data-theme-family="${family.id}"] {\n${renderColorBlock(family.light)}\n}`
    );
    // Dark mode
    blocks.push(
      `html.dark[data-theme-family="${family.id}"] {\n${renderColorBlock(family.dark)}\n}`
    );
  }

  return blocks.join('\n\n');
}
