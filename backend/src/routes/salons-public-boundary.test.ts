import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../lib/prisma.js';
import { salonRoutes } from './salons.js';

test('public directory and detail omit all private account fields while preserving public business email', async()=>{
 const original=prisma.salon;
 const emails=['admin','owner','staff','customer'].map(role=>role+'-private@example.invalid');
 (prisma as any).salon={findMany:async()=>[{id:'salon',ownerId:'private-owner-id',name:'Public Salon',city:'Berlin',email:'business@example.invalid',isActive:true,
 owner:{email:emails[1]},ownerEmail:emails[1],ownerUsername:emails[0],customer:{email:emails[3]},staffMemberships:[{user:{email:emails[2]}}],
 services:[],media:[],reviews:[{id:'review',salonId:'salon',userId:'private-reviewer-id',rating:4,user:{fullName:'Public Reviewer',email:emails[3]}}]}]};
 const app=Fastify();await salonRoutes(app);
 try{for(const url of ['/api/v1/salons','/api/v1/salons/salon']){
  const response=await app.inject({method:'GET',url});assert.equal(response.statusCode,200,response.body);
  for(const value of [...emails,'private-owner-id','private-reviewer-id'])assert.ok(!response.body.includes(value));
  const salon=response.json().salon||response.json().salons[0];assert.equal(salon.email,'business@example.invalid');assert.equal(salon.reviews[0].name,'Public Reviewer');
  assert.equal('ownerId'in salon,false);assert.equal('owner'in salon,false);assert.equal('userId'in salon.reviews[0],false);
 }}finally{(prisma as any).salon=original;await app.close();}
});
