import { AuditLogSurface, type AuditLogPageProps } from './content';

export const dynamic = 'force-dynamic';

export default function AuditLogPage(props: AuditLogPageProps) {
  return <AuditLogSurface {...props} />;
}
