// Delivery route helpers. Pure (no db, no Google client), so the deliveries
// screen can import them too and they can be exercised offline.

/** The text a stop is looked up by (Google geocode, Waze, Maps link): address and
 *  city joined, null when both are empty. One definition so they never drift. */
export function geoQueryText(
  address: string | null | undefined,
  city: string | null | undefined
): string | null {
  const parts = [address?.trim(), city?.trim()].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

// An unreachable pair (Infinity) becomes a large finite cost so sums stay
// comparable and a route that avoids it always wins.
const BIG = 1e9;
const EXACT_MAX = 8;

/**
 * The order of `visit` with the least driving from `start`, through every point,
 * to `end` (`start` and `end` may be the same point: a round trip from home).
 * `m[a][b]` is the drive from a to b and need not be symmetric.
 * Up to 8 points every order is tried (8! = 40320, instant); above that it is
 * nearest-neighbour then 2-opt, which is near-optimal at delivery sizes.
 */
export function solvePath(m: number[][], start: number, end: number, visit: number[]): number[] {
  if (visit.length === 0) return [];
  const c = (a: number, b: number) => (Number.isFinite(m[a][b]) ? m[a][b] : BIG);
  const pathCost = (order: number[]) => {
    let total = 0;
    let prev = start;
    for (const v of order) {
      total += c(prev, v);
      prev = v;
    }
    return total + c(prev, end);
  };

  if (visit.length <= EXACT_MAX) {
    let bestOrder = visit;
    let bestCost = pathCost(visit);
    const cur: number[] = [];
    const used = new Array<boolean>(visit.length).fill(false);
    // Depth-first over every order, dropping a branch already no better than the best.
    const walk = (prev: number, sofar: number) => {
      if (sofar >= bestCost) return;
      if (cur.length === visit.length) {
        const total = sofar + c(prev, end);
        if (total < bestCost) {
          bestCost = total;
          bestOrder = [...cur];
        }
        return;
      }
      for (let i = 0; i < visit.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        cur.push(visit[i]);
        walk(visit[i], sofar + c(prev, visit[i]));
        cur.pop();
        used[i] = false;
      }
    };
    walk(start, 0);
    return bestOrder;
  }

  // Nearest neighbour for a start, then 2-opt on the open path. Segment reversal
  // changes direction, which is fine because the cost is recomputed in full
  // (the matrix may be asymmetric).
  const left = new Set(visit);
  let order: number[] = [];
  let prev = start;
  while (left.size) {
    let pick = -1;
    for (const v of left) if (pick < 0 || c(prev, v) < c(prev, pick)) pick = v;
    order.push(pick);
    left.delete(pick);
    prev = pick;
  }
  let cost = pathCost(order);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const next = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        const nextCost = pathCost(next);
        if (nextCost < cost) {
          order = next;
          cost = nextCost;
          improved = true;
        }
      }
    }
  }
  return order;
}

/**
 * One Google Maps link that drives the remaining stops in order from the phone's
 * current location (no `origin`). A phone allows at most 3 waypoints: with 3
 * stops or fewer the way home is the destination; with more, the link covers the
 * first 4 stops (3 waypoints + the 4th as destination) and `partial` is true, so
 * pressing it again after those are delivered carries on.
 */
export function googleMapsDirUrl(
  stops: string[],
  home: string
): { url: string; partial: boolean } | null {
  if (stops.length === 0) return null;
  const partial = stops.length > 3;
  const waypoints = partial ? stops.slice(0, 3) : stops;
  const destination = partial ? stops[3] : home;
  const params = new URLSearchParams({ destination });
  if (waypoints.length) params.set('waypoints', waypoints.join('|'));
  params.set('travelmode', 'driving');
  params.set('dir_action', 'navigate');
  return { url: `https://www.google.com/maps/dir/?api=1&${params.toString()}`, partial };
}
