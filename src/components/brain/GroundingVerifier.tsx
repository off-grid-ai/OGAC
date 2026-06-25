'use client';

import { Scales } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';

interface Verdict {
  claim: string;
  supported: boolean;
  score: number;
}
interface Result {
  score: number;
  verdicts: Verdict[];
}

// Standalone grounding: verify any answer against any sources (POST /admin/grounding/verify). No
// Brain, no store — works over a customer's own RAG output.
export function GroundingVerifier() {
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    const list = sources
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!answer.trim() || list.length === 0) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/v1/admin/grounding/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answer, sources: list.map((text) => ({ text })) }),
      });
      if (!res.ok) throw new Error('failed');
      setResult((await res.json()) as Result);
    } catch {
      toast.error('Verification failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Scales className="size-4 text-primary" />
          Grounding verifier
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Check whether an answer is supported by its sources — per-claim, with a faithfulness score.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="gv-answer">Answer</Label>
          <Textarea
            id="gv-answer"
            rows={3}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="The claim handler must confirm the policy is in force before intake."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gv-sources">Sources (one per line)</Label>
          <Textarea
            id="gv-sources"
            rows={4}
            value={sources}
            onChange={(e) => setSources(e.target.value)}
            placeholder={'Policies must be in force and past contestability before FNOL intake.\nMasking is enforced by the data plane.'}
          />
        </div>
        <Button size="sm" onClick={verify} disabled={busy || !answer.trim()} className="w-full">
          {busy ? 'Verifying…' : 'Verify grounding'}
        </Button>

        {result ? (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Faithfulness</span>
                <span className="font-medium text-foreground">{result.score}%</span>
              </div>
              <Progress value={result.score} />
            </div>
            <div className="space-y-1.5">
              {result.verdicts.map((v, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <Badge
                    variant="secondary"
                    className={
                      v.supported ? 'bg-primary/10 text-primary' : 'bg-amber-500/10 text-amber-600'
                    }
                  >
                    {v.supported ? 'grounded' : 'unsupported'}
                  </Badge>
                  <span className="text-muted-foreground">{v.claim}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
