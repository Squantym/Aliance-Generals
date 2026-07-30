#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Диагностика недельного сезона. Только ЧТЕНИЕ, ничего не меняет.
// Показывает, что реально лежит в данных: у кого поле сезона в порядке,
// у кого пусто, есть ли одинаковые имена (из-за них кажется, что игрок
// занимает два места), и как выглядит топ по каждой категории.
//
// Запуск на проде:  cd ~/Aliance-Generals && node tools/season-diag.js
// ═══════════════════════════════════════════════════════════════════
const path = require('path');
const ROOT = path.join(__dirname, '..');
const db = require(path.join(ROOT, 'dist/src/core/db'));
const config = require(path.join(ROOT, 'dist/config/gameConfig'));

(async () => {
  if (db.init) { try { await db.init(); } catch (e) {} }
  await new Promise((r) => setTimeout(r, 1500));   // ждём предзагрузку Mongo

  const users = db.load('users', {});
  const store = db.load('weeklySeason', {});
  const all = Object.values(users).filter((p) => p && !p.isBot);

  // Текущий weekId считаем так же, как сервер (МСК, понедельник)
  const mskNow = new Date(Date.now() + 3 * 3600 * 1000);
  const day = (mskNow.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(mskNow.getUTCFullYear(), mskNow.getUTCMonth(), mskNow.getUTCDate() - day));
  const curWeek = monday.toISOString().slice(0, 10);

  console.log('═══ СОСТОЯНИЕ СЕЗОНА ═══');
  console.log(`Игроков (без ботов): ${all.length}`);
  console.log(`Текущая неделя (расчёт): ${curWeek}`);
  console.log(`Неделя в хранилище:     ${store.weekId || '(пусто)'}`);
  console.log(`Прошлая неделя:         ${store.lastWeekId || '(пусто)'}`);
  if (store.weekId && store.weekId !== curWeek) {
    console.log('⚠️  Недели РАСХОДЯТСЯ — при следующем запросе сработает ролловер (награды + обнуление).');
  }

  console.log('\n═══ ПОЛЕ user.weekly ═══');
  const groups = { ok: [], otherWeek: [], empty: [], legacyQuests: [], broken: [] };
  for (const p of all) {
    const w = p.weekly;
    if (!w) groups.empty.push(p);
    else if (w.week && w.counters && !w.weekId) groups.legacyQuests.push(p);   // формат поручений (баг v50-v52)
    else if (!w.weekId) groups.broken.push(p);
    else if (w.weekId === curWeek) groups.ok.push(p);
    else groups.otherWeek.push(p);
  }
  console.log(`✅ корректное, текущая неделя: ${groups.ok.length}`);
  console.log(`🕓 корректное, прошлая неделя: ${groups.otherWeek.length} (обнулятся при ролловере — это норма)`);
  console.log(`⚪ пусто (null):               ${groups.empty.length} (создастся при первом действии)`);
  console.log(`🔴 формат ПОРУЧЕНИЙ в поле сезона: ${groups.legacyQuests.length} ← след бага v50–v52`);
  console.log(`🔴 непонятный формат:          ${groups.broken.length}`);
  if (groups.legacyQuests.length) {
    console.log('   Пострадавшие:', groups.legacyQuests.slice(0, 15).map((p) => p.name).join(', '));
    console.log('   Их сезонные очки затёрты безвозвратно; после деплоя v53 поле освободится при первом действии.');
  }
  if (groups.weeklyQuestsField === undefined) {
    const migrated = all.filter((p) => p.weeklyQuests).length;
    console.log(`ℹ️  уже переехали на weeklyQuests: ${migrated}`);
  }

  console.log('\n═══ ОДИНАКОВЫЕ ИМЕНА ═══');
  const byName = {};
  for (const p of all) (byName[p.name] = byName[p.name] || []).push(p);
  const dupes = Object.entries(byName).filter(([, arr]) => arr.length > 1);
  if (!dupes.length) console.log('нет — каждое имя уникально');
  else {
    console.log('⚠️  найдены игроки с одинаковыми именами. В топе они выглядят как');
    console.log('    один человек на нескольких местах, хотя это РАЗНЫЕ аккаунты:');
    for (const [name, arr] of dupes) {
      console.log(`  «${name}» → ${arr.length} аккаунта: ${arr.map((p) => `${p.id.slice(0, 8)} (ур.${p.level}, вход ${p.lastSeen ? new Date(p.lastSeen).toISOString().slice(0, 10) : '—'})`).join(' | ')}`);
    }
  }

  console.log('\n═══ ДУБЛИ ПО id ═══');
  const seen = new Set(), idDupes = [];
  for (const p of all) { if (seen.has(p.id)) idDupes.push(p.id); seen.add(p.id); }
  console.log(idDupes.length ? `⚠️  ${idDupes.join(', ')}` : 'нет');

  console.log('\n═══ ТОП ПО КАТЕГОРИЯМ (текущая неделя) ═══');
  for (const cat of config.SEASON.categories) {
    const ranked = all
      .map((p) => ({ name: p.name, id: p.id, v: (p.weekly && p.weekly.weekId === curWeek) ? (Number(p.weekly[cat.metric]) || 0) : 0 }))
      .sort((a, b) => (b.v - a.v) || (a.id < b.id ? -1 : 1));
    const nonZero = ranked.filter((x) => x.v > 0);
    console.log(`\n${cat.icon} ${cat.name}: с ненулевым счётом ${nonZero.length} из ${all.length}`);
    ranked.slice(0, 5).forEach((x, i) => console.log(`  ${i + 1}. ${x.name} — ${x.v}`));
    const winners = (store.lastWinners && store.lastWinners[cat.id]) || [];
    if (winners.length) console.log('  прошлая неделя:', winners.map((w, i) => `${i + 1}. ${w.name} (${w.value})`).join(' · '));
  }

  console.log('\n═══ ВЫВОД ═══');
  if (groups.legacyQuests.length || groups.broken.length) {
    console.log('Есть игроки со сломанным полем сезона — деплойте v53, оно освободится.');
  } else {
    console.log('Поле сезона у всех в порядке. Если цифры малы — значит неделя недавно сбросилась');
    console.log('(смотрите «Неделя в хранилище» и «Прошлая неделя» выше).');
  }
  process.exit(0);
})();
