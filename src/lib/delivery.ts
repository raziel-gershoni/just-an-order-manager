// Delivery zone + fee logic. Pure functions — safe on client and server.

export type DeliverySettings = {
  enabled: boolean;
  homeCity: string | null;
  fee: number; // flat fee for listed cities
  freeOver: number | null; // free when items subtotal >= this
  cities: string[]; // listed (paid) cities
};

/** Normalize a city name for matching: trim, collapse spaces, drop maqaf/hyphens. */
export function normalizeCity(s: string | null | undefined): string {
  return (s ?? '')
    .trim()
    .replace(/[־\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export type CityClass = {
  available: boolean; // delivery offered to this city (home or listed)
  isHome: boolean;
  fee: number; // base flat fee (0 for home), before the free-over check
};

/** Classify a customer city against the delivery settings. */
export function classifyCity(
  city: string | null | undefined,
  s: DeliverySettings
): CityClass {
  if (!s.enabled) return { available: false, isHome: false, fee: 0 };
  const n = normalizeCity(city);
  if (!n) return { available: false, isHome: false, fee: 0 };
  if (s.homeCity && normalizeCity(s.homeCity) === n) {
    return { available: true, isHome: true, fee: 0 };
  }
  if ((s.cities ?? []).some((c) => normalizeCity(c) === n)) {
    return { available: true, isHome: false, fee: s.fee };
  }
  return { available: false, isHome: false, fee: 0 };
}

/** The actual fee given the subtotal (free-over) and an optional manual override
 *  (used for cities not in the list). */
export function resolveDeliveryFee(opts: {
  city: string | null | undefined;
  subtotal: number;
  settings: DeliverySettings;
  manualFee?: number | null;
}): number {
  const { city, subtotal, settings, manualFee } = opts;
  const c = classifyCity(city, settings);
  if (c.isHome) return 0;
  if (c.available) {
    if (settings.freeOver != null && subtotal >= settings.freeOver) return 0;
    return settings.fee;
  }
  return manualFee != null && manualFee > 0 ? manualFee : 0;
}

/** Waze deep link to a text address (no geocoding). Null if nothing to navigate to. */
export function buildWazeLink(
  address: string | null | undefined,
  city: string | null | undefined
): string | null {
  const parts = [address?.trim(), city?.trim()].filter(Boolean);
  if (!parts.length) return null;
  return `https://waze.com/ul?q=${encodeURIComponent(parts.join(', '))}&navigate=yes`;
}
