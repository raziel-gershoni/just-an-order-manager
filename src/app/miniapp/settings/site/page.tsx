'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { ControlCenterTabs } from '@/components/ui/ControlCenterTabs';
import { SectionManager } from '@/components/site-editor/SectionManager';
import { MediaLibrary } from '@/components/site-editor/MediaLibrary';
import type { SectionConfig } from '@/db/schema';
import { Eye, EyeOff, ExternalLink } from 'lucide-react';

interface SiteProfile {
  isPublished: boolean;
  displayName: string | null;
  tagline: string | null;
  heroHeadline: string | null;
  story: string | null;
  trustItems: string[] | null;
  whatsappPhone: string | null;
  contactPhone: string | null;
  instagram: string | null;
  address: string | null;
  mapUrl: string | null;
  bakeDays: string | null;
  pickupArea: string | null;
  heroImageId: number | null;
  sections: SectionConfig[];
}

type FormState = {
  displayName: string;
  tagline: string;
  heroHeadline: string;
  story: string;
  trustText: string;
  whatsappPhone: string;
  contactPhone: string;
  instagram: string;
  address: string;
  mapUrl: string;
  bakeDays: string;
  pickupArea: string;
};

const EMPTY_FORM: FormState = {
  displayName: '',
  tagline: '',
  heroHeadline: '',
  story: '',
  trustText: '',
  whatsappPhone: '',
  contactPhone: '',
  instagram: '',
  address: '',
  mapUrl: '',
  bakeDays: '',
  pickupArea: '',
};

const orNull = (v: string) => (v.trim() ? v.trim() : null);

