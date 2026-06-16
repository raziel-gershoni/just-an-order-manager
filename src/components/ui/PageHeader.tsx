'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLang } from '@/hooks/useLang';

export function PageHeader({ title }: { title: string }) {
  const router = useRouter();
  const lang = useLang();
  const BackIcon = lang === 'he' ? ChevronRight : ChevronLeft;

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
      <button
        onClick={() => router.back()}
        className="w-11 h-11 -ms-1.5 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
        aria-label="חזרה"
      >
        <BackIcon className="h-5 w-5 text-muted-foreground" />
      </button>
      <h1 className="text-lg font-bold tracking-tight">{title}</h1>
    </div>
  );
}
