import {
  Flame,
  Star,
  Sparkles,
  Crown,
  Heart,
  ThumbsUp,
  Wheat,
  Leaf,
  Clock,
  Award,
  Zap,
  Croissant,
  type LucideIcon,
} from 'lucide-react';

// Curated icon set selectable for badges. Keys are stored in the DB
// (bread_types.badge_icon / bread_type_sizes.badge_icon).
export const BADGE_ICONS: Record<string, LucideIcon> = {
  flame: Flame,
  star: Star,
  sparkles: Sparkles,
  crown: Crown,
  heart: Heart,
  thumbs_up: ThumbsUp,
  wheat: Wheat,
  leaf: Leaf,
  clock: Clock,
  award: Award,
  zap: Zap,
  croissant: Croissant,
};

export const BADGE_ICON_KEYS = Object.keys(BADGE_ICONS);

export function badgeIconComponent(key: string | null | undefined): LucideIcon | null {
  if (!key) return null;
  return BADGE_ICONS[key] ?? null;
}
