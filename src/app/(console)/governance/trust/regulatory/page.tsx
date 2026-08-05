import { RegulatorySurface } from '@/app/(console)/governance/regulatory/content';

export default function TrustRegulatoryPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ from?: string; to?: string }>;
}>) {
  return <RegulatorySurface searchParams={searchParams} embedded />;
}
