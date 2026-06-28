import Image from 'next/image';
import { t } from '@/lib/i18n';
import type { PublicImage } from '@/lib/public-site';
import { PublicSectionHead } from './PublicSectionHead';

export function GallerySection({
  images,
  name,
}: {
  images: PublicImage[];
  name: string;
}) {
  const fallbackAlt = `${name} — לחם מחמצת`;
  return (
    <section className="mt-10">
      <PublicSectionHead label={t('site.gallery_title')} />
      <div className="grid grid-cols-2 gap-2.5">
        {images.map((img, i) => (
          <div
            key={i}
            className={`relative aspect-[4/3] overflow-hidden rounded-[10px] border border-border bg-card ${
              i === 0 && images.length % 2 === 1 ? 'col-span-2' : ''
            }`}
          >
            <Image
              src={img.url}
              alt={img.alt?.trim() || fallbackAlt}
              fill
              sizes="(max-width: 480px) 50vw, 240px"
              className="object-cover"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
