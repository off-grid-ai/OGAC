import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// A clean placeholder for a pipeline detail tab whose functionality lands in a later fan-out phase.
// It renders the pipeline context (so the tab is never a dead page) + says exactly what will live
// here and why. Honest: it does NOT pretend to show data it can't yet compute.
export function TabPlaceholder({
  title,
  pipelineName,
  children,
}: {
  title: string;
  pipelineName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-sm text-muted-foreground">
            For pipeline <span className="font-medium text-foreground">{pipelineName}</span>
          </p>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{children}</CardContent>
      </Card>
    </div>
  );
}
