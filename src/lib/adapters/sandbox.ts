import { execFile } from 'child_process';
import { existsSync } from 'fs';
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
// - `firecracker`: runs each job in an ephemeral Firecracker MICROVM (hardware-virtualized, a far
//   stronger boundary than a container) on a Linux/KVM host, via a one-shot microVM runner
//   (Weave Ignite by default; any `docker run`-compatible runner works). Requires `/dev/kvm`, so it
//   refuses cleanly on non-KVM hosts (e.g. macOS dev) instead of pretending to run.
//
// E2B (cloud microVMs — needs an API key) and Falco (runtime threat detection) remain metadata
// swap-ins in services.ts.
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

function toResult(engine: string, err: ExecErr | null, stdout: string, stderr: string): SandboxResult {
  const { timedOut, exitCode } = classify(err);
  const errText = err && !timedOut ? String(err) : '';
  return {
    engine,
    ok: !err,
    stdout: stdout.slice(0, 100_000),
    stderr: (stderr || errText).slice(0, 100_000),
    exitCode,
    timedOut,
  };
}

// Run a binary with a hard timeout, mapping the result/errors into a SandboxResult. Shared by the
// Docker and Firecracker engines (both shell out to a `run`-style CLI with the same contract).
function runProc(engine: string, bin: string, args: string[], timeoutMs: number): Promise<SandboxResult> {
  return new Promise((resolve) => {
    const child = execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => resolve(toResult(engine, err as ExecErr | null, stdout, stderr)),
    );
    child.on('error', () =>
      resolve({
        engine,
        ok: false,
        stdout: '',
        stderr: `${bin} not available`,
        exitCode: null,
        timedOut: false,
      }),
    );
  });
}

// Locked-down container flags: no network, capped memory/CPU/PIDs, read-only FS, dropped caps,
// non-root, auto-removed. The code is passed via the interpreter's -c (no host mounts).
// `--pull never`: the run image is pre-provisioned INFRA (pre-pulled on the sandbox host — see
// deploy/onprem/SERVER_STATE.md). A container with `--network none` can't pull anyway, and folding
// a registry pull into the run's timeout is what caused the "Unable to find image … / exit 143"
// timeout. So we never attempt a pull at run time: if the image is missing docker fails instantly
// with a clear "No such image" message instead of hanging until the runner SIGTERMs it.
function dockerArgs(language: SandboxLanguage, code: string): string[] {
  const interp = language === 'python' ? ['python3', '-c', code] : ['node', '-e', code];
  return [
    'run', '--rm', '--pull', 'never', '--network', 'none',
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
    return runProc('docker', DOCKER_BIN, dockerArgs(language, code), timeoutMs);
  },
  async health() {
    const r = await runProc('docker', DOCKER_BIN, ['version', '--format', '{{.Server.Version}}'], 5000);
    return r.ok;
  },
};

// ─── Firecracker microVM sandbox ──────────────────────────────────────────────
// Each job runs in a throwaway Firecracker microVM — a real hardware-virtualization boundary
// (separate guest kernel), much stronger than a shared-kernel container, for genuinely untrusted
// code. Firecracker needs a Linux host with KVM (`/dev/kvm`); there is no macOS/Windows path, so we
// detect KVM and refuse cleanly elsewhere. We drive microVMs through a one-shot, `docker run`-style
// runner — Weave Ignite (`ignite`) by default — set via OFFGRID_FIRECRACKER_BIN. The runner must
// accept `run --rm <image> <cmd...>` and propagate stdout/stderr/exit code.
const FC_BIN = process.env.OFFGRID_FIRECRACKER_BIN ?? 'ignite';
const FC_KVM = process.env.OFFGRID_KVM_DEVICE ?? '/dev/kvm';
const FC_IMAGES: Record<SandboxLanguage, string> = {
  python: process.env.OFFGRID_FC_PY_IMAGE ?? 'python:3.11-slim',
  node: process.env.OFFGRID_FC_NODE_IMAGE ?? 'node:20-slim',
};

function kvmAvailable(): boolean {
  return existsSync(FC_KVM);
}

function refusedNoKvm(): SandboxResult {
  return {
    engine: 'firecracker',
    ok: false,
    stdout: '',
    stderr: '',
    exitCode: null,
    timedOut: false,
    refused: `Firecracker needs a Linux host with KVM (${FC_KVM} not found). Use the Docker sandbox on this host, or run the console on a KVM host.`,
  };
}

// One-shot microVM invocation: capped memory/CPU, no network, auto-removed, code via the
// interpreter's -c/-e (no host mounts). Mirrors the Docker flags on an Ignite-compatible runner.
function firecrackerArgs(language: SandboxLanguage, code: string): string[] {
  const interp = language === 'python' ? ['python3', '-c', code] : ['node', '-e', code];
  return [
    'run', '--rm', '--network', 'none',
    '--memory', '256MB', '--cpus', '1',
    FC_IMAGES[language],
    '--', ...interp,
  ];
}

export const firecrackerSandbox: SandboxPort = {
  meta: {
    id: 'firecracker',
    capability: 'sandbox',
    vendor: 'Firecracker (microVM)',
    license: 'Apache-2.0',
    render: 'native',
    description:
      'Hardware-isolated microVM per run on a Linux/KVM host (stronger than containers, free, no API key). Refuses on non-KVM hosts.',
  },
  run(language, code, timeoutMs = DEFAULT_TIMEOUT) {
    if (!kvmAvailable()) return Promise.resolve(refusedNoKvm());
    return runProc('firecracker', FC_BIN, firecrackerArgs(language, code), timeoutMs);
  },
  async health() {
    if (!kvmAvailable()) return false;
    const r = await runProc('firecracker', FC_BIN, ['version'], 5000);
    return r.ok;
  },
};

export const SANDBOX_PORTS: SandboxPort[] = [noExecSandbox, dockerSandbox, firecrackerSandbox];
