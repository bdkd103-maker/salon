import { Prisma } from "@prisma/client";

export type SalonDeletionClassification =
  | "DELETE_WITH_SALON"
  | "SURVIVE_AS_INDEPENDENT_HISTORY"
  | "SHARED_OR_GLOBAL_DO_NOT_DELETE"
  | "BLOCKING_UNCLASSIFIED";

// Classification is a necessary gate, never an instruction to execute a cascade.
// Historical/reference rows remain blocked until retention equivalence and
// surviving-reference behavior are explicitly resolved. No durations are inferred.
const MODEL_POLICY: Readonly<Record<string, SalonDeletionClassification>> = Object.freeze({
  User: "SHARED_OR_GLOBAL_DO_NOT_DELETE",
  UserSubscription: "SHARED_OR_GLOBAL_DO_NOT_DELETE",
  SalonEnforcement: "SURVIVE_AS_INDEPENDENT_HISTORY",
  SalonRetentionHold: "SURVIVE_AS_INDEPENDENT_HISTORY",
  SalonPurgeClearance: "SURVIVE_AS_INDEPENDENT_HISTORY",
  SalonArchive: "SURVIVE_AS_INDEPENDENT_HISTORY",
  DeviceToken: "SHARED_OR_GLOBAL_DO_NOT_DELETE",
  Salon: "BLOCKING_UNCLASSIFIED",
  SalonLiveStatus: "DELETE_WITH_SALON",
  SalonBoost: "BLOCKING_UNCLASSIFIED",
  LoyaltyCard: "BLOCKING_UNCLASSIFIED",
  LoyaltyCustomer: "BLOCKING_UNCLASSIFIED",
  LoyaltyStamp: "BLOCKING_UNCLASSIFIED",
  Barber: "BLOCKING_UNCLASSIFIED",
  StaffMembership: "BLOCKING_UNCLASSIFIED",
  StaffPresence: "BLOCKING_UNCLASSIFIED",
  StaffPresenceLease: "BLOCKING_UNCLASSIFIED",
  Service: "BLOCKING_UNCLASSIFIED",
  AvailabilitySlot: "BLOCKING_UNCLASSIFIED",
  Booking: "DELETE_WITH_SALON",
  ServiceVisit: "DELETE_WITH_SALON",
  QueueEntry: "DELETE_WITH_SALON",
  Offer: "BLOCKING_UNCLASSIFIED",
  // All persisted review fields are archived; no inbound FK depends on this row.
  // Target-salon scope and the separate retention/readiness gates still apply.
  Review: "DELETE_WITH_SALON",
  Message: "BLOCKING_UNCLASSIFIED",
  SalonMedia: "BLOCKING_UNCLASSIFIED",
  Session: "SHARED_OR_GLOBAL_DO_NOT_DELETE",
  PasswordReset: "SHARED_OR_GLOBAL_DO_NOT_DELETE",
  Notification: "SHARED_OR_GLOBAL_DO_NOT_DELETE",
  AnalyticsEvent: "BLOCKING_UNCLASSIFIED",
  SalonAvailabilitySubscription: "DELETE_WITH_SALON",
  RegistrationVerificationChallenge: "SHARED_OR_GLOBAL_DO_NOT_DELETE",
  VerificationRateLimitBucket: "SHARED_OR_GLOBAL_DO_NOT_DELETE",
});

export function classifySalonDeletionModel(model: string): SalonDeletionClassification {
  return Object.prototype.hasOwnProperty.call(MODEL_POLICY, model)
    ? MODEL_POLICY[model]
    : "BLOCKING_UNCLASSIFIED";
}

// Use generated server schema metadata, never a client-provided inventory.
// Checking all models is deliberately stronger than following only known FKs:
// newly added scalar snapshot links cannot silently evade classification.
export function evaluateSalonDeletionPolicy() {
  const names = Prisma.dmmf.datamodel.models.map(model => model.name).sort();
  const classifications = Object.fromEntries(names.map(name => [name, classifySalonDeletionModel(name)]));
  const unknownModels = names.filter(name => !Object.prototype.hasOwnProperty.call(MODEL_POLICY, name));
  const blockingModels = names.filter(name => classifications[name] === "BLOCKING_UNCLASSIFIED");
  return { complete: blockingModels.length === 0, classifications, unknownModels, blockingModels };
}

// Structural ownership only; callers must also pass all retention/readiness gates.
// No owner-user traversal, and no implication that arbitrary row data is trusted.
export function isTargetSalonOwnedOperationalRecord(
  model: string, row: { salonId?: unknown }, targetSalonId: string,
) {
  return classifySalonDeletionModel(model) === "DELETE_WITH_SALON"
    && typeof targetSalonId === "string" && targetSalonId.length > 0
    && row.salonId === targetSalonId;
}
