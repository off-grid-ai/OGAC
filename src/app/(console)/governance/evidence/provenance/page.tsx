import { PageFrame } from '@/components/PageFrame';
import { ProvenanceSurface } from '@/app/(console)/governance/provenance/ProvenanceSurface';

export default function EvidenceProvenancePage() {
  return (
    <PageFrame embedded>
      <ProvenanceSurface embedded />
    </PageFrame>
  );
}
