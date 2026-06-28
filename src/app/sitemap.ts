import type { MetadataRoute } from 'next';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { bakeryProfile } from '@/db/schema';
import { siteBaseUrl } from '@/lib/site-url';
import { publicGroupId } from '@/lib/public-site';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteBaseUrl();

  // Freshness signal from the bakery profile's last edit. Best-effort: if the
  // DB is unavailable (e.g. at build), still emit the URL without lastModified.
  let lastModified: Date | undefined;
  try {
    const [row] = await db
      .select({ updatedAt: bakeryProfile.updatedAt })
      .from(bakeryProfile)
      .where(eq(bakeryProfile.groupId, publicGroupId()))
      .limit(1);
    lastModified = row?.updatedAt ?? undefined;
  } catch {
    // ignore — omit lastModified
  }

  return [{ url: `${base}/`, lastModified, changeFrequency: 'weekly', priority: 1 }];
}
