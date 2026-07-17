import type { ModuleId } from './registry';
import {
  CANONICAL_OWNERS,
  IA_SECTIONS,
  type CanonicalOwner,
  type CanonicalOwnerId,
  type IaSectionId,
  ownerForPath,
} from './ownership';

export interface NavGroup {
  id: IaSectionId;
  label: string;
  primary: CanonicalOwnerId[];
  secondary: CanonicalOwnerId[];
}

/** The eight accepted top-level jobs, derived from the canonical ownership registry. */
export const NAV_GROUPS: readonly NavGroup[] = IA_SECTIONS.map((section) => {
  const owners = CANONICAL_OWNERS.filter((owner) => owner.section === section.id);
  return {
    id: section.id,
    label: section.label,
    primary: owners.filter((owner) => owner.primary).map((owner) => owner.id),
    secondary: owners.filter((owner) => !owner.primary).map((owner) => owner.id),
  };
});

export interface SidebarSection {
  id: IaSectionId;
  label: string;
  items: CanonicalOwner[];
}

/**
 * Build the sidebar from canonical owners and existing module entitlements. There is deliberately
 * no `More` fallback: every owner must be declared under one of the eight sections, and tests reject
 * missing/duplicate ownership instead of silently inventing a ninth group.
 */
export function sidebarSections(enabledModules: readonly { id: ModuleId }[]): SidebarSection[] {
  const enabled = new Set(enabledModules.map((module) => module.id));
  return NAV_GROUPS.flatMap((group) => {
    const primaryIds = new Set(group.primary);
    const items = CANONICAL_OWNERS.filter(
      (owner) => owner.section === group.id && primaryIds.has(owner.id) && enabled.has(owner.gate),
    );
    return items.length ? [{ id: group.id, label: group.label, items }] : [];
  });
}

/** All enabled canonical owners, including scoped-nav secondaries. */
export function groupModules(enabledModules: readonly { id: ModuleId }[]): SidebarSection[] {
  const enabled = new Set(enabledModules.map((module) => module.id));
  return NAV_GROUPS.flatMap((group) => {
    const items = CANONICAL_OWNERS.filter(
      (owner) => owner.section === group.id && enabled.has(owner.gate),
    );
    return items.length ? [{ id: group.id, label: group.label, items }] : [];
  });
}

/** A secondary owner highlights its section's first visible primary row. */
export function sidebarActiveIdFor(id: CanonicalOwnerId): CanonicalOwnerId | undefined {
  const owner = CANONICAL_OWNERS.find((candidate) => candidate.id === id);
  if (!owner) return undefined;
  if (owner.primary) return owner.id;
  if (owner.sidebarParent) {
    const parent = CANONICAL_OWNERS.find((candidate) => candidate.id === owner.sidebarParent);
    if (parent?.section === owner.section && parent.primary) return parent.id;
  }
  return CANONICAL_OWNERS.find(
    (candidate) => candidate.section === owner.section && candidate.primary,
  )?.id;
}

export function sidebarActiveIdForPath(pathname: string): CanonicalOwnerId | undefined {
  const owner = ownerForPath(pathname);
  return owner ? sidebarActiveIdFor(owner.id) : undefined;
}
