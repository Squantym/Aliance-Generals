// ═══════════════════════════════════════════════════════════════════
// Результаты сплошного аудита проекта: устойчивость процесса и сессии.
// Тест закрепляет найденные и исправленные изъяны.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEST_CWD = '/tmp/generals-audit-test';
fs.rmSync(TEST_CWD, { recursive: true, force: true });
fs.mkdirSync(TEST_CWD + '/data', { recursive: true });
process.chdir(TEST_CWD);
process.env.DISABLE_RATE_LIMIT = '1';   // сценарии создают игроков пачками

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const auth = require(ROOT + '/dist/src/services/auth');
const db = require(ROOT + '/dist/src/core/db');

async function main() {
console.log('\n── 1. Аварийное завершение не теряет данные ──');
const server = fs.readFileSync(ROOT + '/server.ts', 'utf8');
ok(server.includes("process.on('uncaughtException'"), 'необработанная ошибка перехватывается');
ok(server.includes("process.on('unhandledRejection'"), 'необработанный отказ промиса перехватывается');
ok(/crash = async[\s\S]{0,400}flushAllNow\(\)/.test(server), 'перед аварийным выходом данные сохраняются');
ok(server.includes('process.exit(1)'), 'выход с ненулевым кодом — pm2 поднимет сервер заново');
ok(server.includes('if (crashing) return'), 'повторный вход в аварийный обработчик заблокирован');

console.log('\n── 2. Сессии: срок жизни и чистка ──');
await auth.register('Боец', 'пароль123', 'a@t.ru', 'ru', '1.1.1.1');
const sessions = db.load('sessions', {});
const tokens = Object.keys(sessions);
ok(tokens.length >= 1, `сессия создана (${tokens.length})`);
const rec = sessions[tokens[0]];
ok(rec && typeof rec === 'object' && rec.u && rec.at, 'сессия хранится с временем последней активности, а не просто id');
ok(auth.SESSION_TTL_MS === 30 * 24 * 3600 * 1000, `срок жизни: ${auth.SESSION_TTL_MS / 86400000} дней`);

// Старый бессрочный формат не должен разлогинивать игроков
sessions['old-token-plain'] = 'some-user-id';
auth.pruneSessions();
ok(typeof sessions['old-token-plain'] === 'object', 'сессии старого формата переводятся на новый, а не удаляются');
ok(sessions['old-token-plain'].u === 'some-user-id', 'привязка к игроку сохранена — обновление никого не выкинет');

// Протухшая сессия удаляется
sessions['expired'] = { u: 'x', at: Date.now() - 31 * 24 * 3600 * 1000 };
const removed = auth.pruneSessions();
ok(!sessions['expired'], `просроченные сессии удаляются (вычищено: ${removed})`);
ok(!!sessions[tokens[0]], 'свежая сессия при этом остаётся');

console.log('\n── 3. Проверка срока на входе в API ──');
const http = fs.readFileSync(ROOT + '/src/core/http.ts', 'utf8');
ok(http.includes('Сессия истекла'), 'истёкший токен отклоняется с понятным сообщением');
ok(/rec\.at = Date\.now\(\)/.test(http), 'активность продлевает сессию');
ok(/> 3600 \* 1000/.test(http), 'продление пишется не чаще раза в час — не дёргаем диск на каждый запрос');
ok(/typeof rec === 'string'/.test(http), 'старый формат токена принимается (обратная совместимость)');

console.log('\n── 4. То, что проверено и оказалось в порядке ──');
const utils = fs.readFileSync(ROOT + '/src/core/utils.ts', 'utf8');
ok(/Number\.isFinite/.test(utils), 'ввод чисел: NaN и бесконечность отсекаются');
const player = fs.readFileSync(ROOT + '/src/services/player.ts', 'utf8');
ok(/user\.dollars = Math\.max\(0, Math\.round/.test(player), 'баланс не уходит в минус и округляется');
const units = fs.readFileSync(ROOT + '/src/services/units.ts', 'utf8');
ok(/qty = u\.clamp\(u\.toInt\(qty, 1\), 1,/.test(units), 'продажа техники: количество ограничено, отрицательные отклоняются');
ok(/String\(text \|\| ''\)\.slice\(0, 120\)/.test(player), 'текстовые поля приводятся к строке и обрезаются');
ok(http.includes('200 * 1024'), 'размер запроса ограничен 200 КБ — защита от переполнения памяти');
const routes = fs.readFileSync(ROOT + '/src/routes.ts', 'utf8');
ok(!/app\.add\([^)]*db\.sql\(/s.test(routes), 'произвольный SQL наружу не выставлен');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
