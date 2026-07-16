// Тест push-уведомлений: VAPID-ключи, подписка/отписка, фильтр событий,
// отправка (web-push замокан), очистка мёртвых подписок. После build.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});

// ── Мокаем web-push ДО загрузки push.ts, чтобы не ходить в сеть ──
const wp=require('../node_modules/web-push');
const calls=[]; let failNext=null;
wp.sendNotification=async(sub,data,opts)=>{
  if(failNext && failNext.endpoint===sub.endpoint){ const e=new Error('gone'); e.statusCode=failNext.code; throw e; }
  calls.push({endpoint:sub.endpoint,data:JSON.parse(data),opts});
  return {statusCode:201};
};

const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),player=require('../dist/src/services/player');
const push=require('../dist/src/services/push'),notif=require('../dist/src/services/notifications');
const N=()=>[]; let passed=0;
const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);passed++;console.log('  ✅ '+n);};

const mkSub=(id)=>({endpoint:'https://push.example/'+id,keys:{p256dh:'BKx'+id+'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',auth:'authauthauth'+id}});

(async()=>{
 await db.init();
 await auth.register('Пушкин','password1','p@a.com','ru','1.1.1.1');
 const usr=Object.values(player.users()).find(x=>x.name==='Пушкин');

 console.log('\n[1] VAPID-ключи генерируются и переживают перезапуск');
 const k1=push.getPublicKey();
 ok('публичный ключ выдан', typeof k1==='string' && k1.length>20);
 const saved=db.load('pushconfig',{});
 ok('ключи сохранены в БД (подписки не сломаются при рестарте)', !!saved.publicKey && !!saved.privateKey);
 eq('выдаётся именно сохранённый ключ', k1, saved.publicKey);

 console.log('\n[2] Подписка устройства');
 push.subscribe(usr, mkSub('dev1'));
 eq('одно устройство', push.deviceCount(usr), 1);
 push.subscribe(usr, mkSub('dev2'));
 eq('два устройства', push.deviceCount(usr), 2);
 push.subscribe(usr, mkSub('dev1'));  // повторная подписка того же
 eq('повторная подписка не плодит дубли', push.deviceCount(usr), 2);
 let threw=false; try{ push.subscribe(usr,{endpoint:'x'}); }catch(e){ threw=true; }
 ok('кривая подписка отклонена', threw);

 console.log('\n[3] Отправка уведомления на все устройства игрока');
 calls.length=0;
 const sent=await push.sendToUser(usr.id,{title:'Тест',body:'тело',url:'/#war',tag:'t'});
 eq('доставлено на 2 устройства', sent, 2);
 eq('заголовок передан', calls[0].data.title,'Тест');
 eq('ссылка передана', calls[0].data.url,'/#war');

 console.log('\n[4] Интеграция: важное событие шлёт push, рутина — нет');
 calls.length=0;
 notif.push(usr.id,'legion_battle_start','⚔️ Бой легиона!',{text:'Подготовка 10 минут'});
 await new Promise(r=>setTimeout(r,60));
 eq('бой легиона → push ушёл (2 устройства)', calls.length, 2);
 eq('ссылка ведёт в легион', calls[0].data.url,'/#legion');

 calls.length=0;
 notif.push(usr.id,'legion_build','🏗 Постройка готова',{});
 await new Promise(r=>setTimeout(r,60));
 eq('рутинная постройка → push НЕ шлём (не спамим)', calls.length, 0);

 calls.length=0;
 notif.push(usr.id,'rocket_incoming','🚀 Ракета летит!',{text:'10 минут'});
 await new Promise(r=>setTimeout(r,60));
 ok('срочное событие (ракета) → push ушёл', calls.length>0);

 console.log('\n[5] Мёртвые подписки удаляются автоматически');
 failNext={endpoint:'https://push.example/dev1',code:410};  // 410 Gone
 await push.sendToUser(usr.id,{title:'x',body:'y'});
 eq('мёртвое устройство удалено', push.deviceCount(usr), 1);
 failNext=null;

 console.log('\n[6] Отписка');
 push.unsubscribe(usr,'https://push.example/dev2');
 eq('устройств не осталось', push.deviceCount(usr), 0);
 calls.length=0;
 eq('без подписок отправка ничего не делает', await push.sendToUser(usr.id,{title:'x',body:'y'}), 0);

 console.log('\n[7] Уведомление не ломает игру, если push упал');
 push.subscribe(usr, mkSub('dev3'));
 wp.sendNotification=async()=>{ throw new Error('push-сервис недоступен'); };
 let broke=false;
 try { notif.push(usr.id,'attack_lost','На вас напали',{text:'test'}); await new Promise(r=>setTimeout(r,60)); }
 catch(e){ broke=true; }
 ok('падение push-сервиса не роняет игровое уведомление', !broke);
 ok('уведомление в игре всё равно сохранилось', notif.unreadCount(usr)>0);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
