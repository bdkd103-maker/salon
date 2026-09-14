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
  // V8 binds every root field and surviving Message provenance. Delete only after
  // controlled dependents and same-transaction archive/retention/readiness checks.
  Salon: "DELETE_WITH_SALON",
  SalonLiveStatus: "DELETE_WITH_SALON",
  SalonBoost: "DELETE_WITH_SALON",
  LoyaltyCard: "DELETE_WITH_SALON",
  LoyaltyCustomer: "DELETE_WITH_SALON",
  LoyaltyStamp: "DELETE_WITH_SALON",
  Barber: "DELETE_WITH_SALON",
  StaffMembership: "DELETE_WITH_SALON",
  StaffPresence: "DELETE_WITH_SALON",
  StaffPresenceLease: "DELETE_WITH_SALON",
  Service: "DELETE_WITH_SALON",
  AvailabilitySlot: "DELETE_WITH_SALON",
  Booking: "DELETE_WITH_SALON",
  ServiceVisit: "DELETE_WITH_SALON",
  QueueEntry: "DELETE_WITH_SALON",
  // Only rows whose salonId matches the target; null/global offers survive.
  Offer: "DELETE_WITH_SALON",
  // All persisted review fields are archived; no inbound FK depends on this row.
  // Target-salon scope and the separate retention/readiness gates still apply.
  Review: "DELETE_WITH_SALON",
  // Conversation history survives; Salon deletion only sets salonId to null.
  // Never traverse sender/receiver Users or include messages in dependent deletion.
  Message: "SURVIVE_AS_INDEPENDENT_HISTORY",
  // DB metadata only: all five fields are archived. URLs are not archived bytes
  // and this classification never authorizes external media/blob deletion.
  SalonMedia: "DELETE_WITH_SALON",
  Session: "SHARED_OR_GLOBAL_DO_NOT_DELETE",
  PasswordReset: "SHARED_OR_GLOBAL_DO_NOT_DELETE",
  Notification: "SHARED_OR_GLOBAL_DO_NOT_DELETE",
  AnalyticsEvent: "DELETE_WITH_SALON",
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
  model: string, row: { id?: unknown; salonId?: unknown }, targetSalonId: string,
) {
  return classifySalonDeletionModel(model) === "DELETE_WITH_SALON"
    && typeof targetSalonId === "string" && targetSalonId.length > 0
    && (model === "Salon" ? row.id === targetSalonId : row.salonId === targetSalonId);
}
