// ═══════════════════════════════════════════════════════════════════
// Крит и трофей «Лицензия на убийство». Верхняя ступень базового урона
// должна доходить до ограничителя: иначе обещанный потолок недостижим.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n); } };

const config = require(ROOT + '/dist/config/gameConfig');
const u = require(ROOT + '/dist/src/core/utils');
const battleSrc = fs.readFileSync(path.join(ROOT, 'src/services/battle.ts'), 'utf8');

console.log('\n── 1. Трофей ──');
const trophy = config.TROPHIES.find((t) => t.id === 'license');
ok(!!trophy, 'трофей «Лицензия на убийство» есть');
ok(trophy.perLvl === 20, `за уровень: +${trophy.perLvl}%`);
ok(config.TROPHY_MAX_LEVEL === 10, `максимальный уровень: ${config.TROPHY_MAX_LEVEL}`);
const bonus = (config.TROPHY_MAX_LEVEL * trophy.perLvl) / 100;
ok(bonus === 2, `на максимуме прибавка +${bonus * 100}%`);
const mult = config.BATTLE.CRIT_MULT * (1 + bonus);
ok(mult === 6, `множитель крита: ×${mult} (база ×${config.BATTLE.CRIT_MULT})`);

console.log('\n── 2. Ступени базового урона ──');
// Достаём таблицу прямо из кода, чтобы тест не разошёлся с реализацией
const nums = (re) => (re.exec(battleSrc) || [])[1];
ok(/dealt = u\.rnd\(24, 30\);/.test(battleSrc), 'верхняя ступень: 24–30');
ok(/u\.clamp\(Math\.round\(dealt\), 1, 30\)/.test(battleSrc), 'ограничитель: 1–30');
// Главная проверка: верх ступени и ограничитель совпадают
const topRoll = Number((/dealt = u\.rnd\(24, (\d+)\);/.exec(battleSrc) || [])[1]);
const clampMax = Number((/u\.clamp\(Math\.round\(dealt\), 1, (\d+)\)/.exec(battleSrc) || [])[1]);
ok(topRoll === clampMax,
   `верх броска (${topRoll}) совпадает с ограничителем (${clampMax}) — иначе потолок недостижим`);

console.log('\n── 3. Максимальный крит достижим ──');
const roll = (ratio) => {
  if (ratio >= 1.5) return u.rnd(3, 5);
  if (ratio >= 1.2) return u.rnd(6, 9);
  if (ratio >= 0.9 && ratio <= 1.1) return u.rnd(12, 16);
  if (ratio >= 0.6) return u.rnd(18, 22);
  return u.rnd(24, 30);
};
let maxBase = 0, maxCrit = 0, hitsTop = 0;
const N = 100000;
for (let i = 0; i < N; i++) {
  const base = u.clamp(Math.round(roll(0.3)), 1, clampMax);
  const crit = Math.round(base * mult);
  if (base > maxBase) maxBase = base;
  if (crit > maxCrit) maxCrit = crit;
  if (crit === 180) hitsTop++;
}
ok(maxBase === 30, `базовый урон доходит до ${maxBase}`);
ok(maxCrit === 180, `крит доходит до ${maxCrit} — то, что обещает описание трофея`);
ok(hitsTop > N * 0.05, `удары на 180 не редкость: ${(hitsTop / N * 100).toFixed(1)}% в этой ступени`);
ok(maxCrit === clampMax * mult, 'потолок крита равен ограничителю, умноженному на множитель');

console.log('\n── 4. Остальные ступени не тронуты ──');
for (const [re, label] of [
  [/dealt = u\.rnd\(3, 5\);/, 'слабейший: 3–5'],
  [/dealt = u\.rnd\(6, 9\);/, 'слабее: 6–9'],
  [/dealt = u\.rnd\(12, 16\);/, 'равные: 12–16'],
  [/dealt = u\.rnd\(18, 22\);/, 'сильнее: 18–22'],
]) {
  ok(re.test(battleSrc), `ступень «${label}» осталась прежней`);
}
ok(/Верхняя граница 30 совпадает с ограничителем/.test(battleSrc),
   'в коде объяснено, почему граница именно такая');

console.log('\n── 5. Крит применяется в бою ──');
ok(/const critTrophyBonus = trophies\.critPower\(user\)/.test(battleSrc), 'бонус трофея берётся из сервиса');
ok(/dealtBase \* B\.CRIT_MULT \* \(1 \+ critTrophyBonus\)/.test(battleSrc),
   'множитель применяется к базовому урону');
const trophiesSrc = fs.readFileSync(path.join(ROOT, 'src/services/trophies.ts'), 'utf8');
ok(/levelOf\(user, 'license'\) \* \(def \? def\.perLvl : 0\)\) \/ 100/.test(trophiesSrc),
   'сила крита считается по уровню трофея');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
