/** Interface preferences; both optional features are off until explicitly enabled. */
export const DEFAULT_INTERFACE_PREFERENCES = Object.freeze({
  sidebarFontEnabled: false,
  sidebarFontSize: 14,
  recentTabsEnabled: false,
});

/** Accept booleans strictly; round finite numeric sizes and clamp to 12–20 px. */
export function normalizeInterfacePreferences(value) {
  const input = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const size = typeof input.sidebarFontSize === 'number' && Number.isFinite(input.sidebarFontSize)
    ? Math.max(12, Math.min(20, Math.round(input.sidebarFontSize)))
    : DEFAULT_INTERFACE_PREFERENCES.sidebarFontSize;
  return {
    sidebarFontEnabled: input.sidebarFontEnabled === true,
    sidebarFontSize: size,
    recentTabsEnabled: input.recentTabsEnabled === true,
  };
}

/**
 * Explicit text-class compatibility adapter for DSH 0.2.2-rc.1.
 * These CSS-module names are verified for that release, not stable public APIs.
 * Mount only while sidebarFontEnabled is true; remove the stylesheet on disable.
 * No root-wide inherited override: unrelated controls, icons and overlays retain
 * their own typography. Bottom account/settings launchers need separate adapters.
 * The sidebar root itself can be role=dialog in narrow drawer mode; only nested
 * dialogs/tooltips (or dialogs outside the root) exclude matching text.
 */
export function sidebarFontCss(size) {
  const px = normalizeInterfacePreferences({ sidebarFontSize: size }).sidebarFontSize;
  const root = '.kB3qhq_root';
  const excluded = [
    `${root} [role="dialog"]`,
    `${root} [role="dialog"] *`,
    `${root} [role="tooltip"]`,
    `${root} [role="tooltip"] *`,
    `[role="dialog"] ${root}`,
    `[role="dialog"] ${root} *`,
    `[role="tooltip"] ${root}`,
    `[role="tooltip"] ${root} *`,
  ].join(', ');
  const selectors = (names) => names.map((name) =>
    `${root} .${name}:not(:where(${excluded}))`
  ).join(',\n');
  const primary = selectors([
    'kB3qhq_newSessionLabel',
    'kB3qhq_panelTitle',
    'JoiKIa_title',
    'JoiKIa_projectText',
    'JoiKIa_renameInput',
    'JoiKIa_searchResultTitle',
  ]);
  const secondary = selectors([
    'JoiKIa_time',
    'JoiKIa_timestamp',
    'JoiKIa_meta',
    'JoiKIa_searchResultWorkspace',
    'JoiKIa_searchResultSnippet',
  ]);
  return `${primary} {\n  font-size: ${px}px !important;\n  line-height: ${Math.max(20, px + 6)}px !important;\n}\n${secondary} {\n  font-size: ${Math.max(10, px - 2)}px !important;\n  line-height: ${Math.max(17, px + 3)}px !important;\n}\n`;
}
