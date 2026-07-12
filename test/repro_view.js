process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),legion=require('../dist/src/services/legion'),lb=require('../dist/src/services/legionBattle'),player=require('../dist/src/services/player'),cfg=require('../dist/config/gameConfig');
const N=()=>[];
const step=(l,fn)=>{try{const r=fn();console.log('✅ '+l);return r;}catch(e){console.log('❌ '+l+'\n   → '+((e&&e.stack)?e.stack.split('\n').slice(0,6).join('\n   '):e));return null;}};
(async()=>{
 await db.init();
 await auth.register('ЛидерА','password1','a@a.com','ru','1.1.1.1');
 await auth.register('ЛидерБ','password1','b@b.com','ru','1.1.1.2');
 await auth.register('БоецА2','password1','c@c.com','ru','1.1.1.3'); // рядовой член легиона A
 const users=player.users();
 const uA=Object.values(users).find(x=>x.name==='ЛидерА'),uB=Object.values(users).find(x=>x.name==='ЛидерБ'),uC=Object.values(users).find(x=>x.name==='БоецА2');
 const legs=db.load('legions',{}); const item=Object.keys(cfg.LEGION_SHOP_ITEM_BY_ID)[0];
 legs['legA']={id:'legA',name:'Альфа',leaderId:uA.id,members:[uA.id,uC.id],activeBattle:null,pendingChallenge:null,arsenal:{[item]:3},battleBuildings:{gear_slots:1}};
 legs['legB']={id:'legB',name:'Браво',leaderId:uB.id,members:[uB.id],activeBattle:null,pendingChallenge:null,arsenal:{},battleBuildings:{}};
 uA.legionId='legA';uC.legionId='legA';uB.legionId='legB';db.save('legions');db.save('users');

 console.log('\n== ФАЗА: нет вызова ==');
 step('view(A лидер)',()=>legion.view(uA));
 step('view(C рядовой)',()=>legion.view(uC));

 console.log('\n== ФАЗА: A бросил вызов B ==');
 step('challengeLegion(A→B)',()=>legion.challengeLegion(uA,'legB',N()));
 step('view(A challenger)',()=>legion.view(uA));
 step('view(C член challenger)',()=>legion.view(uC));
 step('view(B challenged-лидер)',()=>legion.view(uB));

 console.log('\n== ФАЗА: B принял → PREP ==');
 step('acceptChallenge(B)',()=>legion.acceptChallenge(uB,N()));
 step('view(A) PREP',()=>legion.view(uA));
 step('view(C) PREP',()=>legion.view(uC));
 step('view(B) PREP',()=>legion.view(uB));
 step('battleState(A) PREP',()=>lb.battleState(uA));
 step('battleState(C) PREP',()=>lb.battleState(uC));

 console.log('\n=== готово ===');
 process.exit(0);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
