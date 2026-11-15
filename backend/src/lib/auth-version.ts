/** Missing fields represent version-zero legacy callers/fixtures only.
 * Deployment requires the migrated schema AND regenerated Prisma client.
 * No version increments are exposed in this foundation phase.
 */
export function validAuthVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
}

export function userAuthVersion(user: { authVersion?: number }): number {
  const version = user.authVersion === undefined ? 0 : user.authVersion;
  if (!validAuthVersion(version)) throw new Error('Invalid persisted authentication version');
  return version;
}

export function accessTokenVersionMatches(payload: { av?: unknown }, user: { id?: string; authVersion?: number }): boolean {
  const current = user.authVersion === undefined ? 0 : user.authVersion;
  if (!validAuthVersion(current)) return false;
  // Legacy JWTs retain their original expiration; never downgrade a versioned account.
  return payload.av === undefined ? current === 0 : validAuthVersion(payload.av) && payload.av === current;
}
