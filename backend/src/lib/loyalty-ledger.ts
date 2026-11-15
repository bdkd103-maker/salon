/** Completion-backed earning and redemption share the existing stamp ledger. */
import { getLoyaltyProgress } from './loyalty.js';
const conflict = (message:string) => Object.assign(new Error(message), {statusCode:409});

async function event(tx:any, card:any, customerId:string, key:string, state:string, owner=false) {
 const salon=await tx.salon.findUnique({where:{id:card.salonId},select:{ownerId:true}});
 for(const userId of new Set([customerId,...(owner&&salon?.ownerId?[salon.ownerId]:[])])) {
  const eventKey=`loyalty:${key}:${state}:${userId}`;
  await tx.notification.upsert({where:{eventKey},update:{},create:{userId,eventKey,type:'loyalty-'+state.toLowerCase(),title:'loyalty-'+state.toLowerCase(),body:'',metadata:{entityType:'loyalty',entityId:card.id,salonId:card.salonId,state,audience:userId===customerId?'customer':'owner'}}});
 }
}

async function earn(tx:any, source:{salonId:string;customerId:string|null;bookingId?:string|null;visitId?:string|null;barberId?:string|null}) {
 if(!source.customerId)return;
 const card=await tx.loyaltyCard.findFirst({where:{salonId:source.salonId},orderBy:{createdAt:'desc'}});
 if(!card)return;
 await tx.$queryRaw`SELECT "id" FROM "LoyaltyCard" WHERE "id" = ${card.id} FOR UPDATE`;
 const current=await tx.loyaltyCard.findUnique({where:{id:card.id}});
 if(!current?.isActive)return;
 const customer=await tx.user.findUnique({where:{id:source.customerId},select:{role:true,status:true}});
 if(customer?.role!=='CUSTOMER'||customer.status!=='ACTIVE')return;
 const transactionId=source.bookingId?`earn:booking:${source.bookingId}`:`earn:visit:${source.visitId}`;
 const inserted=await tx.loyaltyStamp.createMany({data:[{cardId:card.id,customerId:source.customerId,barberId:source.barberId||null,transactionId,kind:'EARN',amount:1,sourceVisitId:source.visitId||null,sourceBookingId:source.bookingId||null}],skipDuplicates:true});
 if(inserted.count!==1)return;
 const balance=await tx.loyaltyCustomer.upsert({where:{cardId_customerId:{cardId:card.id,customerId:source.customerId}},create:{cardId:card.id,customerId:source.customerId,currentStamps:1,totalVisits:1,lastStampedAt:new Date()},update:{currentStamps:{increment:1},totalVisits:{increment:1},lastStampedAt:new Date()}});
 if(current.rewardActive&&balance.currentStamps===current.requiredStamps)await event(tx,current,source.customerId,transactionId,'READY');
}

export async function earnCompletedServiceVisit(tx:any, visit:any) {
 if(visit.status!=='COMPLETED')return;
 if(visit.bookingId){
  const booking=await tx.booking.findUnique({where:{id:visit.bookingId}});
  if(booking && booking.salonId===visit.salonId)await earn(tx,{salonId:visit.salonId,customerId:booking.userId,bookingId:booking.id,visitId:visit.id,barberId:booking.barberId});
 } else {
  const entry=await tx.queueEntry.findUnique({where:{serviceVisitId:visit.id}});
  if(entry && entry.salonId===visit.salonId)await earn(tx,{salonId:visit.salonId,customerId:entry.customerId,visitId:visit.id});
 }
}

export async function earnCompletedBooking(tx:any, booking:any) {
 if(booking.status!=='COMPLETED')return;
 const visit=await tx.serviceVisit.findUnique({where:{bookingId:booking.id}});
 // A linked actual service must finish before credit, even if booking status changed first.
 if(visit){if(visit.status==='COMPLETED')await earnCompletedServiceVisit(tx,visit);return;}
 await earn(tx,{salonId:booking.salonId,customerId:booking.userId,bookingId:booking.id,barberId:booking.barberId});
}

export async function redeemLoyalty(tx:any, cardId:string, customerId:string, requestId:string) {
 await tx.$queryRaw`SELECT "id" FROM "LoyaltyCard" WHERE "id" = ${cardId} FOR UPDATE`;
 const card=await tx.loyaltyCard.findUnique({where:{id:cardId}});
 if(!card?.isActive||!card.rewardActive)throw conflict('Reward is unavailable');
 const transactionId=`redeem:${customerId}:${requestId}`;
 const previous=await tx.loyaltyStamp.findUnique({where:{transactionId}});
 if(previous)throw conflict('Redemption already processed');
 const where={cardId_customerId:{cardId,customerId}};
 const balance=await tx.loyaltyCustomer.findUnique({where});
 if(!balance||balance.currentStamps<card.requiredStamps)throw conflict('Insufficient stamps');
 const changed=await tx.loyaltyCustomer.updateMany({where:{id:balance.id,currentStamps:{gte:card.requiredStamps}},data:{currentStamps:{decrement:card.requiredStamps},rewardRedeemedAt:new Date()}});
 if(changed.count!==1)throw conflict('Balance changed');
 const redemption=await tx.loyaltyStamp.create({data:{cardId,customerId,transactionId,kind:'REDEEM',amount:-card.requiredStamps,rewardTitle:card.rewardTitle,isValid:false}});
 await event(tx,card,customerId,transactionId,'REDEEMED',true);
 return {redemption,progress:getLoyaltyProgress(balance.currentStamps-card.requiredStamps,card.requiredStamps)};
}
