import { RegulatorySurface } from '@/app/(console)/governance/regulatory/page';

export default function TrustRegulatoryPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ from?: string; to?: string }>;
}>) {
  return <RegulatorySurface searchParams={searchParams} embedded />;
}
