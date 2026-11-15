// Real local PostgreSQL: extras configuration, canonical persistence, isolation, public projection, cascade.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {fileURLToPath} from 'node:url';import dotenv from 'dotenv';
import {verifyExtrasBrowser} from './verify-extras-browser.js';
import {prisma} from '../src/lib/prisma.js';import {hashPassword} from '../src/lib/auth.js';
dotenv.config({path:fileURLToPath(new URL('../.env',import.meta.url))});const target=new URL(process.env.DATABASE_URL||'http://invalid');assert.ok(['postgres:','postgresql:'].includes(target.protocol)&&['localhost','127.0.0.1'].includes(target.hostname)&&target.pathname==='/salon'&&(target.port||'5432')==='5432'&&['NODE_ENV','APP_ENV','ENVIRONMENT','DEPLOYMENT_ENV','VERCEL_ENV'].every(k=>!process.env[k]||/^(dev|development|local|test|testing)$/.test(process.env[k]!)),'Local DB only');
const users=Array.from({length:3},()=>randomUUID()),salons=[randomUUID(),randomUUID()],password=randomUUID()+'Aa1!';const roles=['OWNER','OWNER','CUSTOMER'],email=(i:number)=>'extras-'+users[i]+'@example.invalid',tokens:string[]=[];let stage='setup';
async function call(actor:number|null,path:string,method='GET',body?:any,expected:any=200){const r=await fetch('http://localhost:4000'+path,{method,headers:{'Content-Type':'application/json',...(actor===null?{}:{Authorization:'Bearer '+tokens[actor]})},...(body?{body:JSON.stringify(body)}:{})});const result=await r.json() as any;if(expected!==null)assert.equal(r.status,expected,path+' '+JSON.stringify(result));return {status:r.status,...result};}
const base=(i:number)=>'/api/v1/salons/'+salons[i];
try{
 const hash=await hashPassword(password);for(let i=0;i<users.length;i++)await prisma.user.create({data:{id:users[i],email:email(i),fullName:'Extras fixture',passwordHash:hash,role:roles[i] as any,emailVerified:true}});
 for(let i=0;i<2;i++)await prisma.salon.create({data:{id:salons[i],ownerId:users[i],name:'Extras fixture '+i,slug:'extras-'+salons[i],city:'Berlin',address:'Fixture',phone:'000',openingTime:'00:00',closingTime:'23:59',timeZone:'Europe/Berlin',workingDays:['mon','tue','wed','thu','fri','sat','sun']}});
 for(let i=0;i<users.length;i++)tokens[i]=(await call(null,'/api/v1/auth/login','POST',{email:email(i),password})).accessToken;
 stage='owner configures extras with canonical order and dedupe';
 const configured=await call(0,base(0)+'/extras','PATCH',{extras:['wheelchairAccess','coffee','coffee','cardPayment']});
 assert.deepEqual(configured.extras,['coffee','cardPayment','wheelchairAccess']);
 assert.deepEqual((await call(0,base(0)+'/extras')).extras,['coffee','cardPayment','wheelchairAccess']);
 assert.equal((await prisma.salonExtras.findUnique({where:{salonId:salons[0]}}))?.extras.join(','),'coffee,cardPayment,wheelchairAccess');
 stage='salon isolation';
 assert.deepEqual((await call(1,base(1)+'/extras')).extras,[]);
 await call(1,base(1)+'/extras','PATCH',{extras:['wifi']});
 assert.deepEqual((await call(0,base(0)+'/extras')).extras,['coffee','cardPayment','wheelchairAccess']);
 stage='authorization boundaries';
 await call(null,base(0)+'/extras','GET',undefined,401);await call(null,base(0)+'/extras','PATCH',{extras:['wifi']},401);
 await call(2,base(0)+'/extras','GET',undefined,403);await call(2,base(0)+'/extras','PATCH',{extras:['wifi']},403);
 await call(1,base(0)+'/extras','PATCH',{extras:['wifi']},403);
 stage='payload validation';
 await call(0,base(0)+'/extras','PATCH',{extras:['jetpack']},400);
 await call(0,base(0)+'/extras','PATCH',{extras:'wifi'},400);
 await call(0,base(0)+'/extras','PATCH',{extras:[1,2]},400);
 await call(0,base(0)+'/extras','PATCH',{extras:null},400);
 await call(0,base(0)+'/extras','PATCH',{extras:['wifi'],enabled:true},400);
 assert.deepEqual((await call(0,base(0)+'/extras')).extras,['coffee','cardPayment','wheelchairAccess'],'rejected payloads never change persisted extras');
 stage='public projection';
 const detailA=await call(null,base(0));assert.deepEqual(detailA.salon.extras,['coffee','cardPayment','wheelchairAccess']);assert.equal(detailA.salon.salonExtras,undefined,'raw relation must not leak');assert.ok(!JSON.stringify(detailA).includes(users[0]));
 const detailB=await call(null,base(1));assert.deepEqual(detailB.salon.extras,['wifi']);assert.ok(!JSON.stringify(detailB).includes(users[1]));
 stage='disable all extras';
 await call(0,base(0)+'/extras','PATCH',{extras:[]});
 assert.deepEqual((await call(0,base(0)+'/extras')).extras,[]);
 assert.deepEqual((await call(null,base(0))).salon.extras,[]);
 stage='extras cascade with salon deletion';
 assert.equal(await prisma.salonExtras.count({where:{salonId:salons[1]}}),1);
 await prisma.salon.delete({where:{id:salons[1]}});
 assert.equal(await prisma.salonExtras.count({where:{salonId:salons[1]}}),0,'SalonExtras rows cascade with the salon');
 if(process.env.EXTRAS_BROWSER==='1')await verifyExtrasBrowser({email,password,salonId:salons[0]});
 console.log('EXTRAS_REAL_POSTGRES_E2E=PASS; canonical persistence, isolation, authorization, validation, public projection, cascade');
}catch(error){console.error('FAILED_STAGE='+stage);throw error;}finally{await prisma.salonExtras.deleteMany({where:{salonId:{in:salons}}});await prisma.salon.deleteMany({where:{id:{in:salons}}});await prisma.session.deleteMany({where:{userId:{in:users}}});await prisma.user.deleteMany({where:{id:{in:users}}});console.log('ISOLATED_FIXTURE_CLEANUP=PASS');await prisma.$disconnect();}
