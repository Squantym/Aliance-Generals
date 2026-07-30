// ===================================================================
// scripts/diagnose-season.js — диагностика рейтинга сезона (READONLY).
// Запуск НА ПРОДЕ из корня проекта:  node scripts/diagnose-season.js
// Ничего не изменяет — только читает и печатает отчёт.
// Нужен, чтобы понять жалобу «топ-1 игрок находится в топ-2 и топ-3»:
// покажет дубликаты, состояние weekly у всех игроков и снапшот победителей.
// ===================================================================
process.env.MONGODB_URI = process.env.MONGODB_URI || '';
const db = require('../dist/src/core/db');
const config = require('../dist/config/gameConfig');

(async () => {
  if (db.init) await db.init();
  const users = db.load('users', {});
  const season = db.load('weeklySeason', {});
  const all = Object.values(users).filter((p) => !p.isBot);

  console.log('═══ ОБЩЕЕ ═══');
  console.log('Игроков (без ботов):', all.length);
  console.log('Текущий weekId сезона (из БД):', season.weekId, '| lastWeekId:', season.lastWeekId);

  console.log('\n═══ 1. ДУБЛИКАТЫ ═══');
  const byName = {};
  for (const p of all) {
    const k = String(p.name || '').toLowerCase().trim();
    (byName[k] = byName[k] || []).push(p);
  }
  const dupNames = Object.values(byName).filter((arr) => arr.length > 1);
  if (!dupNames.length) console.log('Дубликатов имён нет.');
  for (const arr of dupNames) {
    console.log(`⚠️ ИМЯ «${arr[0].name}» у ${arr.length} аккаунтов:`);
    for (const p of arr) console.log(`   id=${p.id} lastSeen=${new Date(p.lastSeen || 0).toISOString()} weekly=${JSON.stringify(p.weekly)}`);
  }

  console.log('\n═══ 2. СОСТОЯНИЕ user.weekly ═══');
  let seasonFmt = 0, questFmt = 0, empty = 0, other = 0;
  for (const p of all) {
    const w = p.weekly;
    if (!w) empty++;
    else if (w.weekId) seasonFmt++;
    else if (w.week && w.counters) questFmt++;
    else other++;
  }
  console.log(`сезонный формат: ${seasonFmt} | застрял формат поручений (нужен деплой v53+): ${questFmt} | пусто: ${empty} | иное: ${other}`);
  if (other) for (const p of all) {
    const w = p.weekly;
    if (w && !w.weekId && !(w.week && w.counters)) console.log('  иное у', p.name, JSON.stringify(w).slice(0, 120));
  }

  console.log('\n═══ 3. ПОБЕДИТЕЛИ ПРОШЛОЙ НЕДЕЛИ (снапшот lastWinners) ═══');
  const winners = season.lastWinners || {};
  for (const cat of config.SEASON.categories) {
    const rows = winners[cat.id] || [];
    console.log(`— ${cat.name}:`);
    const seen = {};
    rows.forEach((w, i) => {
      const dup = seen[w.id] ? '  ⚠️ ДУБЛЬ ID В СНАПШОТЕ' : (seen[String(w.name).toLowerCase()] ? '  ⚠️ ДУБЛЬ ИМЕНИ' : '');
      seen[w.id] = true; seen[String(w.name).toLowerCase()] = true;
      const exists = users[w.id] ? '' : '  (аккаунт уже удалён)';
      console.log(`   ${i + 1}. ${w.name} = ${w.value}${dup}${exists}`);
    });
  }

  console.log('\n═══ 4. ТЕКУЩИЙ ТОП ПО КАТЕГОРИИ «УШИ» (как его строит view) ═══');
  const cur = season.weekId;
  const ranked = all
    .map((p) => ({ name: p.name, id: p.id, v: (p.weekly && p.weekly.weekId === cur) ? (Number(p.weekly.ears) || 0) : 0 }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 10);
  ranked.forEach((r, i) => console.log(`   ${i + 1}. ${r.name} = ${r.v}  (id=${r.id})`));

  console.log('\n═══ 5. СЛЕД ПРИНУДИТЕЛЬНОГО ЗАВЕРШЕНИЯ НЕДЕЛИ ═══');
  console.log('Если владелец нажимал в админке «Завершить неделю принудительно» после потери');
  console.log('очков — lastWinners пересчитался по обнулённым данным, и снапшот исказился.');
  console.log('lastWeekId:', season.lastWeekId, '— если равен ТЕКУЩЕЙ неделе, ролловер был принудительным.');
  console.log('Текущая неделя по календарю:', (() => {
    const d = new Date(Date.now() + 3 * 3600 * 1000);
    const dow = (d.getUTCDay() + 6) % 7;
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow));
    return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}-${String(m.getUTCDate()).padStart(2, '0')}`;
  })());
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
