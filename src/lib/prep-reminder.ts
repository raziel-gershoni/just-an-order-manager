/**
 * Whether the prep reminder cron sends on this run. The schedule fires at 06:00
 * and 20:00 Israel time every day; only two of the fourteen weekly runs send:
 * the morning run Sunday to Friday (for the next day) and the evening run on
 * Saturday (for Sunday, after Shabbat). `weekday` is 0 = Sunday ... 6 = Saturday
 * (weekdayIndex), `hour` the Israel hour (israelHour).
 */
export function prepSlotSends(weekday: number, hour: number): boolean {
  return weekday === 6 ? hour >= 12 : hour < 12;
}
