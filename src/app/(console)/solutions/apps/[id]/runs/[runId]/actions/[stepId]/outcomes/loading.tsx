import { Skeleton } from '@/components/ui/skeleton';

export default function ActionStepOutcomeLoading() {
  return (
    <div className="w-full space-y-5" aria-label="Loading business result">
      <Skeleton className="h-5 w-36" />
      <Skeleton className="h-9 w-80 max-w-full" />
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Skeleton className="h-80 min-w-0" />
        <Skeleton className="h-80 min-w-0" />
      </div>
    </div>
  );
}
