# MAINT_ACCEPT — `src/components/` pass 2 (deliberately left accept-listed)

SonarCloud MAINTAINABILITY deep second pass over `src/components/` only. Buckets:
S3358 (nested ternary), S6479 (array-index key), S3776 (cognitive complexity).

This pass converted the **provably render-identical** subset (value / className / string
nested ternaries hoisted to named consts or tiny pure helpers; static/stable-id key fixes)
and left the genuinely-risky remainder accept-listed. Everything below is a deliberate LEAVE
— converting it could change rendered output, key reconciliation, or hook order, which in a
React component is a real behavior bug, not a cosmetic smell.

## Why each class is left

- **S3358 — JSX-subtree ternary.** The ternary chooses between different JSX subtrees inline
  (loading/error/empty-state chains, badge/icon/Fragment variants, tab→panel selection).
  Hoisting it would either force premature element construction or change element identity /
  keys under the conditional — not render-identical. Only ternaries that compute a *value*
  (string/className/variant/number) consumed by a single JSX slot were converted.
- **S6479 — no stable unique key.** Index is left as the key when the item has no stable
  unique id AND one of: the list is static/skeleton (index is canonically stable), the list is
  index-mutated in place (`.filter((_, i) => i !== k)` / `.map((x, j) => j === i ? …)` — the
  index *is* the identity, keying by content breaks edit focus/reconciliation), or the field
  that looks id-like is not guaranteed unique (repeatable step `kind`, repeated tool names,
  per-sample metric names, duplicate targets, prompt strings). Changing these keys changes
  React reconciliation → a real bug.
- **S3776 — cognitive complexity.** Left where no pure helper or leaf subcomponent can be
  extracted without moving a hook (changing hook-call order) or splitting stateful/effectful
  logic that isn't cleanly separable. Per the rules, these stay accept-listed rather than risk
  a behavior/hook-order change.

---

## S3358 — nested ternary, left (JSX-subtree selection or index-drift)

| file:line | why not safe |
|---|---|
| access/MachineClientsList.tsx:450 | loading/error/empty JSX-subtree chain |
| access/MfaPanel.tsx:165,169,181 | Badge-element / state JSX-subtree chains |
| access/TeamsDepartments.tsx:173,344 | JSX-subtree selection |
| access/UserActivityPanel.tsx:289,293 | JSX-subtree selection |
| access/UserDetailPanel.tsx:371,380,526 | JSX-subtree selection |
| access/UserPicker.tsx:65 | JSX-subtree selection |
| agent-runs/AgentRunsManager.tsx:274 | JSX-subtree selection |
| agent-runs/AgentRunsTabs.tsx:75 | tab→panel subtree |
| agent-runs/SchedulesPanel.tsx:124,126,130,134 | loading/not-loaded/not-configured/unreachable/empty subtree chain |
| agents/AgentsGrid.tsx:59 | disabled/yours/null Badge subtree |
| build/AppControlsEditor.tsx:213 | JSX-subtree selection |
| build/AppScheduleEditor.tsx:202,206 | JSX-subtree selection |
| build/AppStepEditor.tsx:359,363 | JSX-subtree selection |
| chat/ArtifactView.tsx:179,186 | editor/iframe/markdown/pre subtree selection |
| chat/ChatWorkspace.tsx:341,1528,1710,1758 | JSX-subtree / icon-element selection + section-map IIFE |
| chat/Markdown.tsx:75 | Fragment/CiteChip subtree inside `.map` |
| config/ConfigManager.tsx:69,71,189,217 | apiError/loading/not-found JSX-subtree chains |
| config/FlagDetailPanel.tsx:164,207 | JSX-subtree selection |
| config/FlagManager.tsx:206 | JSX-subtree selection |
| evals/EvalDefsManager.tsx:158 | JSX-subtree selection |
| evals/EvalTemplateCatalog.tsx:223,282 | badge/empty subtrees |
| gateway/GatewayApiKeys.tsx:219,223 | JSX-subtree selection |
| gateway/GatewayLogs.tsx:147 | sort-icon element subtree |
| gateway/GatewayTuning.tsx:81,83 | JSX-subtree selection |
| gateway/ModelPicker.tsx:165,169 | JSX-subtree selection |
| observability/LangfuseRegistryPanel.tsx:104,108,109,153,154,180 | configured/error/tab subtree chain |
| pipelines/governance/PipelineDriftPanel.tsx:231 | JSX-subtree selection |
| pipelines/governance/PipelineQualityPanel.tsx:423 | JSX-subtree selection |
| prompts/PromptLibrary.tsx:259,488,492 | JSX-subtree selection |
| prompts/PromptPartials.tsx:143 | JSX-subtree selection |
| analytics/AnalyticsAlerts.tsx:439 | JSX-subtree selection |
| analytics/NativeSupersetPanel.tsx:57,61 | JSX-subtree selection |
| artifacts/ArtifactsBrowser.tsx:177 | JSX-subtree selection |
| backups/BackupsManager.tsx:519,523,527 | JSX-subtree selection |
| copilot/CopilotConsole.tsx:77 | JSX-subtree selection |
| copilot/SuggestControlsTool.tsx:130,161 | JSX-subtree selection |
| copilot/SuggestExpectationsTool.tsx:133 | JSX-subtree selection |
| data-domains/DomainDetailPanel.tsx:154 | JSX-subtree selection |
| data/AddConnectorButton.tsx:165 | JSX-subtree selection |
| data/VectorDBInspector.tsx:231,235,273,285 | JSX-subtree selection |
| fleet/DeviceSoftware.tsx:55,57 | JSX-subtree selection |
| lineage/DatasetDetailPanel.tsx:103,105 | JSX-subtree selection |
| platform-health/MetricChart.tsx:51 | JSX-subtree selection |
| projects/ProjectsBrowser.tsx:114 | JSX-subtree selection |
| retrieval/RetrievalManager.tsx:211,224 | JSX-subtree selection |
| secrets/DynamicDbPanel.tsx:79 | JSX-subtree selection |
| secrets/SecretsManager.tsx:515,591 | JSX-subtree selection |
| finops/KeyRateLimit.tsx:60,61,73 | stale line — current expression is a flat object-map lookup, no locatable nested ternary; not worth a risky guess |
| operations/RunsMonitor.tsx:345,347,349 | stale line — non-nested after file drift; not worth a risky guess |

