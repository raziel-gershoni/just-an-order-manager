'use client';

import { useTelegram } from '@/components/providers/TelegramProvider';
import { useGroup } from './useGroup';

export function useApi() {
  const { initDataRaw } = useTelegram();
  const { activeGroupId } = useGroup();

  async function apiFetch<T = unknown>(
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string>),
    };

    if (initDataRaw) {
      headers['Authorization'] = `tma ${initDataRaw}`;
    }

    if (activeGroupId) {
      headers['X-Group-Id'] = String(activeGroupId);
    }

    const res = await fetch(`/api${path}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(error.error || 'Request failed');
    }

    return res.json();
  }

  return { apiFetch };
}
