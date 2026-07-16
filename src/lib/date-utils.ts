import { nextFriday, format, startOfDay, endOfDay, addDays } from 'date-fns';
import { HDate } from '@hebcal/hdate';

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
      return null;
    case 'weekly':
      return format(getNextShabbatDate(), 'yyyy-MM-dd');
    default:
      return null;
  }
}

/**
 * Delivery date for the NEXT occurrence of a recurring order. Recurrence is
 * weekly, so we advance the order's own delivery date by 7 days — robust no
 * matter which day "delivered" is actually clicked. (The creation-time
 * getNextShabbatDate() returns *today* on a Friday, so reusing it would clone a
 * Shabbat order onto the same Friday, and it drops a specific_date entirely.)
 * Falls back to the type-based resolution when the source has no stored date.
 */
export function nextRecurringDate(
  deliveryType: string,
  currentDate: string | null
): string | null {
  if (currentDate) {
    // Advance one week, keeping the source weekday, but roll forward past today
    // so a late-marked delivery (owner taps "delivered" a week or two late) never
    // clones a next order dated in the past.
    let next = addDays(new Date(currentDate + 'T00:00:00'), 7);
    const today = startOfDay(new Date());
    while (next <= today) next = addDays(next, 7);
    return format(next, 'yyyy-MM-dd');
  }
  return resolveDeliveryDate(deliveryType);
}

export function formatDateRelative(dateStr: string, lang: 'en' | 'he'): string {
  const date = startOfDay(new Date(dateStr + 'T00:00:00'));
  const today = startOfDay(new Date());
  const diffDays = Math.round(
    (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  const isFriday = date.getDay() === 5;

  if (diffDays === 0) return lang === 'he' ? 'היום' : 'Today';
  if (diffDays === 1) return lang === 'he' ? 'מחר' : 'Tomorrow';
  if (diffDays === -1) return lang === 'he' ? 'אתמול' : 'Yesterday';

  // This Shabbat (Friday within the next 6 days)
  if (isFriday && diffDays > 0 && diffDays <= 6) {
    return lang === 'he' ? 'שבת הקרובה' : 'This Shabbat';
  }

  // Next Shabbat (Friday 7-13 days out)
  if (isFriday && diffDays > 6 && diffDays <= 13) {
    return lang === 'he' ? 'שבת הבאה' : 'Next Shabbat';
  }

  // Future: "In X days"
  if (diffDays >= 2 && diffDays <= 14) {
    return lang === 'he' ? `בעוד ${diffDays} ימים` : `In ${diffDays} days`;
  }

  // Past: "X days ago"
  if (diffDays <= -2 && diffDays >= -14) {
    const abs = Math.abs(diffDays);
    return lang === 'he' ? `לפני ${abs} ימים` : `${abs} days ago`;
  }

  // Further out: relative + short date
  if (diffDays > 14) {
    const rel = lang === 'he' ? `בעוד ${diffDays} ימים` : `In ${diffDays} days`;
    return `${rel} (${format(date, 'dd/MM')})`;
  }

  return format(date, 'dd/MM');
}

/**
 * Today's date on the Hebrew (Jewish) calendar in gematria, e.g. "ג׳ תמוז תשפ״ו".
 * Uses @hebcal/hdate (leap-aware months, gematria, nikud suppressed).
 */
export function formatHebrewDate(date: Date): string {
  return new HDate(date).renderGematriya(true);
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
