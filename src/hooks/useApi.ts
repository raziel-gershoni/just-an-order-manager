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
      // The status rides along so a caller can tell "the server refused this,
      // and said why" from "the request never landed" — a 409 deserves its own
      // sentence, a dropped connection does not.
      throw Object.assign(new Error(error.error || 'Request failed'), { status: res.status });
    }

    return res.json();
  }

  /** multipart/form-data upload — lets the browser set the Content-Type
   *  boundary (don't set it manually). */
  async function apiUpload<T = unknown>(
    path: string,
    formData: FormData
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (initDataRaw) headers['Authorization'] = `tma ${initDataRaw}`;
    if (activeGroupId) headers['X-Group-Id'] = String(activeGroupId);

    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw Object.assign(new Error(error.error || 'Upload failed'), { status: res.status });
    }

    return res.json();
  }

  return { apiFetch, apiUpload };
}
