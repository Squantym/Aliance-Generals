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
// 19.09.2026: 1–9 уровни по 15%, 10-й — рывок до +200% (крит ×6, потолок владельца)
ok(trophy.perLvl === 15, `за уровень: +${trophy.perLvl}%`);
ok(config.trophyValue(trophy, 9) === 135, `на 9-м уровне +${config.trophyValue(trophy, 9)}%`);
ok(config.TROPHY_MAX_LEVEL === 10, `максимальный уровень: ${config.TROPHY_MAX_LEVEL}`);
const bonus = config.trophyValue(trophy, config.TROPHY_MAX_LEVEL) / 100;
ok(bonus === 2, `на максимуме прибавка +${bonus * 100}%`);
const mult = config.BATTLE.CRIT_MULT * (1 + bonus);
ok(mult === 6, `множитель крита: ×${mult} (база ×${config.BATTLE.CRIT_MULT})`);

console.log('\n── 2. Ступени базового урона ──');
// Урон считается от доли атаки в защите (18.09.2026, решение владельца):
// <40% → 1–5, 40–70% → 5–10, 70–85% → 10–15, ≥85% → 30–36 и выше не растёт
ok(/dealt = u\.rnd\(30, 36\);/.test(battleSrc), 'верхняя ступень: 30–36');
ok(/u\.clamp\(Math\.round\(dealt\), 1, B\.MAX_HIT\)/.test(battleSrc), 'ограничитель — общий потолок MAX_HIT');
const topRoll = Number((/dealt = u\.rnd\(30, (\d+)\);/.exec(battleSrc) || [])[1]);
const clampMax = config.BATTLE.MAX_HIT;
ok(topRoll === clampMax,
   `верх броска (${topRoll}) совпадает с ограничителем (${clampMax}) — иначе потолок недостижим`);

console.log('\n── 3. Максимальный крит достижим ──');
// Бросок берём из самой игры, а не повторяем таблицу в тесте: копия
// таблицы уже расходилась с кодом и тест стерёг вчерашние числа
const battle = require(ROOT + '/dist/src/services/battle');
const roll = (share) => battle.resolveDamage(Math.round(share * 1e6), 1e6).dealt;
let maxBase = 0, maxCrit = 0, hitsTop = 0;
const N = 100000;
for (let i = 0; i < N; i++) {
  const base = roll(1);          // равные силы — верхняя ступень
  const crit = Math.round(base * mult);
  if (base > maxBase) maxBase = base;
  if (crit > maxCrit) maxCrit = crit;
  if (crit === clampMax * mult) hitsTop++;
}
ok(maxBase === clampMax, `базовый урон доходит до ${maxBase}`);
ok(maxCrit === clampMax * mult, `крит доходит до ${maxCrit} — то, что обещает описание трофея`);
ok(hitsTop > N * 0.05, `удары на ${clampMax * mult} не редкость: ${(hitsTop / N * 100).toFixed(1)}% в этой ступени`);
ok(maxCrit === clampMax * mult, 'потолок крита равен ограничителю, умноженному на множитель');

console.log('\n── 4. Остальные ступени ──');
for (const [re, label] of [
  [/dealt = u\.rnd\(1, 5\);/, 'атака ниже 40% защиты: 1–5'],
  [/dealt = u\.rnd\(5, 10\);/, '40–70%: 5–10'],
  [/dealt = u\.rnd\(10, 15\);/, '70–85%: 10–15'],
]) {
  ok(re.test(battleSrc), `ступень «${label}» на месте`);
}
ok(/ВЫШЕ НЕ РАСТЁТ/.test(battleSrc), 'в коде сказано, что выше 85% урон не растёт');

console.log('\n── 5. Крит применяется в бою ──');
ok(/const critTrophyBonus = trophies\.critPower\(user\)/.test(battleSrc), 'бонус трофея берётся из сервиса');
ok(/dealtBase \* B\.CRIT_MULT \* \(1 \+ critTrophyBonus\)/.test(battleSrc),
   'множитель применяется к базовому урону');
const trophiesSrc = fs.readFileSync(path.join(ROOT, 'src/services/trophies.ts'), 'utf8');
// activeLevel, а не levelOf: трофей, отданный в прокачку, снят со стойки
// и бонуса не даёт, пока улучшение не закончилось (services/trophies.ts)
ok(/config\.trophyValue\(def, activeLevel\(user, 'license'\)\) \/ 100/.test(trophiesSrc),
   'сила крита считается по рабочему уровню трофея');

console.log(`\n═══ Итог: ${passed} прошло, ${failed} упало ═══`);
process.exit(failed ? 1 : 0);
