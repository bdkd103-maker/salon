import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../lib/prisma.js';
import { signAccessToken } from '../lib/jwt.js';
import { dashboardRoutes } from './dashboard.js';
import { notifyOperationalEvent } from '../lib/notifications.js';

test('operational recipient selection, retry dedupe and metadata privacy', async () => {
  const rows = new Map();
  const tx: any = { notification: { upsert: async ({where,create}:any) => { if(!rows.has(where.eventKey))rows.set(where.eventKey,create); return rows.get(where.eventKey); } } };
  const event = {entity:'booking' as const,id:'booking',salonId:'salon',customerId:'customer',ownerId:'owner',actorId:'customer',state:'CREATED',revision:'created'};
  await notifyOperationalEvent(tx,event);await notifyOperationalEvent(tx,event);
  assert.equal(rows.size,2);assert.deepEqual([...rows.values()].map(r=>r.userId),['customer','owner']);
  assert.deepEqual(Object.keys([...rows.values()][0].metadata).sort(),['audience','entityId','entityType','salonId','state']);
  await notifyOperationalEvent(tx,{...event,actorId:'owner',state:'CONFIRMED',revision:'confirmed'});
  assert.equal(rows.size,3);assert.equal([...rows.values()][2].userId,'customer');
  await notifyOperationalEvent(tx,{...event,entity:'queue',state:'STARTED',revision:'started',actorId:'owner'});
  assert.equal(rows.size,4);assert.ok(![...rows.values()].some(r=>r.userId==='staff'));
});

test('private feed/read APIs enforce authenticated recipient even for ADMIN; failures are not fake auth errors', async () => {
  const original={user:prisma.user,notification:prisma.notification,$transaction:prisma.$transaction};
  const oldSecret=process.env.JWT_ACCESS_SECRET;process.env.JWT_ACCESS_SECRET='notification-unit-only';
  const rows:any[]=[{id:'a',userId:'alice',type:'booking-created',isRead:false,createdAt:new Date()}, {id:'b',userId:'bob',type:'queue-created',isRead:false,createdAt:new Date()}, {id:'consent',userId:'alice',type:'gdpr',isRead:false}];
  const match=(r:any,w:any)=>r.userId===w.userId && r.type!=='gdpr' && (!w.id||w.id.in.includes(r.id)) && (w.isRead===undefined||r.isRead===w.isRead);
  let unavailable=false;
  (prisma as any).user={findUnique:async({where}:any)=>({id:where.id,role:where.id==='admin'?'ADMIN':'CUSTOMER',status:'ACTIVE'})};
  (prisma as any).notification={findMany:async({where,take}:any)=>{if(unavailable)throw Error('offline');assert.equal(take,100);return rows.filter(r=>match(r,where));},count:async({where}:any)=>rows.filter(r=>match(r,where)).length,updateMany:async({where,data}:any)=>{rows.filter(r=>match(r,where)).forEach(r=>Object.assign(r,data));return{count:1};}};
  (prisma as any).$transaction=async(values:any)=>Promise.all(values);
  const app=Fastify();await dashboardRoutes(app);
  const call=(user:string|null,body?:any)=>app.inject({method:body?'POST':'GET',url:body?'/api/v1/notifications/read':'/api/v1/notifications',...(user?{headers:{authorization:'Bearer '+signAccessToken({sub:user,role:'ADMIN'})}}:{}),...(body?{payload:body}:{})});
  try{
    assert.equal((await call(null)).statusCode,401);
    assert.equal((await call(null,{readAll:true})).statusCode,401);
    const feed=await call('alice');assert.equal(feed.statusCode,200);assert.equal(feed.json().unreadCount,1);assert.deepEqual(feed.json().notifications.map((r:any)=>r.id),['a']);
    for(const actor of ['bob','admin'])assert.equal((await call(actor,{notificationIds:['a']})).statusCode,404);
    assert.equal((await call('alice',{notificationIds:['a','b']})).statusCode,404);assert.equal(rows[0].isRead,false);
    assert.equal((await call('alice',{notificationIds:['a']})).statusCode,200);assert.ok(rows[0].readAt instanceof Date);const readAt=rows[0].readAt;
    await call('alice',{notificationIds:['a']});assert.equal(rows[0].readAt,readAt);assert.equal((await call('alice')).json().unreadCount,0);
    await call('bob',{readAll:true});assert.equal(rows[1].isRead,true);assert.equal(rows[2].isRead,false);
    unavailable=true;assert.equal((await call('alice')).statusCode,500);
  }finally{Object.assign(prisma,original);if(oldSecret===undefined)delete process.env.JWT_ACCESS_SECRET;else process.env.JWT_ACCESS_SECRET=oldSecret;await app.close();}
});
