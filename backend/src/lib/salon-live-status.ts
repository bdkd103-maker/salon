type LiveStatusSnapshot = {
  operationalState: string | null;
  observedAt: Date | null;
  expiresAt: Date | null;
};

export const publicLiveStatusSelect = {
  operationalState: true,
  observedAt: true,
  expiresAt: true,
} as const;

export function projectPublicLiveStatus(snapshot: LiveStatusSnapshot | null | undefined, now = Date.now()) {
  if (!snapshot || typeof snapshot.operationalState !== "string" || !snapshot.operationalState.trim()) return null;
  const observedAt = snapshot.observedAt instanceof Date ? snapshot.observedAt.getTime() : NaN;
  const expiresAt = snapshot.expiresAt instanceof Date ? snapshot.expiresAt.getTime() : NaN;
  if (!Number.isFinite(observedAt) || !Number.isFinite(expiresAt)
    || observedAt > now || expiresAt <= now) return null;

  return {
    operationalState: snapshot.operationalState,
    observedAt: snapshot.observedAt!.toISOString(),
    expiresAt: snapshot.expiresAt!.toISOString(),
  };
}
