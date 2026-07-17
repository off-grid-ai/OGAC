'use client';

import { Play } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { evalEngineLabel } from '@/lib/eval-engine-label';
import type { RunnableEngine } from '@/lib/evals-golden';

export function RunEvalSuiteButton({
  engine,
  disabled = false,
  label = 'Run',
  variant = 'outline',
}: Readonly<{
  engine: RunnableEngine;
  disabled?: boolean;
  label?: 'Run' | 'Re-run';
  variant?: 'default' | 'outline';
}>) {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    const response = await fetch('/api/v1/admin/evals/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ engine }),
    });
    setRunning(false);
    if (response.ok) {
      const result = await response.json();
      toast.success(
        `Ran ${evalEngineLabel(result.engine)}: ${result.passed}/${result.total} passed (${result.score}%)`,
      );
      router.refresh();
      return;
    }
    const error = await response.json().catch(() => null);
    toast.error(error?.error ?? 'Eval run failed');
  }

  return (
    <Button size="sm" variant={variant} disabled={disabled || running} onClick={run}>
      <Play className="mr-1.5 size-3.5" />
      {running ? 'Running…' : `${label} ${evalEngineLabel(engine)}`}
    </Button>
  );
}
