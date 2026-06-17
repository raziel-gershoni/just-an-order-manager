/** A template candidate for rotation: only the id matters here. */
export interface RotatableTemplate {
  id: number;
}

/**
 * Pick the next template for a (customer, occasion) round-robin.
 * @param templates active templates for the occasion, sorted by sortOrder asc
 * @param lastTemplateId the templateId of this customer's most recent send for
 *   the occasion, or null if they've never been reminded for it
 * Returns the template AFTER lastTemplateId (wrapping), the first when there is
 * no history, or null when there are no templates. If lastTemplateId is no
 * longer among the active templates, restarts from the first.
 */
export function pickNextTemplate<T extends RotatableTemplate>(
  templates: T[],
  lastTemplateId: number | null
): T | null {
  if (templates.length === 0) return null;
  if (lastTemplateId == null) return templates[0];
  const idx = templates.findIndex((t) => t.id === lastTemplateId);
  if (idx === -1) return templates[0];
  return templates[(idx + 1) % templates.length];
}
