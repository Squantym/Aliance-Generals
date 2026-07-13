// Тесты: темы обращений в поддержке + удаление письма из почты. После build.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const db=require('../dist/src/core/db'),auth=require('../dist/src/services/auth'),support=require('../dist/src/services/support'),social=require('../dist/src/services/social'),player=require('../dist/src/services/player');
const N=()=>[];
let passed=0; const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);passed++;console.log('  ✅ '+n);};

(async()=>{
 await db.init();
 await auth.register('Игрок1','password1','p1@a.com','ru','1.1.1.1');
 await auth.register('Смотритель','password1','ad@a.com','ru','1.1.1.2');
 await auth.register('Игрок2','password1','p2@a.com','ru','1.1.1.3');
 const users=player.users();
 const u1=Object.values(users).find(x=>x.name==='Игрок1');
 const adm=Object.values(users).find(x=>x.name==='Смотритель');
 const u2=Object.values(users).find(x=>x.name==='Игрок2');

 console.log('\n[1] createTicket с темой сохраняет category');
 support.createTicket(u1,'suggestion','Идея по балансу','Добавьте новый юнит уровня 50',N());
 support.createTicket(u1,'bug','Баг в бою','Ушёл в чёрный экран при вызове',N());
 support.createTicket(u2,'complaint','Жалоба','Игрок читерит',N());
 const mine=support.myTickets(u1);
 ok('в ответе есть список тем', Array.isArray(mine.categories) && mine.categories.length===6);
 ok('у тикета есть category', mine.open.every(t=>!!t.category));
 ok('у тикета есть человекочитаемая тема', mine.open.some(t=>t.categoryLabel==='Предложения по игре'));

 console.log('\n[2] Неизвестная тема → other (валидация)');
 support.createTicket(u1,'ВЗЛОМ_СИСТЕМЫ','Мусор','какой-то текст подлиннее',N());
 const mine2=support.myTickets(u1);
 ok('невалидная тема заменена на other', mine2.open.some(t=>t.category==='other'));

 console.log('\n[3] adminList: счётчики по темам + фильтр по теме');
 const all=support.adminList({status:'open',category:'all'});
 ok('есть byCategory', !!all.byCategory);
 eq('открытых по suggestion', all.byCategory.suggestion, 1);
 eq('открытых по bug', all.byCategory.bug, 1);
 eq('открытых по complaint', all.byCategory.complaint, 1);
 const onlyBug=support.adminList({status:'open',category:'bug'});
 eq('фильтр по bug вернул только баги', onlyBug.tickets.length, 1);
 eq('это именно баг', onlyBug.tickets[0].category, 'bug');
 const onlyCheater=support.adminList({status:'open',category:'cheater'});
 eq('по cheater пусто', onlyCheater.tickets.length, 0);

 console.log('\n[4] Удаление письма из почты');
 social.sendMail(u1,'Игрок2','Привет','Первое письмо');
 social.sendMail(u1,'Игрок2','','Второе письмо');
 let thread=social.readThread(u2, u1.id);
 eq('у Игрок2 два входящих', thread.messages.length, 2);
 const delId=thread.messages[0].id;
 social.deleteMail(u2, delId);
 thread=social.readThread(u2, u1.id);
 eq('после удаления осталось одно', thread.messages.length, 1);
 ok('удалено именно то письмо', !thread.messages.some(m=>m.id===delId));
 // у отправителя копия на месте
 const senderThread=social.readThread(u1, u2.id);
 eq('у отправителя обе копии целы', senderThread.messages.length, 2);
 let threw=false; try{ social.deleteMail(u2,'НЕСУЩЕСТВУЕТ'); }catch(e){ threw=true; }
 ok('удаление несуществующего письма бросает ошибку', threw);

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
