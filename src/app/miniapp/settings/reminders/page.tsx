'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { ControlCenterTabs } from '@/components/ui/ControlCenterTabs';
import { ReminderLog } from '@/components/ui/ReminderLog';
import { Plus, Pencil, Trash2, Pause, Play, Repeat } from 'lucide-react';

type Occasion = 'week_start' | 'shabbat' | 'recurring';
interface Template {
  id: number;
  label: string;
  metaTemplateName: string;
  occasion: Occasion;
  bodyPreview: string | null;
  isActive: boolean;
  sortOrder: number;
}

const OCCASIONS: Occasion[] = ['week_start', 'shabbat', 'recurring'];

export default function RemindersPage() {
  const { apiFetch } = useApi();
  const { activeGroupId, activeGroupRole } = useGroup();
  const t = useT();
  const toast = useToast();
  const isBaker = activeGroupRole === 'baker';

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'templates' | 'log'>('templates');
  const [recurringEnabled, setRecurringEnabled] = useState(false);
  // Gate the toggle until its own value has loaded, so a tap made before the
  // GET resolves can't be clobbered by the (stale) response landing after it.
  const [groupLoaded, setGroupLoaded] = useState(false);

  useEffect(() => {
    apiFetch<{ templates: Template[] }>('/reminder-templates')
      .then((r) => setTemplates(r.templates))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeGroupId) return;
    setGroupLoaded(false);
    apiFetch<{ group: { recurringRemindersEnabled: boolean } }>(`/groups/${activeGroupId}`)
      .then((r) => setRecurringEnabled(r.group.recurringRemindersEnabled ?? false))
      .catch(() => {})
      .finally(() => setGroupLoaded(true));
  }, [activeGroupId]);

  async function toggleRecurring(next: boolean) {
    if (!activeGroupId) return;
    setRecurringEnabled(next); // optimistic
    try {
      await apiFetch(`/groups/${activeGroupId}`, {
        method: 'PATCH',
        body: JSON.stringify({ recurringRemindersEnabled: next }),
      });
    } catch {
      setRecurringEnabled(!next);
      toast.error(t('reminders.template_save_failed'));
    }
  }

  async function save() {
    if (!editing?.label?.trim() || !editing?.metaTemplateName?.trim() || !editing?.occasion) return;
    setSaving(true);
    try {
      const payload = {
        label: editing.label.trim(),
        metaTemplateName: editing.metaTemplateName.trim(),
        occasion: editing.occasion,
        bodyPreview: editing.bodyPreview?.trim() || null,
        isActive: editing.isActive ?? true,
      };
      if (editing.id) {
        const { template } = await apiFetch<{ template: Template }>(`/reminder-templates/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setTemplates((prev) => prev.map((x) => (x.id === template.id ? template : x)));
      } else {
        const { template } = await apiFetch<{ template: Template }>('/reminder-templates', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setTemplates((prev) => [...prev, template]);
      }
      toast.success(t('reminders.template_saved'));
      setEditing(null);
    } catch {
      toast.error(t('reminders.template_save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(tpl: Template) {
    const { template } = await apiFetch<{ template: Template }>(`/reminder-templates/${tpl.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !tpl.isActive }),
    });
    setTemplates((prev) => prev.map((x) => (x.id === template.id ? template : x)));
  }

  async function remove(tpl: Template) {
    try {
      await apiFetch(`/reminder-templates/${tpl.id}`, { method: 'DELETE' });
      setTemplates((prev) => prev.filter((x) => x.id !== tpl.id));
      toast.success(t('reminders.template_deleted'));
    } catch {
      toast.error(t('reminders.delete_has_history'));
    }
  }

  if (isBaker) {
    return (
      <>
        <ControlCenterTabs />
        <div className="p-5 text-sm text-muted-foreground">—</div>
      </>
    );
  }

  return (
    <>
      <ControlCenterTabs />
      <div className="p-5 space-y-4">
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(['templates', 'log'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={
                'flex-1 rounded-md py-2 text-sm font-medium transition-all ' +
                (view === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')
              }
            >
              {t(v === 'templates' ? 'reminders.tab_templates' : 'reminders.tab_log')}
            </button>
          ))}
        </div>

        {view === 'log' ? (
          <ReminderLog />
        ) : (
          <>
        <Card className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-medium text-sm">
              <Repeat className="h-4 w-4 text-primary" />
              {t('reminders.recurring_title')}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={recurringEnabled}
              disabled={!groupLoaded}
              onClick={() => toggleRecurring(!recurringEnabled)}
              className={'relative h-7 w-12 flex-none rounded-full transition-colors disabled:opacity-50 ' + (recurringEnabled ? 'bg-success' : 'bg-muted')}
            >
              <span className={'absolute top-1 h-5 w-5 rounded-full bg-card shadow transition-all ' + (recurringEnabled ? 'start-6' : 'start-1')} />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t('reminders.recurring_desc')}</p>
        </Card>
        {loading ? (
          <div className="h-32 rounded-xl bg-muted animate-pulse" />
        ) : (
          OCCASIONS.map((occ) => {
            const rows = templates.filter((tp) => tp.occasion === occ);
            return (
              <Card key={occ} className="p-0 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-dashed border-border">
                  <span className="font-semibold text-sm">
                    {t(`reminders.occasion.${occ}`)}
                    {occ === 'recurring' && (
                      <span className="ms-2 font-normal text-[11px] text-muted-foreground">
                        {t('reminders.recurring_auto_note')}
                      </span>
                    )}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ occasion: occ, isActive: true })}>
                    <Plus className="h-4 w-4" />
                    {t('reminders.add_template')}
                  </Button>
                </div>
                {rows.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-muted-foreground italic">{t('reminders.no_templates')}</p>
                ) : (
                  rows.map((tp) => (
                    <div
                      key={tp.id}
                      className="flex items-start gap-2 px-4 py-3 border-t border-dashed border-border first:border-t-0"
                    >
                      <div className="flex-1 min-w-0">
                        <div className={tp.isActive ? 'font-medium' : 'font-medium opacity-50'}>{tp.label}</div>
                        <div className="font-mono text-[11px] text-muted-foreground truncate">{tp.metaTemplateName}</div>
                        {tp.bodyPreview && (
                          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tp.bodyPreview}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label="toggle"
                        className="p-1.5 text-muted-foreground hover:text-foreground"
                        onClick={() => toggleActive(tp)}
                      >
                        {tp.isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        aria-label="edit"
                        className="p-1.5 text-muted-foreground hover:text-foreground"
                        onClick={() => setEditing(tp)}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="delete"
                        className="p-1.5 text-destructive/70 hover:text-destructive"
                        onClick={() => remove(tp)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                )}
              </Card>
            );
          })
        )}
          </>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-background p-5 overflow-y-auto">
          <div className="space-y-4 max-w-md mx-auto">
            <h2 className="text-lg font-semibold">
              {editing.id ? t('reminders.edit_template') : t('reminders.add_template')}
            </h2>
            <Input
              label={t('reminders.label')}
              value={editing.label ?? ''}
              onChange={(e) => setEditing((p) => ({ ...p!, label: e.target.value }))}
            />
            <div>
              <Input
                label={t('reminders.meta_name')}
                value={editing.metaTemplateName ?? ''}
                onChange={(e) => setEditing((p) => ({ ...p!, metaTemplateName: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">{t('reminders.meta_name_hint')}</p>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1.5">{t('reminders.occasion')}</div>
              <div className="flex gap-2">
                {OCCASIONS.map((occ) => (
                  <button
                    key={occ}
                    type="button"
                    className={
                      'flex-1 rounded-lg border px-3 py-2 text-sm font-medium ' +
                      (editing.occasion === occ
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground')
                    }
                    onClick={() => setEditing((p) => ({ ...p!, occasion: occ }))}
                  >
                    {t(`reminders.occasion.${occ}`)}
                  </button>
                ))}
              </div>
            </div>
            <TextArea
              label={t('reminders.preview')}
              value={editing.bodyPreview ?? ''}
              onChange={(e) => setEditing((p) => ({ ...p!, bodyPreview: e.target.value }))}
            />
            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1"
                onClick={save}
                loading={saving}
                disabled={!editing.label?.trim() || !editing.metaTemplateName?.trim() || !editing.occasion}
              >
                {t('reminders.save')}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                {t('reminders.cancel')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
