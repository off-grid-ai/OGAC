import { SiemSurface } from '@/app/(console)/insights/siem/page';

export default function EvidenceSecurityPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ outcome?: string; pipeline?: string }>;
}>) {
  return (
    <SiemSurface searchParams={searchParams} embedded basePath="/governance/evidence/security" />
  );
}
