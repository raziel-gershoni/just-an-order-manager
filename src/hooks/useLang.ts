'use client';

import { createContext, useContext } from 'react';
import type { Lang } from '@/lib/i18n';
import { t } from '@/lib/i18n';

export const LangCtx = createContext<Lang>('he');

export function useLang(): Lang {
  return useContext(LangCtx);
}

export function useT() {
  const lang = useLang();
  return (key: string) => t(key, lang);
}
