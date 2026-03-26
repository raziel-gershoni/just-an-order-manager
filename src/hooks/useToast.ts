'use client';

import { createContext, useContext, useCallback } from 'react';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error';
}

interface ToastContext {
  toasts: Toast[];
  showToast: (message: string, type?: 'success' | 'error') => void;
  dismissToast: (id: string) => void;
}

export const ToastCtx = createContext<ToastContext>({
  toasts: [],
  showToast: () => {},
  dismissToast: () => {},
});

export function useToast() {
  const { showToast } = useContext(ToastCtx);
  return {
    success: (message: string) => showToast(message, 'success'),
    error: (message: string) => showToast(message, 'error'),
  };
}
