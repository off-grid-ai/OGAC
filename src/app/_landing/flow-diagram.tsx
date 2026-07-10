'use client';

import {
  Database,
  GitBranch,
  PlugsConnected,
  Robot,
  SealCheck,
} from '@phosphor-icons/react/dist/ssr';
import { type ComponentType, type RefObject, useRef } from 'react';
import { AnimatedBeam } from '@/components/ui/animated-beam';

type IconType = ComponentType<{ className?: string; weight?: 'regular' | 'bold' | 'duotone' }>;

// The product's thesis, made kinetic: five real pipeline stages wired together by
// traveling emerald beams. The connection metaphor IS the pitch — many tools, one path.
interface Stage {
  key: string;
  n: string;
  label: string;
  icon: IconType;
  note: string;
}

const STAGES: Stage[] = [
  { key: 'data', n: '01', label: 'Data', icon: Database, note: 'Your systems, as-is' },
  { key: 'gateway', n: '02', label: 'Gateways', icon: PlugsConnected, note: 'The model door' },
  { key: 'pipelines', n: '03', label: 'Pipelines', icon: GitBranch, note: 'Governed, once' },
  { key: 'apps', n: '04', label: 'Apps & agents', icon: Robot, note: 'Built in plain language' },
  { key: 'compliance', n: '05', label: 'Compliance', icon: SealCheck, note: 'Signed, cited, audited' },
];

function StageNode({
  stage,
  nodeRef,
  active,
}: {
  stage: Stage;
  nodeRef: RefObject<HTMLDivElement | null>;
  active?: boolean;
}) {
  const Icon = stage.icon;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div
        ref={nodeRef}
        className={
          'relative z-10 flex size-16 items-center justify-center rounded-2xl border bg-[#0f0f0f] transition-colors sm:size-[4.5rem] ' +
          (active ? 'border-[#34D399]/60 text-[#34D399]' : 'border-white/10 text-white/70')
        }
      >
        <Icon className="size-6 sm:size-7" weight="duotone" />
        <span className="absolute -right-2 -top-2 rounded-full border border-white/10 bg-[#0a0a0a] px-1.5 py-0.5 font-mono text-[9px] text-white/40">
          {stage.n}
        </span>
      </div>
      <div>
        <p className="text-xs font-semibold text-white sm:text-sm">{stage.label}</p>
        <p className="mt-0.5 hidden font-mono text-[10px] uppercase tracking-[0.12em] text-white/35 sm:block">
          {stage.note}
        </p>
      </div>
    </div>
  );
}

export function FlowDiagram() {
  const container = useRef<HTMLDivElement>(null);
  const refs = [
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
  ];

  return (
    <div
      ref={container}
      className="relative flex w-full flex-col items-stretch justify-between gap-6 sm:flex-row sm:items-center"
    >
      {STAGES.map((stage, i) => (
        <StageNode
          key={stage.key}
          stage={stage}
          nodeRef={refs[i]}
          active={stage.key === 'gateway' || stage.key === 'pipelines'}
        />
      ))}

      {/* Beams wire consecutive stages, staggered so the signal reads left-to-right. */}
      {refs.slice(0, -1).map((from, i) => (
        <AnimatedBeam
          key={i}
          containerRef={container}
          fromRef={from}
          toRef={refs[i + 1]}
          duration={2.4}
          delay={i * 0.4}
        />
      ))}
    </div>
  );
}
