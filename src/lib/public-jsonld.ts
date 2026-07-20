import type { PublicSite } from './public-site';
import { buildTelegramLink } from './public-site';

/**
 * Schema.org `Bakery` (a LocalBusiness / FoodEstablishment) node for the public
 * site. Emitting this is the textbook structured-data case for a neighborhood
 * bakery — it makes name/address/phone/price-range and the full pricelist
 * machine-readable for rich results and Maps/knowledge-panel linkage, including
 * the per-size prices that otherwise live only inside a client-side modal.
 *
 * Everything is conditional on real data; nothing is fabricated.
 */
export function buildBakeryJsonLd(
  site: PublicSite,
  baseUrl: string
): Record<string, unknown> {
  const { profile, catalog } = site;

  const prices = catalog
    .flatMap((b) => b.sizes.map((s) => Number(s.price)))
    .filter((n) => Number.isFinite(n) && n > 0);
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;

  const sameAs: string[] = [];
  const ig = profile.instagram?.replace(/^@/, '').trim();
  if (ig) sameAs.push(`https://instagram.com/${ig}`);
  const tg = buildTelegramLink(process.env.NEXT_PUBLIC_BOT_USERNAME);
  if (tg) sameAs.push(tg);

  const images = [profile.heroImage?.url, profile.logoUrl].filter(
    (v): v is string => !!v
  );

  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Bakery',
    '@id': `${baseUrl}/#bakery`,
    name: profile.displayName,
    url: baseUrl,
    currenciesAccepted: 'ILS',
  };

  const desc =
    profile.tagline?.trim() ||
    profile.story?.trim() ||
    profile.heroHeadline?.trim();
  if (desc) data.description = desc;
  if (images.length) data.image = images;
  if (profile.logoUrl) data.logo = profile.logoUrl;

  const tel = profile.contactPhone?.trim() || profile.whatsappPhone?.trim();
  if (tel) data.telephone = tel;

  const city = profile.pickupArea?.trim();
  const street = profile.address?.trim();
  if (street || city) {
    data.address = {
      '@type': 'PostalAddress',
      ...(street ? { streetAddress: street } : {}),
      ...(city ? { addressLocality: city } : {}),
      addressCountry: 'IL',
    };
  }
  if (city) data.areaServed = city;
  if (profile.mapUrl?.trim()) data.hasMap = profile.mapUrl.trim();
  if (sameAs.length) data.sameAs = sameAs;
  if (min != null && max != null) {
    data.priceRange = min === max ? `₪${min}` : `₪${min}–₪${max}`;
  }

  if (catalog.length) {
    data.hasMenu = {
      '@type': 'Menu',
      hasMenuSection: {
        '@type': 'MenuSection',
        name: 'מחירון',
        hasMenuItem: catalog.map((b) => {
          const item: Record<string, unknown> = {
            '@type': 'MenuItem',
            name: b.name,
          };
          if (b.description?.trim()) item.description = b.description.trim();
          if (b.image?.url) item.image = b.image.url;
          const offers = b.sizes.flatMap((s) => {
            const single = Number(s.price);
            if (!Number.isFinite(single) || single <= 0) return [];
            const sizeName = s.name?.trim();
            const rows: Record<string, unknown>[] = [
              {
                '@type': 'Offer',
                ...(sizeName ? { name: sizeName } : {}),
                price: single,
                priceCurrency: 'ILS',
                availability: 'https://schema.org/InStock',
              },
            ];
            // Bulk tiers as per-unit offers gated on a minimum quantity — the
            // standard schema.org encoding for a "buy N, save" deal.
            for (const d of s.deals) {
              const each = Number(d.eachPrice);
              if (!Number.isFinite(each) || each <= 0) continue;
              rows.push({
                '@type': 'Offer',
                name: `${sizeName ? `${sizeName} ` : ''}×${d.minQty}`,
                price: each,
                priceCurrency: 'ILS',
                eligibleQuantity: { '@type': 'QuantitativeValue', minValue: d.minQty },
                availability: 'https://schema.org/InStock',
              });
            }
            return rows;
          });
          if (offers.length) item.offers = offers;
          return item;
        }),
      },
    };
  }

  return data;
}
