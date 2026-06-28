import type { MetadataRoute } from 'next';
import { siteBaseUrl } from '@/lib/site-url';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteBaseUrl();
  return [{ url: `${base}/`, changeFrequency: 'weekly', priority: 1 }];
}
