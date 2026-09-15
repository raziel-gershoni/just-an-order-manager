import { WhatsAppIcon } from './icons';

type Variant = 'solid' | 'outline' | 'light';

const VARIANTS: Record<Variant, string> = {
  solid: 'bg-success text-success-foreground shadow-[0_8px_20px_-10px_rgba(31,168,85,0.9)]',
  outline: 'border border-border text-foreground',
  light: 'bg-background text-success',
};

/**
 * The only way to order, so it is the only button on the page.
 *
 * Green, round and unmissable: the colour is doing recognition work here, not
 * decoration — it is the one thing a customer is looking for. Renders nothing
 * when no WhatsApp number is set, rather than a button that goes nowhere.
 */
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
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-3.5 text-[16px] font-bold transition-transform active:scale-[0.99] ${VARIANTS[variant]} ${className}`}
    >
      {whatsapp && <WhatsAppIcon className="h-[18px] w-[18px]" />}
      {label}
    </a>
  );
}
