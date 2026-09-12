export type QueueEntryStatus =
  | "WAITING"
  | "CALLED"
  | "STARTED"
  | "CANCELLED"
  | "EXPIRED"
  | "NO_SHOW";

export type QueueTransition =
  | "CALL"
  | "START"
  | "CANCEL"
  | "EXPIRE"
  | "NO_SHOW";

const allowedTransitions: Record<
  QueueEntryStatus,
  Partial<Record<QueueTransition, QueueEntryStatus>>
> = {
  WAITING: {
    CALL: "CALLED",
    START: "STARTED",
    CANCEL: "CANCELLED",
    EXPIRE: "EXPIRED",
  },
  CALLED: {
    START: "STARTED",
    CANCEL: "CANCELLED",
    EXPIRE: "EXPIRED",
    NO_SHOW: "NO_SHOW",
  },
  STARTED: {},
  CANCELLED: {},
  EXPIRED: {},
  NO_SHOW: {},
};

export function getQueueTransition(
  currentStatus: QueueEntryStatus,
  transition: QueueTransition,
): QueueEntryStatus {
  const nextStatus = allowedTransitions[currentStatus]?.[transition];

  if (!nextStatus) {
    throw new Error(
      `Invalid queue transition: ${currentStatus} -> ${transition}`,
    );
  }

  return nextStatus;
}

export function isActiveSaloTicketStatus(
  status: QueueEntryStatus,
): boolean {
  return status === "WAITING" || status === "CALLED";
}