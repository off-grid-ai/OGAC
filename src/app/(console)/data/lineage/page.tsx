import { redirect } from 'next/navigation';
import {
  canonicalLineagePath,
  type LineageSearchParams,
} from '@/components/lineage/lineage-routes';

export default async function LineageRoot({
  searchParams,
}: Readonly<{ searchParams: Promise<LineageSearchParams> }>) {
  redirect(canonicalLineagePath(await searchParams));
}
