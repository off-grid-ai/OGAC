import LegacyServiceDetailPage from '@/app/(console)/gateway/services/[id]/page';

export default function ServiceDetailPage({
  params,
}: Readonly<{ params: Promise<{ serviceId: string }> }>) {
  return LegacyServiceDetailPage({
    params: params.then(({ serviceId }) => ({ id: serviceId })),
  });
}