export default function SiteEditorPage() {
  const { apiFetch } = useApi();
  const { activeGroupRole } = useGroup();
  const t = useT();
  const toast = useToast();
  const isBaker = activeGroupRole === 'baker';

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [published, setPublished] = useState(false);
  const [heroImageId, setHeroImageId] = useState<number | null>(null);
  const [sections, setSections] = useState<SectionConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const SECTION_LABELS: Record<string, string> = {
    hero: t('site.section_hero'),
    gallery: t('site.section_gallery'),
    pricelist: t('site.section_pricelist'),
    story: t('site.section_story'),
    details: t('site.section_details'),
    cta: t('site.section_cta'),
  };

  // Sections the editor can tell are empty (and thus auto-hidden on the site).
  const emptyKeys = new Set<string>();
  if (!form.story.trim()) emptyKeys.add('story');
  if (!form.whatsappPhone.trim()) emptyKeys.add('cta');
  if (
    !form.bakeDays.trim() &&
    !form.pickupArea.trim() &&
    !form.whatsappPhone.trim() &&
    !form.contactPhone.trim() &&
    !form.instagram.trim() &&
    !form.address.trim()
  )
    emptyKeys.add('details');

  const set = <K extends keyof FormState>(key: K, value: string) =>
    setForm((p) => ({ ...p, [key]: value }));

  function hydrate(p: SiteProfile) {
    setForm({
      displayName: p.displayName ?? '',
      tagline: p.tagline ?? '',
      heroHeadline: p.heroHeadline ?? '',
      story: p.story ?? '',
      trustText: (p.trustItems ?? []).join(', '),
      whatsappPhone: p.whatsappPhone ?? '',
      contactPhone: p.contactPhone ?? '',
      instagram: p.instagram ?? '',
      address: p.address ?? '',
      mapUrl: p.mapUrl ?? '',
      bakeDays: p.bakeDays ?? '',
      pickupArea: p.pickupArea ?? '',
    });
    setPublished(p.isPublished);
    setHeroImageId(p.heroImageId ?? null);
    if (Array.isArray(p.sections)) setSections(p.sections);
  }

  async function setHero(id: number | null) {
    setHeroImageId(id); // optimistic
    try {
      await apiFetch('/site-profile', {
        method: 'PATCH',
        body: JSON.stringify({ heroImageId: id }),
      });
    } catch {
      toast.error(t('site.save_failed'));
    }
  }

  async function persistSections(next: SectionConfig[]) {
    setSections(next); // optimistic
    try {
      await apiFetch('/site-profile', {
        method: 'PATCH',
        body: JSON.stringify({ sections: next }),
      });
    } catch {
      toast.error(t('site.save_failed'));
    }
  }

  useEffect(() => {
    apiFetch<{ profile: SiteProfile }>('/site-profile')
      .then((r) => hydrate(r.profile))
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setSaving(true);
    try {
      const payload = {
        displayName: orNull(form.displayName),
        tagline: orNull(form.tagline),
        heroHeadline: orNull(form.heroHeadline),
        story: orNull(form.story),
        trustItems: form.trustText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8),
        whatsappPhone: orNull(form.whatsappPhone),
        contactPhone: orNull(form.contactPhone),
        instagram: orNull(form.instagram),
        address: orNull(form.address),
        mapUrl: orNull(form.mapUrl),
        bakeDays: orNull(form.bakeDays),
        pickupArea: orNull(form.pickupArea),
      };
      const { profile } = await apiFetch<{ profile: SiteProfile }>('/site-profile', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      hydrate(profile);
      toast.success(t('site.saved'));
    } catch {
      toast.error(t('site.save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish() {
    const next = !published;
    setPublished(next); // optimistic
    try {
      await apiFetch('/site-profile', {
        method: 'PATCH',
        body: JSON.stringify({ isPublished: next }),
      });
      toast.success(next ? t('site.published_on') : t('site.published_off'));
    } catch {
      setPublished(!next);
      toast.error(t('site.save_failed'));
    }
  }

  if (isBaker) {
    return (
      <>
        <PageHeader title={t('site.editor_title')} />
        <ControlCenterTabs />
        <div className="p-5 text-sm text-muted-foreground">—</div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('site.editor_title')} />
      <ControlCenterTabs />

      {loading ? (
        <div className="p-5">
          <div className="h-40 rounded-xl bg-muted animate-pulse" />
        </div>
      ) : (
        <div className="space-y-4 p-5">
          {/* Publish + open */}
          <Card className="flex items-center justify-between p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-semibold">
                {published ? (
                  <Eye className="h-4 w-4 text-success" />
                ) : (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                )}
                {published ? t('site.published_on') : t('site.published_off')}
              </div>
              <a
                href="/"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary"
              >
                <ExternalLink className="h-3 w-3" />
                {t('site.open_public')}
              </a>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={published}
              onClick={togglePublish}
              className={
                'relative h-7 w-12 flex-none rounded-full transition-colors ' +
                (published ? 'bg-success' : 'bg-muted')
              }
            >
              <span
                className={
                  'absolute top-1 h-5 w-5 rounded-full bg-card shadow transition-all ' +
                  (published ? 'start-6' : 'start-1')
                }
              />
            </button>
          </Card>

          {/* Content fields */}
          <Card className="space-y-3 p-4">
            <Input label={t('site.f_display_name')} value={form.displayName} onChange={(e) => set('displayName', e.target.value)} />
            <Input label={t('site.f_tagline')} value={form.tagline} onChange={(e) => set('tagline', e.target.value)} />
            <Input label={t('site.f_headline')} value={form.heroHeadline} onChange={(e) => set('heroHeadline', e.target.value)} />
            <TextArea label={t('site.f_story')} value={form.story} onChange={(e) => set('story', e.target.value)} />
            <Input label={t('site.f_trust')} value={form.trustText} onChange={(e) => set('trustText', e.target.value)} />
          </Card>

          {/* Media library + hero image */}
          <Card className="p-4">
            <MediaLibrary heroImageId={heroImageId} onSetHero={setHero} />
          </Card>

          {/* Sections — reorder + hide */}
          <Card className="p-4">
            <div className="mb-1 text-sm font-semibold text-muted-foreground">
              {t('site.sections_title')}
            </div>
            <SectionManager
              sections={sections}
              labels={SECTION_LABELS}
              emptyKeys={emptyKeys}
              onChange={persistSections}
            />
          </Card>

          {/* Contact + logistics */}
          <Card className="space-y-3 p-4">
            <Input label={t('site.f_bake_days')} value={form.bakeDays} onChange={(e) => set('bakeDays', e.target.value)} />
            <Input label={t('site.f_pickup')} value={form.pickupArea} onChange={(e) => set('pickupArea', e.target.value)} />
            <Input label={t('site.f_whatsapp')} inputMode="tel" value={form.whatsappPhone} onChange={(e) => set('whatsappPhone', e.target.value)} />
            <Input label={t('site.f_phone')} inputMode="tel" value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
            <Input label={t('site.f_instagram')} value={form.instagram} onChange={(e) => set('instagram', e.target.value)} />
            <Input label={t('site.f_address')} value={form.address} onChange={(e) => set('address', e.target.value)} />
            <Input label={t('site.f_map')} inputMode="url" value={form.mapUrl} onChange={(e) => set('mapUrl', e.target.value)} />
          </Card>

          <div className="sticky bottom-4">
            <Button className="w-full" onClick={save} loading={saving}>
              {t('site.save')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
