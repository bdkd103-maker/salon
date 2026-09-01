export function getLoyaltyProgress(stamps: number, requiredStamps: number) {
  const safeRequired = Math.max(1, Number(requiredStamps) || 1);
  const safeStamps = Math.max(0, Number(stamps) || 0);
  const remaining = Math.max(0, safeRequired - safeStamps);
  const isRewardReady = safeStamps >= safeRequired;

  return {
    stamps: safeStamps,
    requiredStamps: safeRequired,
    remaining,
    isRewardReady,
  };
}

export function createVisitKey(cardId: string, customerId: string, issuedAt: Date) {
  return `${cardId}:${customerId}:${issuedAt.toISOString()}`;
}

export function buildStampTransactionId() {
  return `stamp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
