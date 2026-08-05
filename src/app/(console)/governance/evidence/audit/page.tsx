import { AuditLogSurface } from '@/app/(console)/insights/audit/content';

export default function EvidenceAuditPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  return (
    <AuditLogSurface searchParams={searchParams} embedded basePath="/governance/evidence/audit" />
  );
}
