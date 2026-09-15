import { t } from '@/lib/i18n';
import type { PublicProfile } from '@/lib/public-site';
import { PublicSectionHead } from './PublicSectionHead';
import { ClockIcon, PinIcon, PhoneIcon, InstagramIcon, WhatsAppIcon, TruckIcon } from './icons';

type Row = { key: string; label: string; value: string; href?: string; ltr?: boolean; icon: React.ReactNode };

/**
 * When to order, where to collect, how to reach them.
 *
 * Rows on hairlines rather than a bordered card cut into dashed cells. Numbers
 * carry their own direction — a phone number in a right-to-left line renders
 * with its leading digit at the wrong end otherwise.
 */
export function DetailsSection({
  profile,
  waHref,
}: {
  profile: PublicProfile;
  waHref: string | null;
}) {
  const ig = profile.instagram?.replace(/^@/, '').trim();
  const rows: Row[] = [];
  const icon = 'h-[18px] w-[18px] text-primary';

  const d = profile.delivery;
  const deliveryText = d
    ? [
        d.homeCity ? `${t('deliv.pub_free_in')}${d.homeCity}` : null,
        d.fee > 0 ? `₪${d.fee} ${t('deliv.pub_fee_cities')}` : null,
        d.freeOver != null ? `${t('deliv.pub_free_over')} ₪${d.freeOver}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  if (profile.orderDays)
    rows.push({ key: 'days', label: t('site.order_days'), value: profile.orderDays, icon: <ClockIcon className={icon} /> });
  if (profile.pickupArea)
    rows.push({ key: 'pickup', label: t('site.pickup'), value: profile.pickupArea, href: profile.mapUrl ?? undefined, icon: <PinIcon className={icon} /> });
  if (profile.whatsappPhone)
    rows.push({ key: 'wa', label: t('site.whatsapp'), value: profile.whatsappPhone, href: waHref ?? undefined, ltr: true, icon: <WhatsAppIcon className={icon} /> });
  if (profile.contactPhone)
    rows.push({ key: 'phone', label: t('site.phone'), value: profile.contactPhone, href: `tel:${profile.contactPhone}`, ltr: true, icon: <PhoneIcon className={icon} /> });
  if (ig)
    rows.push({ key: 'ig', label: t('site.instagram'), value: `@${ig}`, href: `https://instagram.com/${ig}`, ltr: true, icon: <InstagramIcon className={icon} /> });
  if (profile.address)
    rows.push({ key: 'addr', label: t('site.address'), value: profile.address, href: profile.mapUrl ?? undefined, icon: <PinIcon className={icon} /> });

  return (
    <section className="mt-12">
      <PublicSectionHead label={t('site.details_title')} />

      {deliveryText && (
        <div className="mb-4 flex items-center gap-2.5 rounded-[14px] bg-card px-4 py-3 text-[13.5px] font-semibold">
          <TruckIcon className="h-[18px] w-[18px] shrink-0 text-primary" />
          <span className="min-w-0">{deliveryText}</span>
        </div>
      )}

      {rows.length > 0 && (
        <address className="block not-italic">
          {rows.map((row, i) => {
            const value = (
              <span className={`ms-auto font-semibold ${row.ltr ? 'tabular-nums' : ''}`}>
                {row.ltr ? <span dir="ltr">{row.value}</span> : row.value}
              </span>
            );
            return (
              <div
                key={row.key}
                className={`flex items-center gap-3 py-3 text-[14.5px] ${
                  i > 0 ? 'border-t border-border' : ''
                }`}
              >
                <span className="flex min-w-[104px] items-center gap-2.5 text-muted-foreground">
                  {row.icon}
                  {row.label}
                </span>
                {row.href ? (
                  <a href={row.href} target="_blank" rel="noopener noreferrer" className="ms-auto">
                    {value}
                  </a>
                ) : (
                  value
                )}
              </div>
            );
          })}
        </address>
      )}
    </section>
  );
}
