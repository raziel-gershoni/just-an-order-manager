'use client';

import { type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-foreground shadow-sm hover:opacity-90',
  secondary:
    'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  danger: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
  ghost: 'hover:bg-accent/10',
  outline: 'border border-border bg-card hover:bg-muted',
};

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
  icon: 'h-9 w-9 p-0',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 active:scale-[0.98]',
        variants[variant],
        sizes[size],
        (disabled || loading) && 'opacity-50 cursor-not-allowed pointer-events-none',
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}
