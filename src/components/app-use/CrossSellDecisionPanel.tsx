'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CrossSellOpportunityView } from '@/lib/bank-cross-sell-contract';

type Intent = 'approve' | 'reject';

export function CrossSellDecisionPanel({
  slug,
  opportunity,
}: Readonly<{ slug: string; opportunity: CrossSellOpportunityView }>) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState<Intent | 'start' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function request(url: string, body: Record<string, unknown>, intent: typeof saving) {
    setSaving(intent);
    setError(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      if (!response.ok)
        throw new Error(result.error || result.code || 'The request could not be completed.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request could not be completed.');
    } finally {
      setSaving(null);
    }
  }

  if (!opportunity.runId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Prepare this recommendation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Run the governed App against the cited customer and eligibility records. Nothing is
            written to CRM until a relationship manager approves the result.
          </p>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            disabled={saving !== null || !opportunity.recommendation?.eligible}
            onClick={() =>
              request(
                `/api/v1/app/${encodeURIComponent(slug)}/cross-sell/runs`,
                { customerId: opportunity.customerId },
                'start',
              )
            }
          >
            {saving === 'start' ? 'Preparing…' : 'Prepare for review'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (opportunity.rmDecision.status !== 'pending') return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Your decision</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block space-y-2 text-xs text-muted-foreground">
          Decision reason
          <textarea
            className="min-h-24 w-full rounded-md border bg-background p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Record why this offer is suitable, or why it should not proceed."
          />
        </label>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={saving !== null || reason.trim().length < 3}
            onClick={() =>
              request(
                `/api/v1/admin/apps/runs/${encodeURIComponent(opportunity.runId!)}/review`,
                { decision: 'reject', note: reason.trim() },
                'reject',
              )
            }
          >
            {saving === 'reject' ? 'Rejecting…' : 'Reject recommendation'}
          </Button>
          <Button
            disabled={saving !== null || reason.trim().length < 3}
            onClick={() =>
              request(
                `/api/v1/admin/apps/runs/${encodeURIComponent(opportunity.runId!)}/review`,
                { decision: 'approve', note: reason.trim() },
                'approve',
              )
            }
          >
            {saving === 'approve' ? 'Approving…' : 'Approve and create CRM task'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
