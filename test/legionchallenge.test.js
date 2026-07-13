// Регрессия «L is not defined» на экране легиона при наличии вызова.
// Баг: в блоке привязки таймер вызова обращался к переменной L, объявленной
// в другой области видимости → ReferenceError рушил весь экран легиона,
// из-за чего нельзя было принять/отклонить заявку. Требует devDep jsdom.
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body><div id="content"></div></body>', { url:'http://localhost/' });
global.window=dom.window; global.document=dom.window.document;
global.localStorage=dom.window.localStorage; global.location=dom.window.location;
global.fetch=async()=>({ok:true,json:async()=>({})}); localStorage.setItem('gtoken','t');
function loadGlobal(file,name){ let c=fs.readFileSync(__dirname+'/../'+file,'utf8'); c+=`\n;globalThis.__x=(typeof ${name}!=='undefined')?${name}:undefined;`; eval(c); return globalThis.__x; }
global.UI=loadGlobal('public/js/ui.js','UI'); global.API=loadGlobal('public/js/api.js','API');
UI.toast=()=>{}; UI.confirm=async()=>true;
global.App=loadGlobal('public/js/app.js','App');
App.me={ capacity:100, legionId:'legB', level:300 };
App.refreshMe=async()=>{}; App.rerender=()=>{}; App._legionTab='base';
App._flagImg=()=>''; App._showPublicLegion=()=>{}; App._openBattleWindow=()=>{}; App.go=()=>{};
const renderGroupScreen=loadGlobal('public/js/screens/social.js','renderGroupScreen');

const groupView   = JSON.parse(fs.readFileSync(__dirname+'/fixtures/group_view_legion.json','utf8'));
const Lchallenged = JSON.parse(fs.readFileSync(__dirname+'/fixtures/legion_view_challenged.json','utf8'));
const Lchallenger = JSON.parse(fs.readFileSync(__dirname+'/fixtures/legion_view_challenger.json','utf8'));

let passed=0;
const ok=(n,c)=>{assert.ok(c,'❌ '+n);passed++;console.log('  ✅ '+n);};

async function renderWith(L){
  API.get=async(url)=>{
    if(url==='/api/group/legion') return groupView;
    if(url==='/api/legion') return { mine:L };
    if(url==='/api/legion/battle') return { battle:null };
    return {};
  };
  const c=document.getElementById('content');
  c.innerHTML='';
  let err=null;
  try { await renderGroupScreen(c,'legion'); } catch(e){ err=e; }
  return { c, err };
}

(async()=>{
  console.log('\n[1] Входящий вызов (challenged) — экран НЕ падает, есть приём/отклонение');
  let { c, err } = await renderWith(Lchallenged);
  ok('renderGroupScreen НЕ бросил (было "L is not defined")', !err);
  if(err) console.log('   → '+(err.stack||err).split('\n').slice(0,3).join('\n   '));
  ok('баннер вызова отрисован', /ВЫЗОВ НА БОЙ|вызывает вас на бой/i.test(c.innerHTML));
  const timer=c.querySelector('#challenge-timer');
  ok('таймер вызова присутствует', !!timer);
  ok('таймер имеет data-secs (секунды прокинуты без L)', timer && /^\d+$/.test(timer.dataset.secs));
  ok('кнопка «Принять» есть', !!c.querySelector('#lg-accept-challenge'));
  ok('кнопка «Отклонить» есть', !!c.querySelector('#lg-decline-challenge'));

  console.log('\n[2] Исходящий вызов (challenger) — экран НЕ падает, таймер работает');
  ({ c, err } = await renderWith(Lchallenger));
  ok('renderGroupScreen НЕ бросил', !err);
  if(err) console.log('   → '+(err.stack||err).split('\n').slice(0,3).join('\n   '));
  ok('текст «Вызов отправлен»', /Вызов отправлен/i.test(c.innerHTML));
  const t2=c.querySelector('#challenge-timer');
  ok('таймер есть и с data-secs', t2 && /^\d+$/.test(t2.dataset.secs));

  console.log('\n[3] Тик таймера уменьшает значение (интервал жив, без L)');
  const before=c.querySelector('#challenge-timer').textContent;
  await new Promise(r=>setTimeout(r,1100));
  const after=c.querySelector('#challenge-timer').textContent;
  ok('текст таймера обновился за 1 сек', before!==after);
  if(App._challengeTimer) clearInterval(App._challengeTimer);

  console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
  process.exit(0);
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
