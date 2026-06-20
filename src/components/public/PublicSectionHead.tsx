/** DOCKET section separator: label + dashed rule + optional mono meta note. */
export function PublicSectionHead({
  label,
  meta,
}: {
  label: string;
  meta?: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="whitespace-nowrap font-display text-[20px] font-bold tracking-tight">
        {label}
      </span>
      <span className="flex-1 border-t-[1.5px] border-dashed border-border" />
      {meta && (
        <span className="whitespace-nowrap font-mono text-[11px] font-semibold text-muted-foreground">
          {meta}
        </span>
      )}
    </div>
  );
}
