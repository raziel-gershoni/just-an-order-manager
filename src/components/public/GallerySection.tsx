import { t } from '@/lib/i18n';
import type { PublicImage } from '@/lib/public-site';
import { PublicSectionHead } from './PublicSectionHead';

export function GallerySection({ images }: { images: PublicImage[] }) {
  return (
    <section className="mt-10">
      <PublicSectionHead label={t('site.gallery_title')} />
      <div className="grid grid-cols-2 gap-2.5">
        {images.map((img, i) => (
          <div
            key={i}
            className={`overflow-hidden rounded-[10px] border border-border bg-card ${
              i === 0 && images.length % 2 === 1 ? 'col-span-2' : ''
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.alt ?? ''}
              className="aspect-[4/3] h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
