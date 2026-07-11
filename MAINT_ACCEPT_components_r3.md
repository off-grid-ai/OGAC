# MAINTAINABILITY residual pass — round 3 — accept-list (`src/components/` only)

Render/behavior-preserving fixes were applied where provably safe (see commits). This file records
what was **left accept-listed** and why. The overriding constraint (task rule 1): a change is only
made if it is provably render-identical (same rendered output + same hook order). Anything that
isn't is left in place.

## S3776 — Cognitive Complexity (component/hook bodies)

All remaining S3776 hits in this slice are **React component or hook bodies** whose complexity comes
from imperative React work — `useState`/`useEffect`/`useCallback`/`useRef` orchestration, fetch
sequencing with per-step `setState`, and large conditional JSX trees. A meaningful complexity
reduction here means either (a) restructuring the render tree or (b) pulling branches into a helper
that must still call the parent's hooks/state-setters — both of which risk changing **hook order** or
**rendered output**, violating rule 1. The one exception that *was* a pure, hook-free function —
`EtlBuilder.tsx:81 nodeSummary` — was refactored (dispatch table) and is NOT in this list.

Local ESLint already carries `complexity` disables on several of these (e.g. `VectorDBInspector`),
i.e. the repo has already accepted them at the lint layer.

| rule | file:line | why left |
|------|-----------|----------|
| S3776 | backups/BackupsManager.tsx:138 | component body; state + fetch + conditional JSX; no hook-safe pure extraction |
| S3776 | chat/ChatWorkspace.tsx:252 | component body; hook-order-sensitive |
| S3776 | chat/ChatWorkspace.tsx:437 | component body (54); dense effect/stream orchestration; not render-safe to split |
| S3776 | chat/ChatWorkspace.tsx:747 | component body; hook-order-sensitive |
| S3776 | chat/ChatWorkspace.tsx:978 | component body; hook-order-sensitive |
| S3776 | chat/useChatAudio.ts:235 | `speak` useCallback; imperative TTS/ref/state orchestration; no clean pure seam |
| S3776 | chat/ArtifactView.tsx:33 | component body; conditional render tree |
| S3776 | studio/StudioCanvas.tsx:166 | component body (64); canvas + drag state; render-restructuring risk |
| S3776 | studio/StudioBuilder.tsx:80 | component body; hook-order-sensitive |
| S3776 | build/AppBuilder.tsx:118 | component body; hook-order-sensitive |
| S3776 | build/AppRoiCard.tsx:73 | component body (16, 1 over); state + save() + JSX; not worth render-risk |
| S3776 | build/ReviewDecision.tsx:49 | component body; conditional render tree |
| S3776 | data/VectorDBInspector.tsx:53 | component body; already `// eslint-disable complexity` in-repo |
| S3776 | pipelines/governance/PipelineQualityPanel.tsx:29 | component body; fetch + conditional JSX |
| S3776 | pipelines/governance/PipelineDriftPanel.tsx:35 | component body; fetch + conditional JSX |
| S3776 | gateways/GatewayDetail.tsx:201 | component body; hook-order-sensitive |
| S3776 | gateway/GatewayTraffic.tsx:85 | component body; hook-order-sensitive |
| S3776 | gateway/GatewayLogs.tsx:47 | component body; hook-order-sensitive |
| S3776 | retrieval/RetrievalManager.tsx:46 | component body; hook-order-sensitive |
| S3776 | agents/AgentFormPanel.tsx:82 | component body; form state + submit |
| S3776 | agents/AgentRunner.tsx:55 | component body; run orchestration |
| S3776 | projects/ProjectDetail.tsx:40 | component body; conditional render tree |
| S3776 | artifacts/ArtifactsBrowser.tsx:51 | component body; hook-order-sensitive |
| S3776 | agent-runs/DurableExecutionsPanel.tsx:98 | component body; fetch/poll orchestration |
| S3776 | agent-runs/DurableExecutionsPanel.tsx:287 | nested detail component body |
| S3776 | agent-runs/SchedulesPanel.tsx:35 | component body; CRUD + conditional JSX |
| S3776 | agent-runs/AgentRunsManager.tsx:233 | `runAction` dispatch; imperative fetch per action |
| S3776 | observability/LangfuseRegistryPanel.tsx:64 | nested TabBar body; hook-order-sensitive |
| S3776 | access/MfaPanel.tsx:32 | component body; enrollment flow state machine |
| S3776 | lineage/DatasetDetailPanel.tsx:28 | component body; fetch + conditional JSX |
| S3776 | config/FlagDetailPanel.tsx:30 | component body; CRUD form + conditional JSX |
| S3776 | sandbox/RunCodePanel.tsx:34 | component body; run + conditional JSX |
| S3776 | edge/EdgePanel.tsx:101 | component body; filter/sort/poll state + large table JSX |

## Notes
- No S6606 / S6353 / S6571(others) / S4323(others) issues remained beyond those fixed.
- S6478 nested-component hits were all fixed by lifting to module scope (see commits); none of the
  three lifted definitions closed over parent render-scope in a way that made lifting unsafe —
  `EdgePanel.SortIcon` took its sort state as props; the two markdown maps were pure/factory-passed.
