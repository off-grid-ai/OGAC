import type { AuthzSession } from '@/lib/authz';
import { OnyxOrganizationalBrain } from '@/lib/adapters/onyx-organizational-brain';
import {
  BrainAuthorizationError,
  BrainPolicyError,
  resolveBrainAuthorization,
  type BrainAccessPolicyEntry,
  type OrganizationalBrainPort,
} from '@/lib/organizational-brain/contracts';
import { currentOrgId } from '@/lib/tenancy';

const POLICY_ENV = 'OFFGRID_ORGANIZATIONAL_BRAIN_ACCESS_POLICY';
const ONYX_URL_ENV = 'ONYX_API_URL';
const ONYX_TOKEN_ENV = 'ONYX_API_TOKEN';

function policyFromEnvironment(): readonly BrainAccessPolicyEntry[] {
  const raw = process.env[POLICY_ENV];
  if (!raw) throw new BrainPolicyError(`${POLICY_ENV} is required`);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error('policy is not an array');
    return parsed as BrainAccessPolicyEntry[];
  } catch (error) {
    if (error instanceof BrainPolicyError) throw error;
    throw new BrainPolicyError(`${POLICY_ENV} is not valid JSON policy`);
  }
}

export async function organizationalBrainRuntime(session: AuthzSession): Promise<{
  authorization: ReturnType<typeof resolveBrainAuthorization>;
  brain: OrganizationalBrainPort;
}> {
  const subjectId = session.user.email?.trim();
  if (!subjectId) throw new BrainPolicyError('authenticated subject identity is missing');
  const apiBaseUrl = process.env[ONYX_URL_ENV]?.trim();
  const apiToken = process.env[ONYX_TOKEN_ENV]?.trim();
  if (!apiBaseUrl || !apiToken) throw new BrainPolicyError(`${ONYX_URL_ENV} and ${ONYX_TOKEN_ENV} are required`);
  const tenantId = await currentOrgId();
  let authorization: ReturnType<typeof resolveBrainAuthorization>;
  try {
    authorization = resolveBrainAuthorization(
      { tenantId, subjectId, role: session.user.role },
      policyFromEnvironment(),
    );
  } catch (error) {
    if (error instanceof BrainAuthorizationError || error instanceof BrainPolicyError) throw error;
    throw new BrainPolicyError(`${POLICY_ENV} does not satisfy the organizational-brain policy contract`);
  }
  return {
    authorization,
    brain: new OnyxOrganizationalBrain({ apiBaseUrl, apiToken }),
  };
}
