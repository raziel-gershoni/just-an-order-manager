'use client';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  baking: 'bg-orange-100 text-orange-800',
  ready: 'bg-green-100 text-green-800',
  delivered: 'bg-gray-100 text-gray-600',
  to_be_paid: 'bg-amber-100 text-amber-800',
  cancelled: 'bg-red-100 text-red-800',
};

export function Badge({
  status,
  label,
}: {
  status: string;
  label: string;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
        statusColors[status] ?? 'bg-gray-100 text-gray-800'
      }`}
    >
      {label}
    </span>
  );
}
