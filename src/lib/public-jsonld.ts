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
          const offers = b.sizes
            .filter((s) => Number.isFinite(Number(s.price)) && Number(s.price) > 0)
            .map((s) => ({
              '@type': 'Offer',
              ...(s.name?.trim() ? { name: s.name.trim() } : {}),
              price: Number(s.price),
              priceCurrency: 'ILS',
              availability: 'https://schema.org/InStock',
            }));
          if (offers.length) item.offers = offers;
          return item;
        }),
      },
    };
  }

  return data;
}
