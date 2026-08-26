'use client';

import { Check, User, UserX } from 'lucide-react';
import { useT } from '@/hooks/useLang';
import { cn } from '@/lib/utils';

export interface GroupMember {
  userId: number;
  name: string;
  role: 'owner' | 'manager' | 'baker' | 'driver';
}

/**
 * Who works with this customer — a bottom sheet over the customers list.
 *
 * Driven by group members, never by `users`: pressing /start on the bot creates
 * a users row with no membership, and there is one such stranger in production
 * already. A picker off `users` would offer them.
 */
export function HandlerPicker({
  customerName,
  members,
  value,
  meId,
  saving,
  onPick,
  onClose,
}: {
  customerName: string;
  members: GroupMember[];
  value: number | null;
  meId: number | null;
  saving: boolean;
  onPick: (userId: number | null) => void;
  onClose: () => void;
}) {
  const t = useT();

  const rows: { id: number | null; label: string; hint?: string }[] = [
    ...members.map((m) => ({
      id: m.userId,
      label: m.userId === meId ? t('customers.handler_me') : m.name,
      hint: m.userId === meId ? m.name : t(`role.${m.role}`),
    })),
    { id: null, label: t('customers.handler_unassigned') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 animate-fade-in" onClick={onClose}>
      <div
        className="w-full rounded-t-2xl border-t border-border bg-card pb-[calc(1rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-2">
          <h2 className="text-sm font-bold">{t('customers.handler')}</h2>
          <p className="truncate text-xs text-muted-foreground">{customerName}</p>
        </div>

        <div className="px-2 pb-2">
          {rows.map((row) => {
            const active = row.id === value;
            return (
              <button
                key={row.id ?? 'none'}
                type="button"
                disabled={saving}
                onClick={() => onPick(row.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-start transition-colors',
                  active ? 'bg-primary/10' : 'hover:bg-muted/50',
                  saving && 'opacity-50'
                )}
              >
                {row.id === null ? (
                  <UserX className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{row.label}</span>
                  {row.hint && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {row.hint}
                    </span>
                  )}
                </span>
                {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
