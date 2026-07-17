import { SectionNav } from '@/components/nav/SectionNav';

/** @deprecated New code should import SolutionsNav; kept so legacy build layouts stay coherent. */
export function BuildNav() {
  return <SectionNav section="solutions" />;
}
