import { t } from '@/lib/i18n';
import type { PublicProfile } from '@/lib/public-site';
import { PublicSectionHead } from './PublicSectionHead';
import { ClockIcon, PinIcon, PhoneIcon, InstagramIcon, WhatsAppIcon, TruckIcon } from './icons';

type Row = { key: string; label: string; value: string; href?: string; mono?: boolean; icon: React.ReactNode };

export function DetailsSection({
  profile,
  waHref,
}: {
  profile: PublicProfile;
  waHref: string | null;
}) {
  const ig = profile.instagram?.replace(/^@/, '').trim();
  const rows: Row[] = [];

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

  if (profile.bakeDays)
    rows.push({ key: 'days', label: t('site.bake_days'), value: profile.bakeDays, icon: <ClockIcon className="h-[18px] w-[18px] text-primary" /> });
  if (profile.pickupArea)
    rows.push({ key: 'pickup', label: t('site.pickup'), value: profile.pickupArea, href: profile.mapUrl ?? undefined, icon: <PinIcon className="h-[18px] w-[18px] text-primary" /> });
  if (profile.whatsappPhone)
    rows.push({ key: 'wa', label: t('site.whatsapp'), value: profile.whatsappPhone, href: waHref ?? undefined, mono: true, icon: <WhatsAppIcon className="h-[18px] w-[18px] text-primary" /> });
  if (profile.contactPhone)
    rows.push({ key: 'phone', label: t('site.phone'), value: profile.contactPhone, href: `tel:${profile.contactPhone}`, mono: true, icon: <PhoneIcon className="h-[18px] w-[18px] text-primary" /> });
  if (ig)
    rows.push({ key: 'ig', label: t('site.instagram'), value: `${ig}@`, href: `https://instagram.com/${ig}`, icon: <InstagramIcon className="h-[18px] w-[18px] text-primary" /> });
  if (profile.address)
    rows.push({ key: 'addr', label: t('site.address'), value: profile.address, href: profile.mapUrl ?? undefined, icon: <PinIcon className="h-[18px] w-[18px] text-primary" /> });

  return (
    <section className="mt-10">
      <PublicSectionHead label={t('site.details_title')} />
      {deliveryText && (
        <div className="mb-3 flex items-center gap-2.5 rounded-[10px] border border-border bg-card px-4 py-3 text-[13.5px] font-semibold">
          <TruckIcon className="h-[18px] w-[18px] shrink-0 text-primary" />
          <span>{deliveryText}</span>
        </div>
      )}
      {rows.length > 0 && (
      <address className="block overflow-hidden rounded-[10px] border border-border bg-card not-italic">
        {rows.map((row, i) => {
          const value = (
            <span className={`ms-auto font-bold ${row.mono ? 'font-mono tracking-tight' : ''}`}>
              {row.value}
            </span>
          );
          return (
            <div
              key={row.key}
              className={`flex items-center gap-3 px-4 py-3 text-[14px] font-semibold ${
                i > 0 ? 'border-t-[1.5px] border-dashed border-border' : ''
              }`}
            >
              <span className="flex min-w-[104px] items-center gap-2.5 font-semibold text-muted-foreground">
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
