import { PageFrame } from '@/components/PageFrame';
import { ProvenanceSurface } from './ProvenanceSurface';

export const dynamic = 'force-dynamic';

export default function ProvenancePage() {
  return (
    <PageFrame>
      <ProvenanceSurface />
    </PageFrame>
  );
}
