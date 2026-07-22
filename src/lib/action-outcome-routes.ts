export function appRunHref(appId: string, runId: string): string {
  return `/solutions/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}`;
}

export function actionOutcomeCollectionHref(appId: string, runId: string, stepId: string): string {
  return `${appRunHref(appId, runId)}/actions/${encodeURIComponent(stepId)}/outcomes`;
}

export function newActionOutcomeHref(
  appId: string,
  runId: string,
  stepId: string,
  result?: 'converted',
): string {
  const base = `${actionOutcomeCollectionHref(appId, runId, stepId)}/new`;
  return result ? `${base}?result=${result}` : base;
}

export function actionOutcomeDetailHref(
  appId: string,
  runId: string,
  stepId: string,
  outcomeId: string,
): string {
  return `${actionOutcomeCollectionHref(appId, runId, stepId)}/${encodeURIComponent(outcomeId)}`;
}

export function correctActionOutcomeHref(
  appId: string,
  runId: string,
  stepId: string,
  outcomeId: string,
): string {
  return `${actionOutcomeDetailHref(appId, runId, stepId, outcomeId)}/correct`;
}
