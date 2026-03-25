'use client';

import { type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className = '', id, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium opacity-70">
          {label}
        </label>
      )}
      <input
        id={id}
        className={`rounded-lg border border-black/10 bg-[var(--tg-theme-bg-color,#ffffff)] px-3 py-2 text-base outline-none focus:ring-2 focus:ring-[var(--tg-theme-button-color,#3b82f6)] ${className}`}
        {...props}
      />
    </div>
  );
}

export function TextArea({
  label,
  className = '',
  id,
  ...props
}: { label?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium opacity-70">
          {label}
        </label>
      )}
      <textarea
        id={id}
        className={`rounded-lg border border-black/10 bg-[var(--tg-theme-bg-color,#ffffff)] px-3 py-2 text-base outline-none focus:ring-2 focus:ring-[var(--tg-theme-button-color,#3b82f6)] ${className}`}
        rows={3}
        {...props}
      />
    </div>
  );
}
