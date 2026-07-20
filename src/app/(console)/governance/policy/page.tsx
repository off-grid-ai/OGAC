import { redirect } from 'next/navigation';

/** Legacy singular route; canonical policy navigation lives under /governance/policies/*. */
export default function LegacyPolicyPage() {
  redirect('/governance/policies/overview');
}
