import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/authz';
import {
  prepareOutboundRelease,
  runInboundGuardrails,
  runOutboundGuardrails,
} from '@/lib/chat-run';
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';
import { promptRunTag } from '@/lib/prompt-observability';
import { resolvePartialMap } from '@/lib/prompt-partials';
import { renderPromptWithPartials } from '@/lib/prompt-template';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Prompt PLAYGROUND — run a library prompt against a model and see the result, IN the console. The
// prompt's `{{>partials}}` are inlined and its `{{variables}}` filled server-side, then the rendered
// text is sent through the GOVERNED gateway path — the SAME inbound/outbound guardrail floor the chat
// uses (runInboundGuardrails / runOutboundGuardrails). An injection-blocked verdict is a hard refusal;
// the completion is a non-streaming call to the on-prem gateway. We return the rendered prompt, the
// model output, and the guardrail check results so the operator sees exactly what was governed.
interface PlaygroundInput {
  content: string;
  model: string;
  values: Record<string, string>;
  system: string;
  // Prompt-observability tagging: when the caller identifies which library prompt + version it is
  // running, we stamp the gateway call with an `x-offgrid-run` header. Optional — an ad-hoc run
  // (no promptId) is untagged and simply not counted, which is honest.
  promptId: string;
  version: string;
  temperature: number;
}

// Pure: normalize the raw request body into the playground's typed inputs, clamping temperature to
// [0, 2] and defaulting to 0.7. Behavior-identical to the previous inline field parsing.
function parsePlaygroundBody(body: Record<string, unknown>): PlaygroundInput {
  return {
    content: typeof body.content === 'string' ? body.content : '',
    model: typeof body.model === 'string' ? body.model.trim() : '',
    values:
      body.values && typeof body.values === 'object' && !Array.isArray(body.values)
        ? (body.values as Record<string, string>)
        : {},
    system: typeof body.system === 'string' ? body.system : '',
    promptId: typeof body.promptId === 'string' ? body.promptId.trim() : '',
    version: typeof body.version === 'string' ? body.version.trim() : '',
    temperature:
      typeof body.temperature === 'number' && Number.isFinite(body.temperature)
        ? Math.max(0, Math.min(2, body.temperature))
        : 0.7,
  };
}

export async function POST(req: NextRequest) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const owner = gate.user.email ?? '';

  const { content, model, values, system, promptId, version, temperature } = parsePlaygroundBody(
    await req.json().catch(() => ({})),
  );

  if (!content.trim()) {
    return NextResponse.json({ error: 'prompt content is required' }, { status: 400 });
  }

  // 1) Compose: inline the caller-visible partials, then fill variables. Pure.
  const partialMap = await resolvePartialMap(owner);
  const composed = renderPromptWithPartials(content, values, partialMap);
  const prompt = composed.rendered;

  // 2) Inbound guardrail floor (governed) — mirrors the chat path. requireMasking:false here (the
  //    playground has no bound pipeline contract), so this scans + records verdicts and blocks on a
  //    prompt-injection detection, exactly like chat's inbound floor with no masking contract.
  const inbound = await runInboundGuardrails(prompt, model, { requireMasking: false }).catch(
    () => null,
  );
  const preChecks = inbound?.checks ?? [];
  if (inbound?.blocked) {
    return NextResponse.json(
      {
        error: 'blocked by input guardrail: prompt injection detected',
        blocked: true,
        rendered: prompt,
        missing: composed.missing,
        cyclic: composed.cyclic,
        checks: [...preChecks],
      },
      { status: 200 },
    );
  }

  // 3) Governed model call — the on-prem gateway (same URL + auth headers the chat uses).
  const messages: { role: string; content: string }[] = [];
  if (system.trim()) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const payload: Record<string, unknown> = { messages, max_tokens: 2048, temperature, stream: false };
  if (model) payload.model = model;

  // Stamp the prompt-run tag onto the gateway call so it lands as `corrId` in the telemetry doc.
  const runHeaders: Record<string, string> = {
    'content-type': 'application/json',
    'x-offgrid-user': owner,
  };
  if (promptId && version) runHeaders['x-offgrid-run'] = promptRunTag(promptId, version);

  let output = '';
  let ok = true;
  let detail = '';
  try {
    const r = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: gatewayHeaders(runHeaders),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(115000),
    });
    if (!r.ok) {
      ok = false;
      detail = `gateway ${r.status}`;
    } else {
      const data = await r.json();
      output = data?.choices?.[0]?.message?.content ?? '';
    }
  } catch (e) {
    ok = false;
    detail = (e as Error)?.message || 'gateway unreachable';
  }

  if (!ok) {
    return NextResponse.json(
      { error: detail || 'model call failed', rendered: prompt, checks: preChecks },
      { status: 502 },
    );
  }

  // 4) Outbound guardrail scan gates release. A thrown screen is null (not an empty clean result),
  // and a blocked/error verdict never returns the raw completion to the browser.
  const postChecks = output
    ? await runOutboundGuardrails(output, model, undefined, prompt).catch(() => null)
    : [];
  const release = prepareOutboundRelease(output, '', postChecks);
  if (release.blocked) {
    return NextResponse.json(
      {
        error: 'output guardrail did not clear the generated response',
        rendered: prompt,
        model: model || null,
        checks: [...preChecks, ...(postChecks ?? [])],
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    rendered: prompt,
    output: release.answer,
    model: model || null,
    missing: composed.missing,
    cyclic: composed.cyclic,
    checks: [...preChecks, ...(postChecks ?? [])],
  });
}
