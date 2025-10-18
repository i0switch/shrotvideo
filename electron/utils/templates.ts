import type { AppSettings, Platform } from '../../src/core/settings';

export function resolveTemplateFor(platform: Platform, accountId: string, sel?: string, items?: Record<string, Partial<AppSettings>>) {
  if (!sel || !items) return null;
  // Try platform/account specific keys first
  const keys = [
    `${platform}:${accountId}`,
    `${platform}:*`,
    sel
  ];
  for (const k of keys) {
    if (items[k]) return items[k];
  }
  return null;
}

export function applyTemplateToSettings(s: AppSettings, tpl: Partial<AppSettings>) {
  // Shallow merge for known sections; keep it simple to satisfy compilation
  if (!tpl) return;
  s.general = { ...s.general, ...(tpl as any).general };
  s.render = { ...s.render, ...(tpl as any).render } as any;
  if (tpl.platforms) {
    s.platforms = {
      x: { ...s.platforms.x, ...tpl.platforms.x },
      tiktok: { ...s.platforms.tiktok, ...tpl.platforms.tiktok },
      youtube: { ...s.platforms.youtube, ...tpl.platforms.youtube },
    } as any;
  }
}
