import { create } from 'zustand';
import en from '../locales/en.json';
import th from '../locales/th.json';

export type Language = 'en' | 'th';

const dictionaries: Record<Language, Record<string, string>> = {
  en,
  th,
};

interface I18nState {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const getInitialLang = (): Language => {
  try {
    const saved = localStorage.getItem('app_lang');
    if (saved === 'en' || saved === 'th') return saved;
  } catch {}
  try {
    const navLang = navigator.language?.slice(0, 2);
    return navLang === 'th' ? 'th' : 'en';
  } catch {}
  return 'en';
};

export const useI18n = create<I18nState>((set, get) => ({
  lang: getInitialLang(),
  setLang: (lang) => {
    try {
      localStorage.setItem('app_lang', lang);
    } catch {}
    set({ lang });
  },
  toggleLang: () => {
    const next: Language = get().lang === 'th' ? 'en' : 'th';
    try {
      localStorage.setItem('app_lang', next);
    } catch {}
    set({ lang: next });
  },
  t: (key, params) => {
    const currentLang = get().lang;
    let text = dictionaries[currentLang]?.[key] || dictionaries.en?.[key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
    }
    return text;
  },
}));
