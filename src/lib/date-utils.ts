import { nextFriday, format, startOfDay, endOfDay, addDays } from 'date-fns';

export function getNextShabbatDate(): Date {
  const today = new Date();
  const day = today.getDay();
  // If today is Friday, return today; otherwise next Friday
  if (day === 5) return startOfDay(today);
  return startOfDay(nextFriday(today));
}

export function resolveDeliveryDate(
  deliveryType: string,
  specificDate?: string
): string | null {
  switch (deliveryType) {
    case 'shabbat':
      return format(getNextShabbatDate(), 'yyyy-MM-dd');
    case 'specific_date':
      return specificDate || null;
    case 'asap':
      return format(new Date(), 'yyyy-MM-dd');
    case 'weekly':
      return format(getNextShabbatDate(), 'yyyy-MM-dd');
    default:
      return null;
  }
}

export function formatDateRelative(dateStr: string, lang: 'en' | 'he'): string {
  const date = startOfDay(new Date(dateStr + 'T00:00:00'));
  const today = startOfDay(new Date());
  const diffDays = Math.round(
    (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) return lang === 'he' ? 'היום' : 'Today';
  if (diffDays === 1) return lang === 'he' ? 'מחר' : 'Tomorrow';
  if (diffDays === -1) return lang === 'he' ? 'אתמול' : 'Yesterday';

  // Day name for this week
  if (diffDays > 0 && diffDays <= 6) {
    const dayNames =
      lang === 'he'
        ? ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
        : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return dayNames[date.getDay()];
  }

  return format(date, 'dd/MM');
}

export function getTodayRange() {
  const today = new Date();
  return {
    start: startOfDay(today),
    end: endOfDay(today),
  };
}

export function getWeekRange() {
  const today = new Date();
  return {
    start: startOfDay(today),
    end: endOfDay(addDays(today, 7)),
  };
}
