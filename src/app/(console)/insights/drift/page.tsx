import { redirect } from 'next/navigation';

export default function LegacyDriftPage() {
  redirect('/insights/quality/drift');
}
