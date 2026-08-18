import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * The message to show a user for a failed request.
 *
 * Routes hand back two very different things through the same field: a written
 * sentence ("Ingredient X appears twice") worth showing, and `zodError.message`,
 * which is a multi-line JSON array of issue objects — unreadable, and worse than
 * useless inside an RTL toast. Show the first, fall back for the second.
 */
export function friendlyError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  const looksLikeZod = message.trimStart().startsWith('[') || message.includes('"code":');
  if (!message || looksLikeZod || message.length > 160 || message.includes('\n')) return fallback;
  return message;
}
