'use client';

import { useEffect } from 'react';
import type { Toast as ToastType } from '@/hooks/useToast';

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastType[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex flex-col items-center gap-2 p-3 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastType;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 3000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={`pointer-events-auto w-full max-w-sm rounded-xl px-4 py-3 text-sm font-medium shadow-lg animate-slide-down ${
        toast.type === 'success'
          ? 'bg-green-500 text-white'
          : 'bg-red-500 text-white'
      }`}
      onClick={() => onDismiss(toast.id)}
    >
      <span className="mr-2">{toast.type === 'success' ? '✓' : '✕'}</span>
      {toast.message}
    </div>
  );
}
