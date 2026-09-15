/**
 * A section's name, and nothing else.
 *
 * It used to be a label, a dashed rule running to the edge and a monospace
 * note — three devices to say one word. The rules were the loudest thing on a
 * page selling bread, so they are gone; the serif and the space around it do
 * the separating now.
 */
export function PublicSectionHead({
  label,
  meta,
}: {
  label: string;
  meta?: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="site-display text-[23px] font-bold leading-tight">{label}</h2>
      {meta && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{meta}</p>}
    </div>
  );
}
