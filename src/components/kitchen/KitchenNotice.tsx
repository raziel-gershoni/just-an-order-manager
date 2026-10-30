import { t } from '@/lib/i18n';

/** The full-page notice for a screen that is not (or no longer) connected. */
export function KitchenNotice({ title }: { title: 'kitchen.not_connected_title' | 'kitchen.disconnected_title' }) {
  return (
    <main className="notice">
      <h1 className="notice-title">{t(title)}</h1>
      <p className="notice-body">{t('kitchen.connect_steps')}</p>
    </main>
  );
}
