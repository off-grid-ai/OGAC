import { contextualModuleForPath, type ContextualModule } from './contextual-navigation';
import { IA_SECTIONS, ownerForPath, type CanonicalOwner } from './ownership';

export interface RouteIdentity {
  eyebrow: string;
  title: string;
  description: string;
  ownerId: string;
  /** Whether the shell, rather than the route content, owns the page's one H1. */
  headingOwner: 'shell' | 'content';
}

function identityForContext(module: ContextualModule): RouteIdentity {
  return {
    eyebrow: 'Solutions',
    title: module.label,
    description: module.description,
    ownerId: module.ownerId,
    headingOwner: 'shell',
  };
}

function identityForOwner(owner: CanonicalOwner): RouteIdentity {
  return {
    eyebrow: IA_SECTIONS.find((section) => section.id === owner.section)!.label,
    title: owner.label,
    description: owner.description,
    ownerId: owner.id,
    headingOwner: 'content',
  };
}

/** Resolve the top bar's single canonical identity from the same ownership tree as the Sidebar. */
export function routeIdentityForPath(pathname: string): RouteIdentity | undefined {
  const contextual = contextualModuleForPath(pathname);
  if (contextual) return identityForContext(contextual);
  const owner = ownerForPath(pathname);
  return owner ? identityForOwner(owner) : undefined;
}
