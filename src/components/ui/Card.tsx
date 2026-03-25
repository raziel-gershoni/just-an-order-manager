'use client';

import { type HTMLAttributes } from 'react';

export function Card({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-xl bg-[var(--tg-theme-secondary-bg-color,#f9fafb)] p-4 ${className}`}
      {...props}
    />
  );
}
