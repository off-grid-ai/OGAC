import type { BuilderCapabilityView, BuilderControlId } from '@/lib/builder-capability-view';

export type BuilderSurfaceContextState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; view: BuilderCapabilityView };

export interface BuilderSurfaceAccess {
  canCreate: boolean;
  canSave: boolean;
  canConfigureData: boolean;
  createExplanation: string;
  saveExplanation: string;
  configureDataExplanation: string;
}

function controlAccess(
  state: BuilderSurfaceContextState,
  id: BuilderControlId,
  action: string,
): { allowed: boolean; explanation: string } {
  if (state.status === 'loading') {
    return { allowed: false, explanation: `Checking whether you can ${action}…` };
  }
  if (state.status === 'error') return { allowed: false, explanation: state.message };

  const control = state.view.controls.find((candidate) => candidate.id === id);
  return {
    allowed: control?.state === 'enabled',
    explanation: control?.explanation ?? `You cannot ${action} in this workspace.`,
  };
}

export function resolveBuilderSurfaceAccess(
  state: BuilderSurfaceContextState,
  editing: boolean,
): BuilderSurfaceAccess {
  const create = controlAccess(state, 'create', 'create apps');
  const save = editing ? controlAccess(state, 'edit', 'edit apps') : create;
  const configureData = controlAccess(state, 'configure-data', 'set up data');
  return {
    canCreate: create.allowed,
    canSave: save.allowed,
    canConfigureData: configureData.allowed,
    createExplanation: create.explanation,
    saveExplanation: save.explanation,
    configureDataExplanation: configureData.explanation,
  };
}
