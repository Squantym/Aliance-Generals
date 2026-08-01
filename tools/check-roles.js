#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// ПРОВЕРКА ПРАВ НА ЖИВОЙ БАЗЕ
// Показывает, что реально может каждый сотрудник ПРЯМО СЕЙЧАС.
// Только чтение. Запуск:  node tools/check-roles.js
// ═══════════════════════════════════════════════════════════════════
process.env.DB_TOOL_MODE = '1';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
(function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0 && !(t.slice(0, eq).trim() in process.env)) {
      process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
})();
const db = require(path.join(ROOT, 'dist/src/core/db'));
const roles = require(path.join(ROOT, 'dist/src/services/roles'));

(async () => {
  await db.init();
  const users = db.load('users', {});
  const staff = Object.values(users).filter((p) => p.role || p.isAdmin);

  console.log('═══════════════════════════════════════════════════');
  console.log('ПРАВА СОТРУДНИКОВ');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Версия кода: ${fs.existsSync(path.join(ROOT, 'dist/src/services/roles.js')) ? 'собрана' : 'НЕ СОБРАНА — запустите npm run build'}`);
  const hardBlock = /roleOf\(actor\) === 'moderator'/.test(
    fs.readFileSync(path.join(ROOT, 'dist/src/services/roles.js'), 'utf8'));
  console.log(`Жёсткий запрет бана аккаунтов для «Дозора»: ${hardBlock ? '✅ действует' : '⛔ ОТСУТСТВУЕТ — код устарел, обновитесь'}`);

  const savedZones = db.load('roleZones', {});
  console.log(`\nНастройка зон в базе: ${JSON.stringify(savedZones)}`);

  console.log('\n── Сотрудники ──');
  for (const p of staff) {
    const r = roles.roleOf(p);
    const zones = roles.zonesFor(p);
    console.log(`\n  ${p.name} — ${roles.roleLabel(p)} (id ${p.id})`);
    console.log(`    разделов панели: ${zones.length}${zones.length ? ' → ' + zones.join(', ') : ''}`);
    const can = (zone) => roles.canAccessZone(p, zone) ? 'да' : 'нет';
    console.log(`    бан аккаунтов: ${r === 'moderator' ? 'нет (запрещено роли)' : can('moderation')}`);
    console.log(`    выдача ресурсов: ${can('economy')}`);
    console.log(`    смена паролей: ${can('security')}`);
    console.log(`    блокировка чата: да`);
  }
  if (!staff.length) console.log('  (сотрудников нет)');
  console.log('\n═══════════════════════════════════════════════════');
  process.exit(0);
})().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
