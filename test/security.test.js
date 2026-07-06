// Тест безопасного сравнения пароля (verifyPassword, timingSafeEqual).
// Запуск: node test/security.test.js  (после npm run build)
const assert = require('assert');
const u = require('../dist/src/core/utils');

let passed = 0;
const ok = (n, cond) => { assert.ok(cond, '❌ ' + n); passed++; console.log('  ✅ ' + n); };

console.log('\n[1] Верный пароль проходит, неверный — нет');
const salt = u.uid(16);
const hash = u.hashPassword('CorrectHorse7', salt);
ok('верный пароль совпадает', u.verifyPassword('CorrectHorse7', salt, hash) === true);
ok('неверный пароль не совпадает', u.verifyPassword('WrongPass1', salt, hash) === false);
ok('верный пароль с другой солью не совпадает', u.verifyPassword('CorrectHorse7', u.uid(16), hash) === false);

console.log('\n[2] Устойчивость к мусорному/пустому хэшу (без исключений)');
ok('пустой ожидаемый хэш → false', u.verifyPassword('x', salt, '') === false);
ok('не-hex хэш → false', u.verifyPassword('x', salt, 'zzzz') === false);
ok('короткий хэш → false', u.verifyPassword('x', salt, 'abcd') === false);
ok('null-хэш → false', u.verifyPassword('x', salt, null) === false);

console.log('\n[3] Совместимость: verifyPassword согласован с hashPassword');
for (let i = 0; i < 5; i++) {
  const s = u.uid(16);
  const pw = 'Pass' + i + 'word' + i;
  const h = u.hashPassword(pw, s);
  ok(`итерация ${i}: verify(hash)=true`, u.verifyPassword(pw, s, h) === true);
  ok(`итерация ${i}: verify(другой pw)=false`, u.verifyPassword(pw + 'x', s, h) === false);
}

console.log(`\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
