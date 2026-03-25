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

export function formatDate(dateStr: string, lang: 'en' | 'he'): string {
  const date = new Date(dateStr);
  return format(date, 'dd/MM/yyyy');
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
