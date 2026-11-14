import pRetry, { AbortError } from 'p-retry';

/**
 * The one client of Google's Geocoding API and Routes API (computeRouteMatrix),
 * used by the delivery route order. Server only: it reads GOOGLE_MAPS_API_KEY,
 * which never goes to the browser.
 *
 * - Network failures, HTTP 429/5xx and geocode OVER_QUERY_LIMIT / UNKNOWN_ERROR
 *   are retried with backoff (p-retry, as in famcal.ts); any other answer fails
 *   at once. ZERO_RESULTS is not a failure: it is a definitive "no such place".
 * - Every failed attempt is logged with Google's code. The key, addresses and
 *   names are never logged.
 */

export type LatLng = { lat: number; lng: number };
export type GeocodeResult = { kind: 'found'; lat: number; lng: number; rough: boolean } | { kind: 'none' };

/** Most points one matrix request takes: 25 x 25 = 625 elements, Google's per-request cap. */
export const MAX_MATRIX_POINTS = 25;

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

/** `code` is Google's geocode status (REQUEST_DENIED, OVER_QUERY_LIMIT, …), or NO_KEY / NETWORK / BAD_ANSWER / TOO_MANY_POINTS / HTTP_<status> of ours. */
export class GoogleMapsError extends Error {
  constructor(readonly code: string, readonly status: number | null, message: string) {
    super(message);
    this.name = 'GoogleMapsError';
  }
}

/** Geocode statuses that are worth asking again; everything else won't change by waiting. */
const RETRYABLE_GEOCODE = new Set(['OVER_QUERY_LIMIT', 'UNKNOWN_ERROR']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Google's own words for a refusal ("This API project is not authorized to use
 * this API", "Routes API has not been used in project …"), cut short. They are
 * what tells a wrong key restriction from a disabled API during setup, and they
 * carry neither addresses nor the key.
 */
function reasonText(v: unknown): string {
  return typeof v === 'string' && v.trim() ? ` (${v.trim().slice(0, 200)})` : '';
}

/** The reason from a non-2xx body: geocode's `error_message`, or the Routes API's `{error:{status,message}}`. Best effort. */
async function httpReason(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (!isRecord(body)) return '';
    if (isRecord(body.error)) {
      return reasonText([body.error.status, body.error.message].filter((x) => typeof x === 'string').join(': '));
    }
    return reasonText(body.error_message);
  } catch (err) {
    console.warn(`[google-maps] a ${res.status} answer had no JSON body:`, err instanceof Error ? err.message : err);
    return '';
  }
}

/** Reads a geocode answer. "Rough" = the top result is a partial match or only APPROXIMATE (e.g. the town, for a moshav without street numbers). */
export function parseGeocode(body: unknown): GeocodeResult {
  if (!isRecord(body) || typeof body.status !== 'string') {
    throw new GoogleMapsError('BAD_ANSWER', null, 'geocode answered in an unknown shape');
  }
  if (body.status === 'ZERO_RESULTS') return { kind: 'none' };
  if (body.status !== 'OK') {
    throw new GoogleMapsError(body.status, null, `geocode answered ${body.status}${reasonText(body.error_message)}`);
  }
  const top = Array.isArray(body.results) ? body.results[0] : undefined;
  const geometry = isRecord(top) && isRecord(top.geometry) ? top.geometry : undefined;
  const location = geometry && isRecord(geometry.location) ? geometry.location : undefined;
  if (!isRecord(top) || !geometry || !location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    throw new GoogleMapsError('BAD_ANSWER', null, 'geocode answered OK without a usable result');
  }
  return {
    kind: 'found',
    lat: location.lat,
    lng: location.lng,
    rough: top.partial_match === true || geometry.location_type === 'APPROXIMATE',
  };
}

/** Reads a matrix answer into n x n seconds: 0 on the diagonal, Infinity for a pair with no route. A missing pair is a bad answer, not "unreachable". */
export function parseMatrix(body: unknown, n: number): number[][] {
  if (!Array.isArray(body)) throw new GoogleMapsError('BAD_ANSWER', null, 'matrix answered in an unknown shape');
  const m: (number | undefined)[][] = Array.from({ length: n }, () => Array<number | undefined>(n).fill(undefined));
  for (let i = 0; i < n; i++) m[i][i] = 0;
  for (const el of body) {
    if (!isRecord(el)) continue;
    const { originIndex: o, destinationIndex: d } = el;
    if (typeof o !== 'number' || typeof d !== 'number' || !(o in m) || !(d in m[o]) || o === d) continue;
    const failed = isRecord(el.status) && typeof el.status.code === 'number' && el.status.code !== 0;
    if (failed || el.condition === 'ROUTE_NOT_FOUND') {
      m[o][d] = Infinity;
      continue;
    }
    const secs = typeof el.duration === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(el.duration) : null;
    if (!secs) throw new GoogleMapsError('BAD_ANSWER', null, 'matrix element without a duration');
    m[o][d] = Number(secs[1]);
  }
  for (let o = 0; o < n; o++) {
    for (let d = 0; d < n; d++) {
      if (m[o][d] === undefined) throw new GoogleMapsError('BAD_ANSWER', null, 'matrix answer is missing a pair');
    }
  }
  return m as number[][];
}

function requireKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    console.error('[google-maps] GOOGLE_MAPS_API_KEY is not set');
    throw new GoogleMapsError('NO_KEY', null, 'GOOGLE_MAPS_API_KEY is not set');
  }
  return key;
}

/** Runs one request under the shared retry rules. `attempt` throws a plain error to be retried, or an AbortError to stop. */
async function withRetries<T>(what: string, attempt: () => Promise<T>): Promise<T> {
  try {
    return await pRetry(attempt, {
      retries: 3,
      factor: 2,
      minTimeout: 1000,
      randomize: true,
      onFailedAttempt: ({ error, attemptNumber, retriesLeft }) =>
        console.warn(`[google-maps] ${what} attempt ${attemptNumber} failed (${retriesLeft} retries left): ${error.message}`),
    });
  } catch (err) {
    if (err instanceof GoogleMapsError) throw err;
    // A network failure (DNS, refused, reset, TLS) that outlasted the retries.
    console.error(`[google-maps] ${what} could not be reached after the retries:`, err instanceof Error ? err.message : err);
    throw new GoogleMapsError('NETWORK', null, `${what} could not be reached: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function readJson(res: Response, what: string): Promise<unknown> {
  try {
    return await res.json();
  } catch (cause) {
    console.error(`[google-maps] ${what} answered with a body that is not JSON:`, cause instanceof Error ? cause.message : cause);
    throw new AbortError(new GoogleMapsError('BAD_ANSWER', res.status, `${what} answered with a body that is not JSON`));
  }
}

/** Looks one address up. `none` is a definitive "no results"; anything else that goes wrong throws, so callers never cache a failure as "none". */
export async function geocode(query: string): Promise<GeocodeResult> {
  const key = requireKey();
  const url = `${GEOCODE_URL}?${new URLSearchParams({ address: query, language: 'he', region: 'il', key })}`;
  return withRetries('geocode', async () => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      const err = new GoogleMapsError(`HTTP_${res.status}`, res.status, `geocode answered ${res.status}${await httpReason(res)}`);
      if (res.status === 429 || res.status >= 500) throw err;
      console.error(`[google-maps] geocode refused: ${err.message}`);
      throw new AbortError(err);
    }
    const body = await readJson(res, 'geocode');
    try {
      return parseGeocode(body);
    } catch (err) {
      if (!(err instanceof GoogleMapsError)) throw err;
      if (RETRYABLE_GEOCODE.has(err.code)) throw err; // retried; logged by onFailedAttempt
      console.error(`[google-maps] geocode failed: ${err.message}`);
      throw new AbortError(err);
    }
  });
}

/** Driving seconds between every pair of points (directed, no live traffic): `[from][to]`, Infinity where there is no route. */
export async function driveMatrix(points: LatLng[]): Promise<number[][]> {
  if (points.length > MAX_MATRIX_POINTS) {
    throw new GoogleMapsError('TOO_MANY_POINTS', null, `${points.length} points is over the ${MAX_MATRIX_POINTS} a matrix request takes`);
  }
  const key = requireKey();
  const waypoints = points.map((p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } }));
  const body = JSON.stringify({ origins: waypoints, destinations: waypoints, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' });
  return withRetries('matrix', async () => {
    const res = await fetch(MATRIX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,status,condition,duration',
      },
      body,
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = new GoogleMapsError(`HTTP_${res.status}`, res.status, `matrix answered ${res.status}${await httpReason(res)}`);
      if (res.status === 429 || res.status >= 500) throw err;
      console.error(`[google-maps] matrix refused: ${err.message}`);
      throw new AbortError(err);
    }
    try {
      return parseMatrix(await readJson(res, 'matrix'), points.length);
    } catch (err) {
      if (err instanceof GoogleMapsError) {
        console.error(`[google-maps] matrix failed: ${err.message}`);
        throw new AbortError(err);
      }
      throw err;
    }
  });
}
