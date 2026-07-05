'use client';

import { DownloadSimple, Image as ImageIcon, Sparkle } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const SIZES = [512, 640, 768, 896, 1024];

interface Generated {
  url: string;
  key: string;
  prompt: string;
  seed: number;
}

// Console image generation — mirrors the desktop flow: prompt + negative prompt, size, steps, then
// Generate. Runs on the on-prem image gateway (nothing leaves the box); results are stored in
// SeaweedFS and shown in a session gallery. A blank generated store starts empty.
export function ImageGenerator() {
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [size, setSize] = useState(768);
  const [steps, setSteps] = useState(20);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Generated[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);

  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/images/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, negativePrompt: negative, width: size, height: size, steps }),
      });
      const data = (await res.json().catch(() => ({}))) as Generated & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResults((cur) => [data, ...cur]);
      toast.success('Image generated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
      {/* Controls */}
      <Card className="shadow-sm lg:sticky lg:top-4 lg:self-start">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Generate</CardTitle>
          <p className="text-xs text-muted-foreground">
            Rendered on your own image gateway — the prompt and result never leave your
            infrastructure.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ig-prompt">Prompt</Label>
            <Textarea
              id="ig-prompt"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="a photorealistic red fox in a snowy forest, golden hour"
              className="text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ig-neg">Negative prompt (optional)</Label>
            <Input
              id="ig-neg"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
              placeholder="blurry, low quality, text, watermark"
              className="text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ig-size">Size</Label>
              <select
                id="ig-size"
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}×{s}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ig-steps">Steps: {steps}</Label>
              <input
                id="ig-steps"
                type="range"
                min={1}
                max={50}
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
                className="h-9 w-full accent-primary"
              />
            </div>
          </div>
          <Button onClick={generate} disabled={busy || !prompt.trim()} className="w-full gap-1.5">
            <Sparkle className="size-4" />
            {busy ? 'Generating…' : 'Generate'}
          </Button>
          {busy ? (
            <p className="text-center text-xs text-muted-foreground">
              This can take a while on CPU — hang tight.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Results */}
      <div>
        {results.length === 0 ? (
          <Card className="shadow-sm">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ImageIcon className="size-6" />
              </div>
              <p className="text-sm text-muted-foreground">
                Your generated images appear here. Describe something and hit Generate.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((r) => (
              <Card key={r.key} className="overflow-hidden shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.url}
                  alt={r.prompt}
                  className="aspect-square w-full cursor-zoom-in object-cover"
                  onClick={() => setLightbox(r.url)}
                  loading="lazy"
                />
                <CardContent className="space-y-1.5 p-3">
                  <p className="line-clamp-2 text-xs text-muted-foreground">{r.prompt}</p>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-muted-foreground/70">
                      seed {r.seed < 0 ? 'random' : r.seed}
                    </span>
                    <a
                      href={r.url}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      <DownloadSimple className="size-3.5" />
                      download
                    </a>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {lightbox ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded object-contain" />
        </div>
      ) : null}
    </div>
  );
}
