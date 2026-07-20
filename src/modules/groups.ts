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
  navigation: 'direct' | 'grouped';
  dashboardRoute: string;
  sidebar: CanonicalOwnerId[];
  contextual: CanonicalOwnerId[];
}

/** The eight accepted top-level jobs, derived from the canonical ownership registry. */
export const NAV_GROUPS: readonly NavGroup[] = IA_SECTIONS.map((section) => {
  const owners = CANONICAL_OWNERS.filter((owner) => owner.section === section.id);
  return {
    id: section.id,
    label: section.label,
    navigation: section.navigation,
    dashboardRoute: section.dashboardRoute,
    sidebar: owners.filter((owner) => owner.placement === 'sidebar').map((owner) => owner.id),
    contextual: owners.filter((owner) => owner.placement === 'contextual').map((owner) => owner.id),
  };
});

export interface SidebarSection {
  id: IaSectionId;
  label: string;
  navigation: 'direct' | 'grouped';
  dashboardRoute: string;
  items: CanonicalOwner[];
}

/**
 * Build the only global navigation from explicit sidebar placements and existing entitlements.
 * Contextual resources stay inside their declared parent journey.
 */
export function sidebarSections(enabledModules: readonly { id: ModuleId }[]): SidebarSection[] {
  const enabled = new Set(enabledModules.map((module) => module.id));
  return NAV_GROUPS.flatMap((group) => {
    const sidebarIds = new Set(group.sidebar);
    const items = CANONICAL_OWNERS.filter(
      (owner) => owner.section === group.id && sidebarIds.has(owner.id) && enabled.has(owner.gate),
    );
    return items.length
      ? [
          {
            id: group.id,
            label: group.label,
            navigation: group.navigation,
            dashboardRoute: group.dashboardRoute,
            items,
          },
        ]
      : [];
  });
}

/** Resolve the single accordion branch that owns the active sidebar item. */
export function sidebarSectionIdForActiveId(
  sections: readonly SidebarSection[],
  activeId: CanonicalOwnerId | undefined,
): IaSectionId | undefined {
  if (!activeId) return undefined;
  return sections.find((section) => section.items.some((item) => item.id === activeId))?.id;
}

/** Resolve the URL-owned active accordion branch, including the section dashboard itself. */
export function sidebarSectionIdForPath(
  sections: readonly SidebarSection[],
  pathname: string,
): IaSectionId | undefined {
  const dashboardSection = sections.find((section) => section.dashboardRoute === pathname);
  if (dashboardSection) return dashboardSection.id;
  return sidebarSectionIdForActiveId(sections, sidebarActiveIdForPath(pathname));
}

/** All enabled canonical owners, including contextual resources. */
export function groupModules(enabledModules: readonly { id: ModuleId }[]): SidebarSection[] {
  const enabled = new Set(enabledModules.map((module) => module.id));
  return NAV_GROUPS.flatMap((group) => {
    const items = CANONICAL_OWNERS.filter(
      (owner) => owner.section === group.id && enabled.has(owner.gate),
    );
    return items.length
      ? [
          {
            id: group.id,
            label: group.label,
            navigation: group.navigation,
            dashboardRoute: group.dashboardRoute,
            items,
          },
        ]
      : [];
  });
}

/** A contextual owner highlights its declared sidebar parent. */
export function sidebarActiveIdFor(id: CanonicalOwnerId): CanonicalOwnerId | undefined {
  const owner = CANONICAL_OWNERS.find((candidate) => candidate.id === id);
  if (!owner) return undefined;
  if (owner.placement === 'sidebar') return owner.id;
  if (owner.sidebarParent) {
    const parent = CANONICAL_OWNERS.find((candidate) => candidate.id === owner.sidebarParent);
    if (parent?.section === owner.section && parent.placement === 'sidebar') return parent.id;
  }
  return undefined;
}

export function sidebarActiveIdForPath(pathname: string): CanonicalOwnerId | undefined {
  const owner = ownerForPath(pathname);
  return owner ? sidebarActiveIdFor(owner.id) : undefined;
}
