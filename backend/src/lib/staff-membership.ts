type PersistedStaffMembership = {
  id: string;
  userId: string;
  salonId: string;
  barberId: string;
  status: string;
  revokedAt: Date | null;
  user: {
    id: string;
    role: string;
    status: string;
  };
  salon: {
    id: string;
  };
  barber: {
    id: string;
    salonId: string;
  };
};

type StaffMembershipReader = {
  staffMembership: {
    findMany: (args: unknown) => Promise<PersistedStaffMembership[]>;
  };
};

export const effectiveStaffMembershipSelect = {
  id: true,
  userId: true,
  salonId: true,
  barberId: true,
  status: true,
  revokedAt: true,
  user: { select: { id: true, role: true, status: true } },
  salon: { select: { id: true } },
  barber: { select: { id: true, salonId: true } },
} as const;

export async function resolveEffectiveStaffAccess(
  db: StaffMembershipReader,
  userId: string,
  requestedSalonId: string,
) {
  if (!userId || !requestedSalonId) return null;

  const memberships = await db.staffMembership.findMany({
    where: { userId, salonId: requestedSalonId },
    select: effectiveStaffMembershipSelect,
    take: 2,
  });

  if (memberships.length !== 1) return null;
  const membership = memberships[0];

  if (membership.userId !== userId
    || membership.salonId !== requestedSalonId
    || membership.status !== "ACTIVE"
    || membership.revokedAt !== null
    || membership.user.id !== userId
    || membership.user.role !== "STAFF"
    || membership.user.status !== "ACTIVE"
    || membership.salon.id !== requestedSalonId
    || membership.barber.id !== membership.barberId
    || membership.barber.salonId !== requestedSalonId) {
    return null;
  }

  return membership;
}