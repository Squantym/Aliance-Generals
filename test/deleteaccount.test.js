// ═══════════════════════════════════════════════════════════════════
// test/deleteaccount.test.js — удаление аккаунта отчитывается честно
//
// Аккаунт чистится по коллекциям, и каждая — в своём try/catch. Это
// правильно: падение одной не должно срывать остальные, тот же принцип,
// что у раздельных тиков в worldTick.
//
// Но раньше падение было ещё и БЕЗМОЛВНЫМ. Коллекция просто не
// появлялась в списке очищенного, а сообщение при этом обещало, что
// аккаунт удалён «полностью». Для проекта, который сам ссылается на
// 152-ФЗ, это означало: удаление отчиталось об успехе, а персональные
// данные где-то остались — и узнать об этом было неоткуда.
//
// Здесь запись ОДНОЙ коллекции ломается нарочно, и проверяется, что:
//   • остальные всё равно вычищены (изоляция не потеряна);
//   • пропущенная названа в ответе;
//   • слово «полностью» из сообщения исчезает.
//
// Запуск: node test/deleteaccount.test.js  (после npm run build)
// ═══════════════════════════════════════════════════════════════════
const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.env.MONGODB_URI = '';
require('./_guard');   // не даёт стереть боевую data/
const DATA = path.join(process.cwd(), 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

const db = require('../dist/src/core/db');
const auth = require('../dist/src/services/auth');
const player = require('../dist/src/services/player');
const admin = require('../dist/src/services/admin');

let passed = 0, failed = 0;
const ok = (n, c) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

(async () => {
  await db.init();
  await auth.register('Хозяин', 'пароль123', 'v@t.ru', 'ru', '1.1.1.1');
  await auth.register('Жертва', 'пароль123', 'j@t.ru', 'ru', '1.1.1.1');
  const U = player.users();
  const by = (n) => Object.values(U).find((x) => x.name === n);
  const boss = by('Хозяин');
  const victim = by('Жертва');
  boss.isAdmin = true; boss.role = 'owner';

  // Кладём удаляемому данные в две коллекции, чтобы было что чистить.
  const mail = db.load('mail', {});
  mail[victim.id] = [{ at: Date.now(), text: 'письмо' }];
  const notif = db.load('notifications', {});
  notif[victim.id] = [{ at: Date.now(), text: 'уведомление' }];
  db.save('mail'); db.save('notifications');

  console.log('\n── 1. Когда всё в порядке ──');
  // Сначала обычный случай: без поломок «полностью» законно.
  const okNotices = [];
  const res1 = admin.deleteAccount(boss, { userId: victim.id, confirmName: 'Жертва' }, okNotices);
  ok('аккаунт удалён', res1.deletedName === 'Жертва');
  ok('почта вычищена', (res1.cleaned || []).indexOf('mail') !== -1);
  ok('уведомления тоже', (res1.cleaned || []).indexOf('notifications') !== -1);
  ok('пропущенных нет', (res1.failed || []).length === 0);
  ok('и сказано «полностью»', /полностью/.test(okNotices.join(' ')));

  console.log('\n── 2. Одна коллекция не сохраняется ──');
  // Ломаем запись ровно одной коллекции. Это ближе к жизни, чем кажется:
  // на своей базе запись может не пройти из-за блокировки файла или
  // нехватки места, и происходит это ровно с одной таблицей.
  await auth.register('Второй', 'пароль123', 'j2@t.ru', 'ru', '1.1.1.1');
  const victim2 = Object.values(player.users()).find((x) => x.name === 'Второй');
  const mail2 = db.load('mail', {});
  mail2[victim2.id] = [{ at: Date.now(), text: 'письмо' }];
  const notif2 = db.load('notifications', {});
  notif2[victim2.id] = [{ at: Date.now(), text: 'уведомление' }];
  db.save('mail'); db.save('notifications');

  const realSave = db.save;
  db.save = function (name) {
    if (name === 'mail') throw new Error('нарочная поломка записи');
    return realSave.apply(db, arguments);
  };
  const badNotices = [];
  let res2 = null;
  try {
    res2 = admin.deleteAccount(boss, { userId: victim2.id, confirmName: 'Второй' }, badNotices);
  } finally {
    db.save = realSave;
  }

  ok('удаление всё равно доведено до конца', !!res2 && res2.deletedName === 'Второй');
  // Главное: изоляция не потеряна — соседняя коллекция вычищена.
  ok('соседняя коллекция вычищена', (res2.cleaned || []).indexOf('notifications') !== -1);
  ok('сломанная НЕ числится очищенной', (res2.cleaned || []).indexOf('mail') === -1);
  ok('и она названа среди пропущенных', (res2.failed || []).indexOf('mail') !== -1);

  console.log('\n── 3. Сообщение больше не врёт ──');
  const txt = badNotices.join(' ');
  ok('слова «полностью» нет', !/полностью/.test(txt));
  ok('сказано, что вычищено не всё', /НЕ ВСЁ/.test(txt));
  ok('названа пропущенная коллекция', /mail/.test(txt));
  ok('и куда смотреть за причиной', /журнал/.test(txt));

  console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('⛔ ' + (e && e.stack || e)); process.exit(1); });
