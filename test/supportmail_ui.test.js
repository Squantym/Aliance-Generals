// jsdom-рендер: выбор темы в поддержке, кнопка удаления письма, подразделы админки.
const assert=require('assert'); const fs=require('fs'); const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>',{url:'http://localhost/'});
global.window=dom.window; global.document=dom.window.document; global.localStorage=dom.window.localStorage; global.location=dom.window.location;
global.fetch=async()=>({ok:true,json:async()=>({})}); localStorage.setItem('gtoken','t');
function load(file,name){ let c=fs.readFileSync(__dirname+'/../'+file,'utf8'); c+=`\n;globalThis.__x=(typeof ${name}!=='undefined')?${name}:undefined;`; eval(c); return globalThis.__x; }
global.UI=load('public/js/ui.js','UI'); global.API=load('public/js/api.js','API');
UI.toast=()=>{}; UI.confirm=async()=>true;
global.App=load('public/js/app.js','App');
App.refreshMe=async()=>{}; App.rerender=()=>{}; App.go=()=>{}; App.me={};
load('public/js/screens/core.js','App'); load('public/js/screens/social.js','App');
global.Admin=load('public/js/admin.js','Admin');

const CATS=[{id:'suggestion',label:'Предложения по игре',icon:'💡'},{id:'complaint',label:'Жалобы',icon:'⚠️'},{id:'bug',label:'Ошибки или баги',icon:'🐞'},{id:'help',label:'Помощь',icon:'❓'},{id:'cheater',label:'Читеры / нарушители',icon:'🚫'},{id:'other',label:'Другое',icon:'💬'}];
let passed=0; const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};

(async()=>{
 const c=document.getElementById('content');

 console.log('\n[1] Экран поддержки: форма нового обращения содержит выбор темы');
 API.get=async()=>({categories:CATS,open:[],closed:[]});
 await App.screens.support(c,'new');
 const sel=c.querySelector('#sup-category');
 ok('есть select#sup-category', !!sel);
 ok('в списке тем 6 вариантов', sel && sel.querySelectorAll('option').length===6);
 ok('есть «Предложения по игре»', /Предложения по игре/.test(c.innerHTML));

 console.log('\n[2] Почта: у каждого письма есть кнопка удаления');
 API.get=async(url)=>{ if(url.startsWith('/api/mail/')) return {otherId:'x',otherName:'Друг',messages:[{id:'m1',dir:'in',subject:'Тема',text:'Привет',at:Date.now()},{id:'m2',dir:'out',subject:'',text:'Ответ',at:Date.now()}]}; return {}; };
 await App.screens.mail(c,'x');
 ok('две кнопки удаления (по числу писем)', c.querySelectorAll('[data-del-mail]').length===2);
 ok('кнопка помечена как «удалить»', /удалить/i.test(c.innerHTML));

 console.log('\n[3] Админка: подразделы по темам');
 API.get=async()=>({categories:CATS,byCategory:{suggestion:2,bug:1,complaint:0,help:0,cheater:0,other:0},tickets:[{id:'t1',userId:'u',userName:'Игрок',category:'bug',categoryLabel:'Ошибки или баги',subject:'Баг',status:'open',messages:[{from:'user',authorName:'Игрок',text:'текст',at:Date.now()}],createdAt:Date.now(),updatedAt:Date.now()}],counts:{open:3,answered:0,closed:0}});
 await Admin.renderSupport(c);
 const catBtns=c.querySelectorAll('[data-sup-cat]');
 ok('кнопок подразделов = 7 (Все + 6 тем)', catBtns.length===7);
 ok('счётчик у suggestion виден (2)', /Предложения по игре \(2\)/.test(c.innerHTML));
 ok('тема показана на тикете', /Тема: Ошибки или баги/.test(c.innerHTML));

 console.log('\n[4] Логотип переименован');
 ok('в app.js логотип «АЛЬЯНС ГЕНЕРАЛОВ»', fs.readFileSync(__dirname+'/../public/js/app.js','utf8').includes('АЛЬЯНС ГЕНЕРАЛОВ'));
 ok('футер «учебных целях» убран', !fs.readFileSync(__dirname+'/../public/js/screens/core.js','utf8').includes('учебных целях'));

 console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
 process.exit(0);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
