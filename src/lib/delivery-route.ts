// Plans the delivery route: finds each stop's coordinates (cached on the
// customer, looked up by Google only when the text changed), asks for one driving
// matrix and solves the order. DB-free: the Google calls and the cache writes
// are injected, so it runs offline with fakes.
import type { GeocodeResult, LatLng } from '@/lib/google-maps';
import { MAX_MATRIX_POINTS, GoogleMapsError } from '@/lib/google-maps';
import { solvePath, googleMapsDirUrl } from '@/lib/route-order';

export type RouteStatus = 'ok' | 'empty' | 'no_home' | 'home_not_found' | 'too_many' | 'failed';
export type RouteAnswer = {
  status: RouteStatus;
  /** owner/manager: the hint says "settings", else "ask the manager" */
  canManage: boolean;
  /** route order, one entry per order ([] unless ok) */
  stops: { orderId: number; rough: boolean }[];
  /** order ids with no address or Google "none" (filled for ok) */
  unplaced: number[];
  maps: { url: string; partial: boolean } | null;
};
export type GeoCache = { lat: number | null; lng: number | null; query: string | null; rough: boolean };
export type PlanInput = {
  home: { text: string | null; cache: GeoCache };
  /** ordered by deliveryDate, id */
  orders: { orderId: number; customerId: number; text: string | null; cache: GeoCache }[];
  /** the delivered stop's customer, already validated */
  from: { customerId: number; text: string | null; cache: GeoCache } | null;
};
export type PlanDeps = {
  geocode(text: string): Promise<GeocodeResult>;
  matrix(points: LatLng[]): Promise<number[][]>;
  saveCustomerGeo(customerId: number, text: string, r: GeocodeResult): Promise<void>;
  saveHomeGeo(text: string, r: GeocodeResult): Promise<void>;
};
export type PlanResult = Omit<RouteAnswer, 'canManage'> & { log: Record<string, number | string> };

const empty = (status: RouteStatus, log: Record<string, number | string> = {}): PlanResult => ({
  status,
  stops: [],
  unplaced: [],
  maps: null,
  log,
});

// Two addresses a few metres apart are one stop: round to 5 decimals (~1 m).
const placeKey = (p: { lat: number; lng: number }) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

export async function planRoute(input: PlanInput, deps: PlanDeps): Promise<PlanResult> {
  if (input.orders.length === 0) return empty('empty');
  const homeText = input.home.text;
  if (!homeText) return empty('no_home');

  let fresh = 0;
  type Point = { kind: 'found'; lat: number; lng: number; rough: boolean } | { kind: 'none' };
  const fromCache = (text: string, c: GeoCache): Point | null => {
    if (c.query !== text) return null;
    return c.lat != null && c.lng != null
      ? { kind: 'found', lat: c.lat, lng: c.lng, rough: c.rough }
      : { kind: 'none' };
  };

  try {
    // Home first: without it nothing else is worth a Google call.
    let homePoint = fromCache(homeText, input.home.cache);
    if (!homePoint) {
      fresh++;
      homePoint = await deps.geocode(homeText);
      await deps.saveHomeGeo(homeText, homePoint);
    }
    if (homePoint.kind === 'none') return empty('home_not_found', { orders: input.orders.length });

    // One lookup per customer, all at once. A throw is never saved, so the next
    // open asks Google again instead of remembering a failure as "no address".
    const lookups = new Map<number, Promise<Point>>();
    const resolve = (customerId: number, text: string, cache: GeoCache): Promise<Point> => {
      let p = lookups.get(customerId);
      if (!p) {
        const cached = fromCache(text, cache);
        p =
          cached !== null
            ? Promise.resolve(cached)
            : (async () => {
                fresh++;
                const r = await deps.geocode(text);
                await deps.saveCustomerGeo(customerId, text, r);
                return r;
              })();
        lookups.set(customerId, p);
      }
      return p;
    };
    const points = await Promise.all(
      input.orders.map((o) => (o.text ? resolve(o.customerId, o.text, o.cache) : Promise.resolve(null)))
    );
    // The delivered stop only picks the start. If its address can't be looked
    // up right now, starting from home is still a good route, so that failure
    // alone doesn't throw the whole plan away.
    let fromPoint: GeocodeResult | null = null;
    if (input.from?.text) {
      try {
        fromPoint = await resolve(input.from.customerId, input.from.text, input.from.cache);
      } catch (e) {
        console.warn(
          '[delivery-route] the delivered stop could not be placed, starting from home:',
          e instanceof GoogleMapsError ? e.message : e
        );
      }
    }

    const unplaced: number[] = [];
    type Place = { lat: number; lng: number; rough: boolean; text: string; orderIds: number[] };
    const places = new Map<string, Place>();
    input.orders.forEach((o, i) => {
      const pt = points[i];
      if (!o.text || !pt || pt.kind !== 'found') {
        unplaced.push(o.orderId);
        return;
      }
      const key = placeKey(pt);
      const place = places.get(key);
      if (place) {
        place.orderIds.push(o.orderId);
        place.rough ||= pt.rough;
      } else {
        places.set(key, { lat: pt.lat, lng: pt.lng, rough: pt.rough, text: o.text, orderIds: [o.orderId] });
      }
    });
    const placeList = [...places.values()];
    const rough = placeList.filter((p) => p.rough).length;

    // The delivered stop starts the route, unless it is home itself or unplaceable.
    const startFrom =
      fromPoint && fromPoint.kind === 'found' && placeKey(fromPoint) !== placeKey(homePoint) ? fromPoint : null;
    const matrixPoints: LatLng[] = [
      { lat: homePoint.lat, lng: homePoint.lng },
      ...placeList.map((p) => ({ lat: p.lat, lng: p.lng })),
      ...(startFrom ? [{ lat: startFrom.lat, lng: startFrom.lng }] : []),
    ];
    const log = {
      orders: input.orders.length,
      places: placeList.length,
      fresh,
      rough,
      unplaced: unplaced.length,
      points: matrixPoints.length,
      start: startFrom ? 'stop' : 'home',
    };
    if (placeList.length === 0) return { ...empty('ok', log), unplaced };
    if (matrixPoints.length > MAX_MATRIX_POINTS) return empty('too_many', log);

    const m = await deps.matrix(matrixPoints);
    const startIdx = startFrom ? matrixPoints.length - 1 : 0;
    const order = solvePath(m, startIdx, 0, placeList.map((_, i) => i + 1));
    const ordered = order.map((idx) => placeList[idx - 1]);
    return {
      status: 'ok',
      stops: ordered.flatMap((p) => p.orderIds.map((orderId) => ({ orderId, rough: p.rough }))),
      unplaced,
      maps: googleMapsDirUrl(ordered.map((p) => p.text), homeText),
      log,
    };
  } catch (e) {
    // Google's messages and Postgres's carry neither addresses nor the key.
    console.error('[delivery-route] plan failed:', e instanceof Error ? e.message : e);
    return empty('failed', { orders: input.orders.length, fresh });
  }
}
