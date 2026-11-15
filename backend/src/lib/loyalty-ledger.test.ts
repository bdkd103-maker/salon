import test from 'node:test';
import assert from 'node:assert/strict';
import {earnCompletedBooking,earnCompletedServiceVisit,redeemLoyalty} from './loyalty-ledger.js';
function fixture(){
 const ledger:any[]=[];let stamps=0;
 const card={id:'card',salonId:'salon',isActive:true,rewardActive:true,requiredStamps:2,rewardTitle:'Reward'};
 const tx:any={$queryRaw:async()=>[],loyaltyCard:{findFirst:async()=>card,findUnique:async()=>card},user:{findUnique:async()=>({role:'CUSTOMER',status:'ACTIVE'})},booking:{findUnique:async()=>({id:'booking',salonId:'salon',userId:'customer'})},queueEntry:{findUnique:async()=>({salonId:'salon',customerId:'customer'})},serviceVisit:{findUnique:async()=>null},salon:{findUnique:async()=>({ownerId:'owner'})},notification:{upsert:async()=>{}},loyaltyStamp:{createMany:async({data}:any)=>{if(ledger.some(x=>x.transactionId===data[0].transactionId))return{count:0};ledger.push(data[0]);return{count:1};},findUnique:async()=>null},loyaltyCustomer:{upsert:async()=>({currentStamps:++stamps}),findUnique:async()=>({id:'balance',currentStamps:stamps})}};
 return {tx,card,ledger,balance:()=>stamps};
}
test('only completed visits earn',async()=>{const f=fixture();for(const status of ['IN_SERVICE','CANCELLED'])await earnCompletedServiceVisit(f.tx,{id:'visit',salonId:'salon',status});assert.equal(f.ledger.length,0);});
test('booking and linked service share one persisted transaction key',async()=>{const f=fixture();const visit={id:'visit',bookingId:'booking',salonId:'salon',status:'COMPLETED'};await earnCompletedServiceVisit(f.tx,visit);f.tx.serviceVisit.findUnique=async()=>visit;await earnCompletedBooking(f.tx,{id:'booking',status:'COMPLETED'});assert.equal(f.balance(),1);assert.equal(f.ledger.length,1);assert.equal(f.ledger[0].transactionId,'earn:booking:booking');});
test('linked in-service booking defers credit',async()=>{const f=fixture();f.tx.serviceVisit.findUnique=async()=>({status:'IN_SERVICE'});await earnCompletedBooking(f.tx,{id:'booking',status:'COMPLETED'});assert.equal(f.balance(),0);});
test('anonymous or mismatched-salon visit cannot earn',async()=>{const f=fixture();for(const entry of [null,{salonId:'other',customerId:'customer'},{salonId:'salon',customerId:null}]){f.tx.queueEntry.findUnique=async()=>entry;await earnCompletedServiceVisit(f.tx,{id:'visit',salonId:'salon',status:'COMPLETED'});}assert.equal(f.ledger.length,0);});
test('inactive program cannot earn',async()=>{const f=fixture();f.card.isActive=false;await earnCompletedServiceVisit(f.tx,{id:'visit',salonId:'salon',status:'COMPLETED'});assert.equal(f.balance(),0);});
test('redemption rejects disabled reward and insufficient balance',async()=>{const f=fixture();await assert.rejects(()=>redeemLoyalty(f.tx,'card','customer','request'),/Insufficient/);f.card.rewardActive=false;await assert.rejects(()=>redeemLoyalty(f.tx,'card','customer','request'),/unavailable/);});
