'use client';

import { useState } from 'react';
import { CopilotAnswerSkeleton } from '@/components/copilot/CopilotAnswerSkeleton';
import { CopilotAnswerView } from '@/components/copilot/CopilotAnswerView';
import { MIN_QUESTION_LENGTH, useCopilotAnswer } from '@/components/copilot/useCopilotAnswer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

// The OPERATOR's ask surface (Insights → Copilot). The visitor-facing equivalent is GuideCopilot; both
// share useCopilotAnswer + CopilotAnswerView so the fetch and the honesty labels exist once.

const EXAMPLES = [
  'Why is cost up this week?',
  'What is drifting right now?',
  'Which recent runs failed and why?',
  'Are any pipelines unhealthy?',
];

export function AskPanel() {
  const [question, setQuestion] = useState('');
  const { loading, result, error, ask } = useCopilotAnswer();

  return (
    <div className="space-y-4">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Ask the Ops Copilot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Why did the last support pipeline run fail?"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void ask(question);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => void ask(question)}
              disabled={loading || question.trim().length < MIN_QUESTION_LENGTH}
            >
              {loading ? 'Thinking…' : 'Ask'}
            </Button>
            <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter to send</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setQuestion(ex);
                  void ask(ex);
                }}
                disabled={loading}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {ex}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-destructive/40 shadow-sm">
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {/* Same loader as the guide, from one component — the two copilot surfaces answer through the
          same pipeline and waited the same ~15-20s, so they must not drift into two different ideas
          of what "working" looks like. */}
      {loading ? (
        <Card className="shadow-sm">
          <CardContent className="py-4">
            <CopilotAnswerSkeleton label="Reading the live records…" />
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <Card className="shadow-sm">
          <CardContent className="py-4">
            <CopilotAnswerView result={result} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
