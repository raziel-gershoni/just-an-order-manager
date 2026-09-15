import Image from 'next/image';
import { t } from '@/lib/i18n';
import type { PublicImage } from '@/lib/public-site';
import { PublicSectionHead } from './PublicSectionHead';

/**
 * The photos, given room.
 *
 * An odd count leads with a wide one and the rest pair off, so the grid never
 * ends on a lonely tile. Borders are gone: a picture of bread does not need a
 * frame drawn around it to read as a picture of bread.
 */
export function GallerySection({
  images,
  name,
}: {
  images: PublicImage[];
  name: string;
}) {
  const fallbackAlt = `${name} — לחם מחמצת`;
  return (
    <section className="mt-12">
      <PublicSectionHead label={t('site.gallery_title')} />
      <div className="grid grid-cols-2 gap-2.5">
        {images.map((img, i) => {
          const wide = i === 0 && images.length % 2 === 1;
          return (
            <div
              key={i}
              className={`relative overflow-hidden rounded-[5px] bg-card ${
                wide ? 'col-span-2 aspect-[16/10]' : 'aspect-square'
              }`}
            >
              <Image
                src={img.url}
                alt={img.alt?.trim() || fallbackAlt}
                fill
                sizes={wide ? '(max-width: 520px) 100vw, 520px' : '(max-width: 520px) 50vw, 250px'}
                className="object-cover"
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
