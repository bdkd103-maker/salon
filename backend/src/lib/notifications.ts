import type { Prisma } from "@prisma/client";

/** Called inside the business transaction. Metadata contains identifiers only. */
export async function notifyOperationalEvent(tx: Prisma.TransactionClient, event: {
  entity: "booking" | "queue"; id: string; salonId: string; customerId: string | null;
  ownerId: string; actorId: string; state: string; revision: string;
}) {
  const recipients = new Set<string>();
  if (event.customerId) recipients.add(event.customerId);
  // Owners need incoming requests/customer changes, not echoes of their own work.
  if (event.actorId !== event.ownerId) recipients.add(event.ownerId);
  for (const userId of recipients) {
    const type = `${event.entity}-${event.state.toLowerCase()}`;
    const eventKey = `${event.entity}:${event.id}:${event.revision}:${userId}`;
    await tx.notification.upsert({
      where: { eventKey }, update: {},
      create: {
        userId, eventKey, type, title: type, body: "", isRead: false,
        metadata: { salonId: event.salonId, entityType: event.entity, entityId: event.id,
          state: event.state, audience: userId === event.ownerId ? "owner" : "customer" },
      },
    });
  }
}
