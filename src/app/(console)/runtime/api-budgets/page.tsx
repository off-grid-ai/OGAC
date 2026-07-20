import { redirect } from 'next/navigation';

/** Keys are the entry point; spend analysis remains canonically owned by Insights / Cost. */
export default function ApiBudgetsRoot() {
  redirect('/runtime/api-budgets/keys');
}
