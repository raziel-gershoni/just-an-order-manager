'use client';

import { type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className, id, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-muted-foreground">
          {label}
        </label>
      )}
      <input
        id={id}
        className={cn(
          'rounded-lg border border-input bg-card px-3 py-2.5 text-base outline-none transition-colors',
          'placeholder:text-muted-foreground/50',
          'focus:border-ring focus:ring-2 focus:ring-ring/20',
          className
        )}
        {...props}
      />
    </div>
  );
}

export function TextArea({
  label,
  className,
  id,
  ...props
}: { label?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-muted-foreground">
          {label}
        </label>
      )}
      <textarea
        id={id}
        className={cn(
          'rounded-lg border border-input bg-card px-3 py-2.5 text-base outline-none transition-colors',
          'placeholder:text-muted-foreground/50',
          'focus:border-ring focus:ring-2 focus:ring-ring/20',
          className
        )}
        rows={3}
        {...props}
      />
    </div>
  );
}
