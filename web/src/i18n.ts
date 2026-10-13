// Tiny translation layer. Turkish is the default and the reference language:
// every key in tr.json must exist in the other locale files (checked at build time).
import { useCallback } from 'react';
import en from './locales/en.json';
import tr from './locales/tr.json';
import { useStore } from './store';

export type MessageKey = keyof typeof tr;
export type Lang = 'tr' | 'en';
export const LANGS: Lang[] = ['tr', 'en'];
export const DEFAULT_LANG: Lang = 'tr';

const dictionaries: Record<Lang, Record<MessageKey, string>> = {
  tr,
  en: en satisfies Record<MessageKey, string>, // a missing English key fails the build
};

export type Params = Record<string, string | number>;

/** Translate outside React (callbacks, notices). Uses the current language. */
export function translate(key: MessageKey, params?: Params, lang: Lang = useStore.getState().lang): string {
  const text = dictionaries[lang]?.[key] ?? dictionaries[DEFAULT_LANG][key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (m, p: string) => (p in params ? String(params[p]) : m)) : text;
}

/** In components: `const t = useT(); t('home.startCall')`. Re-renders when the language changes. */
export function useT() {
  const lang = useStore((s) => s.lang);
  return useCallback((key: MessageKey, params?: Params) => translate(key, params, lang), [lang]);
}

export const isLang = (v: unknown): v is Lang => v === 'tr' || v === 'en';
