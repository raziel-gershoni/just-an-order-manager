import { WhatsAppIcon } from './icons';

type Variant = 'solid' | 'outline' | 'light';

const VARIANTS: Record<Variant, string> = {
  solid: 'bg-success text-[#F1F4EA] shadow-[0_2px_0_rgba(0,0,0,0.18)]',
  outline: 'border-[1.5px] border-border text-foreground',
  light: 'bg-[#F1F4EA] text-success',
};

/** Primary order action. Renders nothing if there's no link (no WhatsApp set). */
export function WhatsAppButton({
  href,
  label,
  variant = 'solid',
  className = '',
  whatsapp = true,
}: {
  href: string | null;
  label: string;
  variant?: Variant;
  className?: string;
  whatsapp?: boolean;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-[15px] font-bold ${VARIANTS[variant]} ${className}`}
    >
      {whatsapp && <WhatsAppIcon className="h-4 w-4" />}
      {label}
    </a>
  );
}
