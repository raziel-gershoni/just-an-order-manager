import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { orders, customers, groups } from '@/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { openDeliveriesWhere } from '@/lib/open-deliveries';
import { geoQueryText } from '@/lib/route-order';
import { planRoute, type GeoCache, type RouteAnswer } from '@/lib/delivery-route';
import { geocode, driveMatrix, type GeocodeResult } from '@/lib/google-maps';

// The open deliveries in least-driving order from home and back (the deliveries
// screen applies it to its own list). Every outcome, a Google failure included,
// is a 200 with a status: the screen falls back to its date-grouped list.
// ?from=<orderId>: a delivered order of this group whose address starts the route.
export const GET = withGroup(async (request, auth, groupId) => {
  const role = auth.memberships.find((m) => m.groupId === groupId)?.role;
  if (role !== 'owner' && role !== 'manager' && role !== 'driver') {
    return errorResponse('Forbidden', 403);
  }

  const cacheOf = (r: {
    lat: number | null;
    lng: number | null;
    query: string | null;
    rough: boolean;
  }): GeoCache => r;

  const [group] = await db
    .select({
      address: groups.deliveryHomeAddress,
      city: groups.deliveryHomeCity,
      lat: groups.homeGeoLat,
      lng: groups.homeGeoLng,
      query: groups.homeGeoQuery,
      rough: groups.homeGeoRough,
    })
    .from(groups)
    .where(eq(groups.id, groupId));

  const rows = await db
    .select({
      orderId: orders.id,
      customerId: customers.id,
      address: customers.address,
      city: customers.city,
      lat: customers.geoLat,
      lng: customers.geoLng,
      query: customers.geoQuery,
      rough: customers.geoRough,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(openDeliveriesWhere(groupId))
    .orderBy(asc(orders.deliveryDate), asc(orders.id));

  // Only a delivered delivery of this group may start the route; anything else
  // in the query is ignored and the route starts at home.
  let from: Parameters<typeof planRoute>[0]['from'] = null;
  const fromId = Number(new URL(request.url).searchParams.get('from'));
  if (Number.isInteger(fromId) && fromId > 0) {
    const [f] = await db
      .select({
        customerId: customers.id,
        address: customers.address,
        city: customers.city,
        lat: customers.geoLat,
        lng: customers.geoLng,
        query: customers.geoQuery,
        rough: customers.geoRough,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(
        and(
          eq(orders.id, fromId),
          eq(orders.groupId, groupId),
          eq(orders.isDelivery, true),
          eq(orders.status, 'delivered')
        )
      );
    if (f) from = { customerId: f.customerId, text: geoQueryText(f.address, f.city), cache: cacheOf(f) };
  }

  // Nothing is written by a Google failure: a throw never reaches these.
  const saveCustomerGeo = async (customerId: number, text: string, r: GeocodeResult) => {
    await db
      .update(customers)
      .set({
        geoLat: r.kind === 'found' ? r.lat : null,
        geoLng: r.kind === 'found' ? r.lng : null,
        geoQuery: text,
        geoRough: r.kind === 'found' ? r.rough : false,
      })
      .where(and(eq(customers.id, customerId), eq(customers.groupId, groupId)));
  };
  const saveHomeGeo = async (text: string, r: GeocodeResult) => {
    await db
      .update(groups)
      .set({
        homeGeoLat: r.kind === 'found' ? r.lat : null,
        homeGeoLng: r.kind === 'found' ? r.lng : null,
        homeGeoQuery: text,
        homeGeoRough: r.kind === 'found' ? r.rough : false,
      })
      .where(eq(groups.id, groupId));
  };

  // A city alone is not a home: the address must be filled in.
  const homeText = group?.address?.trim() ? geoQueryText(group.address, group.city) : null;
  const canManage = role === 'owner' || role === 'manager';

  // planRoute never throws: every failure comes back as status 'failed', logged.
  const { log, ...plan } = await planRoute(
      {
        home: { text: homeText, cache: group ? cacheOf(group) : { lat: null, lng: null, query: null, rough: false } },
        orders: rows.map((r) => ({
          orderId: r.orderId,
          customerId: r.customerId,
          text: geoQueryText(r.address, r.city),
          cache: cacheOf(r),
        })),
        from,
      },
      { geocode, matrix: driveMatrix, saveCustomerGeo, saveHomeGeo }
    );
  console.log(
    `[delivery-route] group=${groupId} status=${plan.status} ` +
      Object.entries(log).map(([k, v]) => `${k}=${v}`).join(' ')
  );
  const answer: RouteAnswer = { ...plan, canManage };
  return jsonResponse(answer);
});
