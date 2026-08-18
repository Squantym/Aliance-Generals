// ═══════════════════════════════════════════════════════════════════
// Взлом сейфа: жертва узнаёт о взломе и от кого, подробности — в банке.
// Плюс: в переписке вместо «(без темы)» стоят позывные.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-bankhack-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const player = require(ROOT + '/dist/src/services/player');
const bank = require(ROOT + '/dist/src/services/bankHack');
const social = require(ROOT + '/dist/src/services/social');
const notifications = require(ROOT + '/dist/src/services/notifications');
const db = require(ROOT + '/dist/src/core/db');

async function main() {
for (const [n, e] of [['Взломщик', 'a@t.ru'], ['Жертва', 'b@t.ru'], ['Посторонний', 'c@t.ru']]) {
  await auth.register(n, 'пароль123', e, 'ru', '1.1.1.1');
}
const U = player.users();
const by = (n) => U[Object.keys(U).find((id) => U[id].name === n)];
const att = by('Взломщик'), vic = by('Жертва'), out = by('Посторонний');
vic.bank = 10_000_000;

console.log('\n── 1. Удачный взлом: жертве приходит уведомление ──');
bank.recordHack(att, vic, 'stolen', 2_500_000);
const notesOf = (p) => { const r = notifications.list(p); return r.notifications || r.list || r || []; };
const notes = notesOf(vic);
ok(notes.length > 0, `уведомлений у жертвы: ${notes.length}`);
const nt = notes[0];
ok(/вскрыл/.test(nt.title), `текст: «${nt.title}»`);
ok(/Взломщик/.test(nt.title), 'в уведомлении указан ПОЗЫВНОЙ взломщика');
ok(/2[\s\u00a0]?500[\s\u00a0]?000|2500000/.test(nt.title), 'указана похищенная сумма');
ok(nt.payload && nt.payload.attackerName === 'Взломщик', 'имя есть и в данных уведомления');

console.log('\n── 2. История записана ОБЕИМ сторонам ──');
const hV = bank.history(vic), hA = bank.history(att);
ok(hV.incoming.length === 1, `у жертвы во вкладке «по мне»: ${hV.incoming.length}`);
ok(hV.outgoing.length === 0, 'у жертвы «мои взломы» пусто');
ok(hA.outgoing.length === 1, `у взломщика «мои взломы»: ${hA.outgoing.length}`);
ok(hA.incoming.length === 0, 'у взломщика «по мне» пусто');
const eV = hV.incoming[0], eA = hA.outgoing[0];
ok(eV.attackerName === 'Взломщик', `жертва видит кто: ${eV.attackerName}`);
ok(eA.targetName === 'Жертва', `взломщик видит кого: ${eA.targetName}`);
ok(eV.stolen === 2_500_000 && eA.stolen === 2_500_000, 'сумма одинаковая у обоих');
ok(eV.outcome === 'stolen', 'исход помечен как кража');

console.log('\n── 3. Неудача тоже фиксируется ──');
bank.recordHack(att, vic, 'alarm', 0);
const nt2 = notesOf(vic)[0];
ok(/не смог/.test(nt2.title), `при провале жертве пишут иначе: «${nt2.title}»`);
ok(/Взломщик/.test(nt2.title), 'и тут указан позывной');
const hV2 = bank.history(vic);
ok(hV2.incoming.length === 2, 'запись о неудаче тоже попала в историю');
ok(hV2.incoming[0].outcome === 'alarm' && hV2.incoming[0].stolen === 0,
   'исход «сигнализация», украдено 0');

bank.recordHack(att, vic, 'failed', 0);
const hV3 = bank.history(vic);
ok(hV3.incoming[0].outcome === 'failed', 'неразгаданный код — отдельный исход');

console.log('\n── 4. Порядок и ограничение ──');
const l = bank.history(vic).incoming;
let desc = true;
for (let i = 1; i < l.length; i++) if (l[i - 1].at < l[i].at) desc = false;
ok(desc, 'новые записи сверху');
const PER = bank.BANK_LOG_PER_SIDE;
for (let i = 0; i < PER + 8; i++) bank.recordHack(att, vic, 'failed', 0);
ok(bank.history(vic).incoming.length === PER, `«по мне» ограничены ${PER}`);
ok(bank.history(att).outgoing.length === PER, `«мои взломы» ограничены ${PER}`);
// Свои взломы не должны вытеснять чужие: жертва сама лезет к кому-то
for (let i = 0; i < 5; i++) bank.recordHack(vic, out, 'stolen', 100);
const hV4 = bank.history(vic);
ok(hV4.outgoing.length === 5, `у жертвы появились свои взломы: ${hV4.outgoing.length}`);
ok(hV4.incoming.length === PER, 'и «по мне» осталась полной — вкладки не вытесняют друг друга');

console.log('\n── 5. Посторонний чужой истории не видит ──');
const hOut = bank.history(by('Посторонний'));
ok(hOut.incoming.length === 5, 'он видит ТОЛЬКО то, что касается его самого');
ok(hOut.outgoing.length === 0, 'своих взломов у него нет');

console.log('\n── 6. Почта: «(без темы)» больше не подставляется ──');
social.sendMail(att, 'Жертва', '', 'Верни деньги');
const thread = social.readThread(vic, att.id);
ok(thread.messages.length > 0, 'письмо дошло');
ok(!thread.messages.some((m) => /без темы/i.test(m.subject || '')),
   'заглушки «(без темы)» в письмах нет');
ok(thread.otherName === 'Взломщик', `в переписке виден позывной: ${thread.otherName}`);
const src = fs.readFileSync(path.join(ROOT, 'src/services/social.ts'), 'utf8');
ok(!/\(без темы\)'\)/.test(src), 'сервер больше не подставляет заглушку');
const ui = fs.readFileSync(path.join(ROOT, 'public/js/screens/social.js'), 'utf8');
ok(/ml-who/.test(ui), 'над сообщением рисуется позывной');
ok(/m\.dir === 'out' \? 'Вы' : UI\.esc\(thread\.otherName\)/.test(ui),
   'свои подписаны «Вы», чужие — позывным');
ok(/m\.subject !== '\(без темы\)'/.test(ui), 'старые письма с заглушкой её не покажут');

console.log('\n── 7. Экран банка и маршрут ──');
const rt = fs.readFileSync(path.join(ROOT, 'src/routes.ts'), 'utf8');
ok(/api\/bank\/history/.test(rt), 'маршрут истории сейфа добавлен');
const core = fs.readFileSync(path.join(ROOT, 'public/js/screens/core.js'), 'utf8');
ok(/_renderBankHistory/.test(core), 'история рисуется в банке');
ok(/По мне/.test(core) && /Мои взломы/.test(core), 'две вкладки подписаны');
ok(/сигнализация/.test(core) && /код не подобран/.test(core), 'все три исхода различаются в тексте');
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
ok(/\.bh-row/.test(css) && /\.ml-who/.test(css), 'стили добавлены');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main();
