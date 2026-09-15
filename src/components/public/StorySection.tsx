import { t } from '@/lib/i18n';
import { PublicSectionHead } from './PublicSectionHead';

/**
 * Who bakes this, in their own words.
 *
 * No card, no border, no oversized quotation mark hanging in the corner — the
 * story is the only thing on this part of the page, so it does not need
 * anything drawn around it to be found. Set in the serif at a reading size,
 * which is the one place on the page where that face gets to behave like the
 * book type it is.
 */
export function StorySection({
  story,
  signature,
}: {
  story: string;
  signature: string;
}) {
  return (
    <section className="mt-12">
      <PublicSectionHead label={t('site.story_title')} />
      <div className="site-display space-y-3 text-[17px] leading-[1.75]">
        {story.split(/\n+/).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
      <div className="mt-4 text-[14px] font-semibold text-primary">— {signature}</div>
    </section>
  );
}
