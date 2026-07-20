import { redirect } from 'next/navigation';

/** Preserve the former flat Secrets URL while making Overview the explicit level-three place. */
export default function SecretsRoot() {
  redirect('/governance/secrets/overview');
}
