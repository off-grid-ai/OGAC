import { RegulatorySurface, type RegulatoryPageProps } from './content';

export const dynamic = 'force-dynamic';

export default function RegulatoryPage(props: RegulatoryPageProps) {
  return <RegulatorySurface {...props} />;
}
