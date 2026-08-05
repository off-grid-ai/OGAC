import { SiemSurface, type SiemPageProps } from './content';

export const dynamic = 'force-dynamic';

export default function SiemPage(props: SiemPageProps) {
  return <SiemSurface {...props} />;
}