## S6479 — array-index key, left (no stable unique id)

| file:line | why not safe |
|---|---|
| agent-runs/AgentRunsManager.tsx:340,355 | `run.steps` / `run.checks` — no unique id, repeatable kind / non-unique name |
| agents/AgentCardActions.tsx:73,89 | `run.steps` / `run.checks` — same shape, non-unique |
| agents/AgentRunner.tsx:145,161 | `run.steps` / `run.checks` — same, non-unique |
| build/AppReview.tsx:103 | `refs.map` — arbitrary ref strings, duplicates possible |
| build/AppRunStatus.tsx:214 | `refs.map` — duplicates possible |
| chat/ChatWorkspace.tsx:328,1541,1615,1652,1669 | message images / starter prompts / pending approvals / composer buffers — no id, duplicates possible, index-mutated |
| chat/Markdown.tsx:74,76,79,85 | parsed citation/AST segments — linear parse, index is identity |
| chat/SkillsDialog.tsx:213 | index-mutated editable input list — keying by value breaks edit focus |
| config/FlagDetailPanel.tsx:214 | `variants` — index-mutated (`cur.map((x,j)=>j===i…)`), index is identity |
| evals/EvalDefsManager.tsx:248 | `metrics` per-sample — same metric name repeats, non-unique |
| gateway/GatewayTokens.tsx:68 | override `sourceIp` not guaranteed unique |
| gateway/GatewayTraffic.tsx:107 | `toolCalls` — repeated tool names, non-unique |
| prompts/PromptLibrary.tsx:498 | gateway-history prompt strings — no id, duplicates possible |
| brain/GroundingVerifier.tsx:101 | claim text not guaranteed unique |
| data/QueryConsole.tsx:170 | DB result rows — no id |
| data-catalog/RtbfForm.tsx:100,126 | propagation/scope — duplicate targets possible |
| guardrails/PresidioThresholds.tsx:93 | index-mutated override rows (`updateRow(i, …)`) — index is identity |
| services/ServiceDetail.tsx:153 | health samples — no id |
| studio/DeployedApp.tsx:50 | append-only chat turns |
| ui/marquee.tsx:61 | pure repeat clones (static, index canonical) |
| ui/Pagination.tsx:105 | ellipsis marker — positionally stable |
| PageSkeleton.tsx:32,54,80,85,87 | static skeleton lists — index is canonically stable |

