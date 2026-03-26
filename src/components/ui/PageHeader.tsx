'use client';

import { useRouter } from 'next/navigation';

export function PageHeader({ title }: { title: string }) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-black/5">
      <button
        onClick={() => router.back()}
        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 transition text-lg"
        aria-label="Back"
      >
        ←
      </button>
      <h1 className="text-lg font-bold">{title}</h1>
    </div>
  );
}
