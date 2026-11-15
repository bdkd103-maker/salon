/** Public directory/profile boundary. Account relations and identifiers never cross it. */
export function projectPublicSalon(salon: any) {
  const fields = [
    'id','name','slug','city','address','latitude','longitude','phone','email','website','description',
    'isActive','isWomenOnly','isVerified','status','bookingIntakeEnabled','saloTicketIntakeEnabled','walkInIntakeEnabled',
    'rating','reviewCount','openingTime','closingTime','workingDays','timeZone','createdAt','updatedAt',
    'isVip','vip','adminVip','classification','baseClassification','vipSource',
    'barbers','offers','services','media',
  ];
  const result: Record<string, any> = {};
  for (const field of fields) if (salon[field] !== undefined) result[field] = salon[field];
  // Owner-configured amenity keys; only this salon's own persisted list is exposed.
  const extras = Array.isArray(salon.extras) ? salon.extras : salon.salonExtras?.extras;
  if (Array.isArray(extras)) result.extras = extras;
  // Review display names are public; reviewer account identifiers are not.
  result.reviews = (salon.reviews || []).map(({userId, user, ...review}: any) => review);
  return result;
}