## S3776 — cognitive complexity, left (no clean pure/leaf extraction without hook-order risk)

| file:line | why not safe |
|---|---|
| access/MfaPanel.tsx:32 | stateful panel; no clean pure/leaf extraction without hook-order change |
| agent-runs/AgentRunsManager.tsx:233 | stateful; no clean extraction |
| agent-runs/SchedulesPanel.tsx:35 | stateful; no clean extraction |
| agents/AgentRunner.tsx:55 | stateful; no clean extraction |
| config/ConfigManager.tsx:37 | stateful; no clean extraction |
| config/FlagDetailPanel.tsx:30 | stateful; no clean extraction |
| chat/ArtifactView.tsx:33 | already `eslint-disable complexity`; reduction needs risky subcomponent extraction (hook order) |
| chat/ChatWorkspace.tsx:236,421,731,962 | large central handlers/effects; no clean pure extraction without behavior/hook-order risk |
| chat/useChatAudio.ts:235 | `speak` useCallback — imperative audio + side effects; pure parts already extracted, residual is genuine I/O |
| gateway/GatewayLogs.tsx:47 | stateful; no clean extraction |
| gateway/GatewayTraffic.tsx:85 | stateful; no clean extraction |
| observability/LangfuseRegistryPanel.tsx:64 | stateful; no clean extraction |
| pipelines/governance/PipelineDriftPanel.tsx:35 | stateful; no clean extraction |
| pipelines/governance/PipelineQualityPanel.tsx:29 | stateful; no clean extraction |
| artifacts/ArtifactsBrowser.tsx:51 | stateful; no clean extraction |
| backups/BackupsManager.tsx:138 | large stateful manager; no clean extraction |
| data/VectorDBInspector.tsx:53 | stateful; no clean extraction |
| lineage/DatasetDetailPanel.tsx:28 | stateful; no clean extraction |
| projects/ProjectDetail.tsx:40 | stateful; no clean extraction |
| retrieval/RetrievalManager.tsx:46 | stateful; no clean extraction |
| sandbox/RunCodePanel.tsx:34 | stateful; no clean extraction |
| build/AppBuilder.tsx:118, build/AppRoiCard.tsx:67, build/ReviewDecision.tsx:34 | value hoists already applied in these files; residual complexity is in stateful/JSX-structure logic — left |
| data/etl/EtlBuilder.tsx:81, studio/StudioCanvas.tsx:152, studio/StudioBuilder.tsx:57, pipelines/PipelineActions.tsx:41, pipelines/PipelineOverview.tsx:150, gateways/GatewayDetail.tsx:201, agents/AgentFormPanel.tsx:82 | value hoists applied where safe; residual complexity not reducible by pure extraction without hook-order risk — left |

---

## Converted this pass (for reference)

Render-preserving value/className/string hoists to named consts or tiny pure helpers, plus
one static-list stable-key fix. Commits: `cc0c8cef`, `8b1fdd0a`, `0ab9e9b8`, `69473b9b`,
`92b2110c`, `30847fe3`, `ec64dd1d`, `0837e5ce`, `cd8cf69c`.

Examples: `streamErrorReason`/`modelSuffix`/`headerTitle`/`micButtonTint` (ChatWorkspace);
gateway toggle/status-dot/label hoists; `byOutcome`/`faithfulnessBarClass`/`htmlInputType`/
`statusBadgeClass` + InheritanceBanner stable keys (build); `statusPillTone`/`submitLabel`
(agent-runs/agents); `egressSummary`/`overrideSummary`/`knowledgeSummary`/`trackStepClass`/
`runStatusBadgeClass`/`stepStatusTextClass`/`dataCeilingSummary` (pipelines/studio);
`countBadgeVariant`/`saveRuleLabel`/`verdictBadgeVariant` + decimal-places hoists
(edge/prompts/observability); `runButtonLabel`/`policySaveLabel`/share-link label +
`statusVariant` if/else (fleet/messaging/storage); `propagationOutcomeClass`/
`endpointPlaceholder`/`saveButtonLabel`/`editorHeading`/`runButtonLabel`/`sealStateLabel`
(data-catalog/exporters/policy/reports/sandbox/secrets).
