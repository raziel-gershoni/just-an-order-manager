import { t } from '@/lib/i18n';
import { PublicSectionHead } from './PublicSectionHead';

export function StorySection({
  story,
  signature,
}: {
  story: string;
  signature: string;
}) {
  return (
    <section className="mt-10">
      <PublicSectionHead label={t('site.story_title')} />
      <div className="relative rounded-[10px] border border-border bg-card p-[18px]">
        <span className="pointer-events-none absolute right-4 top-5 font-display text-[42px] leading-[0] text-muted">
          ”
        </span>
        <div className="space-y-2.5 text-[14.5px] font-medium leading-[1.65] text-[#3A3026]">
          {story.split(/\n+/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
        <div className="mt-3.5 font-display text-[15px] font-semibold text-primary">
          — {signature}
        </div>
      </div>
    </section>
  );
}
