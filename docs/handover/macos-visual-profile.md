# macOS Native Visual Profile

Phase 7b Phase 0 audit for bringing a macOS-flavored shell to CodePilot without forking the product UI.

## Scope

The product structure stays shared across platforms: chat, Settings, plugins, runtime/model/provider cards, message rendering, Widget/Artifact rendering, and button order do not get macOS-only branches.

The macOS profile is allowed to affect only the shell and control layers:

- Window chrome and titlebar safe area
- Top bar
- Left and right sidebars
- Composer shell
- Popover / menu / HUD / tooltip surfaces
- Hover and cursor treatment in chrome/navigation layers

Content layers remain opaque and stable.

## Reference Notes

- Raycast v2's useful lesson is not the full Swift/C# shell rewrite. The useful lesson is the boundary: shared web UI for product speed, native/platform shell for platform feel.
- Apple Liquid Glass is a functional layer for controls, navigation, sidebars, tab bars, and toolbars. It should sit above content and bring focus to content; it should not turn the content layer into glass.
- Electron's `BrowserWindow.vibrancy` is window-level. DOM surfaces such as Radix popovers, RunCockpit, tooltips, and dropdowns cannot use per-surface Electron vibrancy unless we later move them into separate native overlay windows.

Sources:

- [Apple HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Apple Liquid Glass overview](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)
- [Apple Adopting Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass)
- [Apple Newsroom Liquid Glass announcement](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)
- [Electron BrowserWindow vibrancy](https://www.electronjs.org/docs/latest/api/browser-window)
- Local Raycast clipping: `/Users/op7418/Downloads/深入技术解析：全新 Raycast-A Technical Deep Dive Into the New Raycast.md`

## Current Baseline

| Layer | Current implementation | Phase 7b implication |
|-------|------------------------|----------------------|
| Electron chrome | `electron/main.ts` sets macOS `titleBarStyle: 'hiddenInset'` and `vibrancy: 'sidebar'` | Native entry already exists. Phase 2 should compare `sidebar`, `under-window`, and `content` as whole-window candidates. |
| Platform detection | `electron/preload.ts` exposes `versions.platform`; `useClientPlatform()` derives `isMac/isWindows/isLinux` | Enough for Phase 1 to stamp `data-platform` / platform style attributes. |
| Theme family | `ThemeFamilyProvider` writes `data-theme-family`; `globals.css` owns design tokens | Product theme and platform profile are currently mixed. Phase 1 needs separate `--platform-*` tokens. |
| Radius | `docs/design.md` says card radius is 8px; `globals.css` sets `--radius: 1rem` | Confirms the need to separate product card tokens from platform shell tokens. |
| Existing material-like surface | `ChatListPanel` and `SettingsSidebar` use `bg-sidebar/80 backdrop-blur-xl` | These are the safest first visual references for macOS sidebar treatment. |
| Existing opaque blockers | `UnifiedTopBar`, `WorkspaceSidebar`, `Popover`, `Dialog`, and content cards use opaque `bg-background` / `bg-popover` / `bg-card` | These currently hide most of Electron's vibrancy. Phase 2/4 should only soften chrome/floating surfaces, not content. |

## Surface Matrix

| Surface | Files | Layer | Current light | Current dark | Current border / hover | macOS candidate | Risk |
|---------|-------|-------|---------------|--------------|-------------------------|------------------|------|
| Main Electron window | `electron/main.ts` | chrome_layer | `BrowserWindow` with `hiddenInset` + `vibrancy: 'sidebar'` | Same option; renderer dark mode supplies opaque content | No `visualEffectState` override; renderer often covers material | Keep `hiddenInset`; Phase 2 POC compares whole-window `sidebar` vs `under-window` vs `content` | Whole-window material choice affects every opaque gap. Do not pick based on one page. |
| Root page / content background | `src/app/globals.css` | content_layer | `body` applies `bg-background` (`oklch(1 0 0)`) | `oklch(0.147 0.004 49.25)` | Global text and border tokens | Keep opaque. This is the reading canvas and should not become glass. | If made translucent, chat/code/settings readability drops. |
| Unified top bar | `src/components/layout/UnifiedTopBar.tsx` | chrome_layer | `h-12 bg-background px-4`; non-chat route `h-8` drag strip | Same token in dark | Icon buttons use `hover:text-foreground`; no bar material token | CSS `--platform-surface-bar`, transparent-ish background, subtle bottom edge, traffic-light-safe spacing | Must preserve drag region and nested button `no-drag` areas. |
| Left chat sidebar | `src/components/layout/ChatListPanel.tsx` | navigation_layer | `bg-sidebar/80 backdrop-blur-xl`; selected rows use `bg-sidebar-accent` / `bg-primary/[0.12]` | Same structure with dark sidebar tokens | Many `hover:bg-sidebar-accent` / `cursor-pointer` rows | First-class macOS sidebar surface. Keep blur, introduce `--platform-surface-sidebar`, weaken hover fill under macOS profile | Heavy session-list hover can still read webby. Must preserve selected/streaming/pending states. |
| Settings sidebar | `src/components/layout/SettingsSidebar.tsx` | navigation_layer | `bg-sidebar/80 backdrop-blur-xl`; active link `bg-sidebar-accent` | Same | Back/nav buttons use rounded-xl and hover fills | Reuse left sidebar treatment; align active/hover with ChatListPanel | Settings nav is a key long-session surface; do not change route structure. |
| Right workspace sidebar | `src/components/layout/WorkspaceSidebar/index.tsx`, `TabBar.tsx`, `PanelZone.tsx` | navigation_layer | `bg-background`, `border-l border-border/40`; tab strip `bg-background` | Same | Tabs use `hover:bg-muted/50`, active `bg-muted`; panel zone border only | CSS simulated sidebar material over whole-window vibrancy; subtle border and tab fills | Contains file tree / terminal / widgets; avoid lowering content contrast inside panels. |
| Composer shell | `src/components/chat/MessageInput.tsx` | chrome_layer | wrapper `bg-background/80 backdrop-blur-lg`; input group uses diffuse shadow | Same with dark shadow token | Input shell already has shadow; tool controls inherit web-style hover | Promote to platform composer token; keep text input itself clear; preserve RunCockpit and model controls | Overdoing blur near text input harms typing focus. |
| RunCockpit | `src/components/chat/RunCockpit.tsx` | floating_control_layer | Trigger button `text-muted-foreground`; content uses existing Popover stack | Same | Mini context bar and aux rows are dense; no native HUD token | Use CSS `--platform-surface-hud` for content only; keep dot matrix/readout layout unchanged | Must not change context accounting semantics or footer math. |
| Generic popover / dropdown | `src/components/ui/popover.tsx`, dropdown/menu consumers | floating_control_layer | `rounded-3xl bg-popover p-4 shadow-lg ring-1` | Dark `bg-popover` opaque card | Animate/zoom; no platform material token | CSS `--platform-surface-popover` + `backdrop-filter` fallback + stronger separation from content | DOM popovers clip inside the webview; do not claim native popover behavior. |
| Tooltip | `src/components/ui/tooltip.tsx` | floating_control_layer | `bg-foreground text-background`, rounded-md | Inverts with theme | Arrow uses same solid foreground | CSS `--platform-surface-tooltip`, but keep high contrast and small footprint | Tooltip readability beats material aesthetics. |
| Dialog / modal | `src/components/ui/dialog.tsx` | content_layer / modal_layer | Overlay `bg-black/50`; content `bg-background border shadow-lg rounded-lg` | Same | Close button hover opacity/background | Leave mostly unchanged in Phase 7b. Maybe only adjust overlay/material later after popover POC. | Dialogs hold forms and destructive actions; translucent content is risky. |
| Settings cards / catalog cards | `docs/design.md`, Settings components | content_layer | `rounded-lg bg-card border border-border/50 p-5` | Dark `bg-card` | Catalogue cards use `hover:bg-muted/40` | Keep shared CodePilot product language. No macOS-only card geometry in this plan. | Diverging Settings content would violate user's product-language boundary. |
| Chat messages / code / artifacts | message, markdown, widget renderers | content_layer | Content-specific backgrounds | Same | Tool/message states are semantic | Explicit no-op for Phase 7b | Glass here would damage readability and artifact fidelity. |

## Baseline Screenshot Matrix

Captured from the worktree dev server at `http://127.0.0.1:3001` with a 1440 x 900 browser viewport. These screenshots baseline renderer surfaces and light/dark composition. They do **not** show Electron native vibrancy; Phase 2 must add Electron-window screenshots for the material POC.

| Page | Light | Dark |
|------|-------|------|
| Chat | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/chat-light.png` | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/chat-dark.png` |
| Settings / Runtime | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/settings-runtime-light.png` | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/settings-runtime-dark.png` |
| Settings / Assistant | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/settings-assistant-light.png` | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/settings-assistant-dark.png` |
| Plugins | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/plugins-light.png` | `docs/exec-plans/active/_smoke-evidence/phase-7b/baseline/plugins-dark.png` |

Console result: light and dark capture runs both produced no `console.error` or `console.warn` messages.

## Phase 1/2 Recommendations

1. Add `data-platform` and `data-platform-style` first, with neutral defaults that produce minimal screenshot diff.
2. Add a documented `--platform-*` token layer before changing surfaces.
3. Start Phase 2 with the shell that already has partial material treatment: left sidebar + Settings sidebar + top bar.
4. Keep content cards and dialogs opaque until the chrome profile proves stable.
5. Compare whole-window vibrancy candidates in Electron, not browser: `sidebar`, `under-window`, `content`.
6. Treat DOM popovers as CSS material simulation only. Native overlay windows are a future separate POC.

## Known Baseline Observations

- The current web renderer already has a "Mac-ish" rounded baseline (`--radius: 1rem`) but the design doc still treats 8px as the card norm. Phase 1 should make that distinction explicit instead of silently changing more radii.
- The left/settings sidebars are more platform-ready than the top/right shell.
- RunCockpit and popovers are visually modern but not platform-aware; they are good Phase 4 candidates after token infrastructure exists.
- Settings / Runtime currently shows capability/status-heavy content; this is useful as a baseline because it catches text contrast regressions quickly.
