'use client';

const STEPS = ['pending', 'confirmed', 'baking', 'ready', 'delivered'] as const;

const stepColors: Record<string, string> = {
  completed: 'bg-green-500',
  current: 'bg-[var(--tg-theme-button-color,#3b82f6)]',
  upcoming: 'bg-black/10',
  cancelled: 'bg-red-500',
};

export function StatusFlow({
  status,
  labels,
}: {
  status: string;
  labels: Record<string, string>;
}) {
  if (status === 'cancelled') {
    return (
      <div className="flex items-center justify-center py-3">
        <span className="rounded-full bg-red-100 text-red-700 px-4 py-1.5 text-sm font-medium">
          ✕ {labels.cancelled || 'Cancelled'}
        </span>
      </div>
    );
  }

  const currentIdx = STEPS.indexOf(status as any);

  return (
    <div className="flex items-center gap-1 py-3">
      {STEPS.map((step, i) => {
        const state =
          i < currentIdx ? 'completed' : i === currentIdx ? 'current' : 'upcoming';

        return (
          <div key={step} className="flex-1 flex flex-col items-center gap-1.5">
            {/* Dot + connector */}
            <div className="flex items-center w-full">
              {i > 0 && (
                <div
                  className={`flex-1 h-0.5 ${
                    i <= currentIdx ? 'bg-green-500' : 'bg-black/10'
                  }`}
                />
              )}
              <div
                className={`w-3 h-3 rounded-full shrink-0 ${stepColors[state]} ${
                  state === 'current' ? 'ring-2 ring-offset-1 ring-[var(--tg-theme-button-color,#3b82f6)]/30' : ''
                }`}
              />
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 ${
                    i < currentIdx ? 'bg-green-500' : 'bg-black/10'
                  }`}
                />
              )}
            </div>
            {/* Label */}
            <span
              className={`text-[10px] leading-tight text-center ${
                state === 'current' ? 'font-bold' : state === 'upcoming' ? 'opacity-40' : 'opacity-60'
              }`}
            >
              {labels[step] || step}
            </span>
          </div>
        );
      })}
    </div>
  );
}
