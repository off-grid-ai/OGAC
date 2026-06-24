import { execFile } from 'child_process';
import type { SandboxLanguage, SandboxPort, SandboxResult } from './types';

// Sandbox engines for agent-authored code execution.
//
// - `none` (default): refuses. Tools run only through the registered, scoped tool registry;
//   arbitrary code is never executed. The safe default for any deployment that hasn't opted in.
// - `docker`: runs the code in an EPHEMERAL container with the network disabled, memory/CPU/PID
//   caps, a read-only root, a non-root user, and a hard timeout — real isolation that's free, needs
//   no API key, and runs anywhere Docker does (no Linux/KVM host required). The activatable default
//   beyond no-exec.
//
// E2B (cloud microVMs — needs an API key), Firecracker, and Falco (Linux/KVM + eBPF hosts) are
// registered as metadata swap-ins in services.ts; they target production Linux hosts.
const DOCKER_BIN = process.env.OFFGRID_DOCKER_BIN ?? 'docker';
const DEFAULT_TIMEOUT = 10_000;
const IMAGES: Record<SandboxLanguage, string> = {
  python: process.env.OFFGRID_SANDBOX_PY_IMAGE ?? 'python:3.11-slim',
  node: process.env.OFFGRID_SANDBOX_NODE_IMAGE ?? 'node:20-slim',
};

export const noExecSandbox: SandboxPort = {
  meta: {
    id: 'none',
    capability: 'sandbox',
    vendor: 'Off Grid (no-exec)',
    license: 'first-party',
    render: 'native',
    description: 'No arbitrary code execution; tools run only via the scoped registry. Safe default.',
  },
  run(_language, _code) {
    return Promise.resolve({
      engine: 'none',
      ok: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: false,
      refused:
        'code execution is disabled (sandbox=none). Set OFFGRID_ADAPTER_SANDBOX=docker and enable the agent-code-exec flag to run sandboxed code.',
    });
  },
  health: () => Promise.resolve(true),
};

type ExecErr = NodeJS.ErrnoException & { code?: number; killed?: boolean; signal?: string };

function classify(err: ExecErr | null): { timedOut: boolean; exitCode: number } {
  if (!err) return { timedOut: false, exitCode: 0 };
  const timedOut = err.killed === true && err.signal === 'SIGTERM';
  return { timedOut, exitCode: typeof err.code === 'number' ? err.code : 1 };
}

function toResult(err: ExecErr | null, stdout: string, stderr: string): SandboxResult {
  const { timedOut, exitCode } = classify(err);
  const errText = err && !timedOut ? String(err) : '';
  return {
    engine: 'docker',
    ok: !err,
    stdout: stdout.slice(0, 100_000),
    stderr: (stderr || errText).slice(0, 100_000),
    exitCode,
    timedOut,
  };
}

function runDocker(args: string[], timeoutMs: number): Promise<SandboxResult> {
  return new Promise((resolve) => {
    const child = execFile(
      DOCKER_BIN,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => resolve(toResult(err as ExecErr | null, stdout, stderr)),
    );
    child.on('error', () =>
      resolve({
        engine: 'docker',
        ok: false,
        stdout: '',
        stderr: 'docker not available',
        exitCode: null,
        timedOut: false,
      }),
    );
  });
}

// Locked-down container flags: no network, capped memory/CPU/PIDs, read-only FS, dropped caps,
// non-root, auto-removed. The code is passed via the interpreter's -c (no host mounts).
function dockerArgs(language: SandboxLanguage, code: string): string[] {
  const interp = language === 'python' ? ['python3', '-c', code] : ['node', '-e', code];
  return [
    'run', '--rm', '--network', 'none',
    '--memory', '256m', '--cpus', '1', '--pids-limit', '128',
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '-u', '65534', // nobody
    IMAGES[language],
    ...interp,
  ];
}

export const dockerSandbox: SandboxPort = {
  meta: {
    id: 'docker',
    capability: 'sandbox',
    vendor: 'Off Grid Docker sandbox',
    license: 'first-party',
    render: 'native',
    description:
      'Ephemeral, network-disabled, resource-capped container per run (free, no API key, no Linux/KVM host). The activatable code-exec isolation.',
  },
  run(language, code, timeoutMs = DEFAULT_TIMEOUT) {
    return runDocker(dockerArgs(language, code), timeoutMs);
  },
  async health() {
    const r = await runDocker(['version', '--format', '{{.Server.Version}}'], 5000);
    return r.ok;
  },
};

export const SANDBOX_PORTS: SandboxPort[] = [noExecSandbox, dockerSandbox];
