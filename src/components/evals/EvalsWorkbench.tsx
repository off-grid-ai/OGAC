'use client';

import { useState } from 'react';
import { EvalDefsManager } from '@/components/evals/EvalDefsManager';
import { EvalTemplateCatalog } from '@/components/evals/EvalTemplateCatalog';

// Coordinates the two client surfaces so applying a template immediately refreshes the saved-evals
// list: the catalog bumps a reload key the defs manager watches. Kept as a thin client shell so the
// page stays a server component.
export function EvalsWorkbench() {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div className="space-y-6">
      <EvalTemplateCatalog onApplied={() => setReloadKey((k) => k + 1)} />
      <EvalDefsManager reloadKey={reloadKey} />
    </div>
  );
}
