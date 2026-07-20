import { redirect } from 'next/navigation';
import { legacyGuardrailsDestination } from '@/lib/guardrails-destinations';

export default async function GuardrailsRoot({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
    else if (value !== undefined) query.set(key, value);
  }
  const destination = legacyGuardrailsDestination(query);
  const suffix = query.toString();
  redirect(suffix ? `${destination.route}?${suffix}` : destination.route);
}
