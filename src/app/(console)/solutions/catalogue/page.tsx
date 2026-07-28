import { redirect } from 'next/navigation';

// RETIRED. /solutions/catalogue ran the identical listSolutionBlueprints(orgId) query as
// /solutions/library under a synonymous name, and was never in the sidebar — an orphan duplicate that
// made the section read as two different things. Blueprints now live at /solutions/library only.
// This redirect keeps any existing bookmark or shared link working.
export default function RetiredSolutionCataloguePage() {
  redirect('/solutions/library');
}
