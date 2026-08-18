import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * The message to show a user for a failed request.
 *
 * Always the app's own Hebrew string. What comes back over the wire is either
 * an English sentence or `zodError.message` — a multi-line JSON array of issue
 * objects — and neither belongs in an RTL toast in a Hebrew-only app. The raw
 * text goes to the console, where it is actually useful.
 */
export function friendlyError(error: unknown, fallback: string): string {
  if (error) console.warn('[request failed]', error);
  return fallback;
}
