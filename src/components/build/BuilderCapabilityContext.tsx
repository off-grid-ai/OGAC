'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Disclosure, DisclosureContent, DisclosureTrigger } from '@/components/ui/disclosure';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import {
  type BuilderCapabilityItem,
  type BuilderCapabilityView,
} from '@/lib/builder-capability-view';
import type { BuilderSurfaceContextState } from '@/lib/builder-surface-access';
import { loadBuilderCapabilityContext } from '@/lib/enterprise-context-client';

const LOAD_TIMEOUT_MS = 10_000;
const VISIBLE_ITEMS_PER_SLICE = 4;
const BUILDER_SLICE_ORDER = ['data', 'capabilities', 'pipelines', 'actions'] as const;

export type BuilderCapabilityContextState = BuilderSurfaceContextState;

export function useBuilderCapabilityContext(appId?: string): {
  state: BuilderCapabilityContextState;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<BuilderCapabilityContextState>({ status: 'loading' });
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    let timedOut = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, LOAD_TIMEOUT_MS);
    setState({ status: 'loading' });
    void loadBuilderCapabilityContext(fetch, appId, controller.signal)
      .then((view) => {
        if (active) setState({ status: 'ready', view });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: 'error',
          message: timedOut
            ? 'Available options are taking too long to load. Try again.'
            : error instanceof Error
              ? error.message
              : 'Available options could not be loaded. Try again.',
        });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [appId, attempt]);

  return { state, retry };
}

function ItemLinks({ item }: Readonly<{ item: BuilderCapabilityItem }>) {
  if (!item.managementHref && !item.remedyHref) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
      {item.remedyHref ? (
        <Link className="text-primary underline-offset-4 hover:underline" href={item.remedyHref}>
          Fix setup
        </Link>
      ) : null}
      {item.managementHref ? (
        <Link
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          href={item.managementHref}
        >
          Open settings
        </Link>
      ) : null}
    </div>
  );
}

function CapabilityItem({ item }: Readonly<{ item: BuilderCapabilityItem }>) {
  return (
    <li className="border-t border-border/70 py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{item.label}</p>
          {item.description ? (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
              {item.description}
            </p>
          ) : null}
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
          {item.statusLabel}
        </Badge>
      </div>
      {item.selectionState !== 'selectable' ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {item.explanation}
        </p>
      ) : null}
      {item.approvalGuidance ? (
        <div className="mt-2 border-l-2 border-primary/40 pl-2 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">{item.approvalGuidance.heading}</p>
          <p>{item.approvalGuidance.guidance}</p>
          {item.approvalGuidance.eligibleSteps.length > 0 ? (
            <p className="mt-1">
              Available: {item.approvalGuidance.eligibleSteps.map((step) => step.label).join(', ')}
            </p>
          ) : null}
        </div>
      ) : null}
      <ItemLinks item={item} />
    </li>
  );
}

function CapabilityItems({ items }: Readonly<{ items: BuilderCapabilityItem[] }>) {
  const visible = items.slice(0, VISIBLE_ITEMS_PER_SLICE);
  const remaining = items.slice(VISIBLE_ITEMS_PER_SLICE);
  return (
    <>
      <ul className="mt-3">
        {visible.map((item) => (
          <CapabilityItem key={item.ref} item={item} />
        ))}
      </ul>
      {remaining.length > 0 ? (
        <Disclosure className="mt-2 border-t border-border/70 pt-2">
          <DisclosureTrigger className="min-h-11 w-full text-left text-[11px] text-muted-foreground hover:text-foreground">
            Show {remaining.length} more
          </DisclosureTrigger>
          <DisclosureContent>
            <ul>
              {remaining.map((item) => (
                <CapabilityItem key={item.ref} item={item} />
              ))}
            </ul>
          </DisclosureContent>
        </Disclosure>
      ) : null}
    </>
  );
}

export function BuilderCapabilityContext({
  state,
  onRetry,
}: Readonly<{
  state: BuilderCapabilityContextState;
  onRetry: () => void;
}>) {
  if (state.status === 'loading') {
    return (
      <Card aria-busy="true">
        <CardHeader>
          <CardTitle className="text-sm">Available to you</CardTitle>
          <CardDescription>Checking the data and capabilities you can use.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (state.status === 'error') {
    return (
      <Card>
        <CardContent className="py-4">
          <ErrorState
            title="Available options could not be loaded"
            description={state.message}
            action={
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                Try again
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  const { view } = state;
  const slices = BUILDER_SLICE_ORDER.flatMap((id) => {
    const slice = view.slices.find((candidate) => candidate.id === id);
    return slice ? [slice] : [];
  });
  const items = slices.flatMap((slice) => slice.items);
  const ready = items.filter((item) => item.selectionState === 'selectable').length;
  const approvalRequired = items.filter(
    (item) => item.selectionState === 'selectable-with-approval',
  ).length;
  const readOnly = items.filter((item) => item.selectionState === 'read-only').length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Available to you</CardTitle>
        <CardDescription>
          Choose from what is already connected and allowed. Options that need setup or approval
          stay visible with the next step.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>{ready} ready</span>
          <span>{approvalRequired} need approval</span>
          <span>{readOnly} unavailable</span>
          {view.summary.omitted > 0 ? (
            <span>{view.summary.omitted} not shown by access</span>
          ) : null}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {slices.map((slice) => (
            <section key={slice.id} className="min-w-0 rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-xs font-medium text-foreground">{slice.label}</h3>
                  {slice.status !== 'ready' ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {slice.explanation}
                    </p>
                  ) : null}
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                  {slice.statusLabel}
                </Badge>
              </div>
              {slice.remedyHref ? (
                <Link
                  className="mt-2 inline-flex text-[11px] text-primary underline-offset-4 hover:underline"
                  href={slice.remedyHref}
                >
                  Fix this section
                </Link>
              ) : null}
              {slice.items.length > 0 ? (
                <CapabilityItems items={slice.items} />
              ) : (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  {slice.status === 'failed'
                    ? 'No options can be selected until this section loads.'
                    : 'No options are available in this section yet.'}
                </p>
              )}
            </section>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
