// Потери техники в бою. ПЕРЕПИСАН (v48): раньше потери считались как доля
// от армии (LOSS_*_PCT), и этот тест сверял новые проценты со старыми.
// Теперь потери — абсолютное число единиц, зависящее от урона:
//   обычный удар      → UNIT_LOSS_MIN..UNIT_LOSS_MAX           (1..10)
//   критический удар  → UNIT_LOSS_CRIT_MIN..UNIT_LOSS_CRIT_MAX (10..30)
// Урон 0 (полный уворот) не отнимает технику вообще.
const assert=require('assert');
process.env.MONGODB_URI='';
const path=require('path'),fs=require('fs');
require('./_guard');   // не даёт стереть боевую data/
const DATA=path.join(process.cwd(),'data'); if(fs.existsSync(DATA))fs.rmSync(DATA,{recursive:true,force:true});
const battle=require('../dist/src/services/battle'), c=require('../dist/config/gameConfig');
const B=c.BATTLE;
let passed=0;
const ok=(n,cond)=>{assert.ok(cond,'❌ '+n);passed++;console.log('  ✅ '+n);};
const eq=(n,a,b)=>{assert.strictEqual(a,b,`❌ ${n}: ${a} !== ${b}`);passed++;console.log('  ✅ '+n);};

console.log('\n[1] Формула: уворот не отнимает технику');
eq('урон 0 → потерь нет', battle.unitLossCount(0,false), 0);
eq('урон 0 при крите → потерь нет', battle.unitLossCount(0,true), 0);
eq('отрицательный урон → потерь нет', battle.unitLossCount(-5,false), 0);

console.log('\n[2] Обычный удар: диапазон 1..10 и рост по урону');
const normals=[];
for(let d=1; d<=40; d++) normals.push(battle.unitLossCount(d,false));
ok(`минимум ${Math.min(...normals)} >= ${B.UNIT_LOSS_MIN}`, Math.min(...normals) >= B.UNIT_LOSS_MIN);
ok(`максимум ${Math.max(...normals)} <= ${B.UNIT_LOSS_MAX}`, Math.max(...normals) <= B.UNIT_LOSS_MAX);
ok('слабый удар отнимает меньше, чем сильный',
   battle.unitLossCount(3,false) < battle.unitLossCount(28,false));
ok('монотонность: потери не убывают с ростом урона',
   normals.every((v,i)=> i===0 || v>=normals[i-1]));
eq('урон на потолке даёт максимум', battle.unitLossCount(B.UNIT_LOSS_DAMAGE_CAP,false), B.UNIT_LOSS_MAX);
eq('урон выше потолка не превышает максимум', battle.unitLossCount(999,false), B.UNIT_LOSS_MAX);

console.log('\n[3] Критический удар: диапазон 10..30');
const crits=[];
for(let d=1; d<=80; d++) crits.push(battle.unitLossCount(d,true));
ok(`минимум ${Math.min(...crits)} >= ${B.UNIT_LOSS_CRIT_MIN}`, Math.min(...crits) >= B.UNIT_LOSS_CRIT_MIN);
ok(`максимум ${Math.max(...crits)} <= ${B.UNIT_LOSS_CRIT_MAX}`, Math.max(...crits) <= B.UNIT_LOSS_CRIT_MAX);
ok('крит всегда отнимает больше обычного удара той же силы',
   [5,12,20,28].every(d => battle.unitLossCount(d,true) > battle.unitLossCount(d,false)));
ok('внутри крита потери тоже растут с уроном',
   battle.unitLossCount(12,true) < battle.unitLossCount(60,true));
eq('очень сильный крит упирается в потолок', battle.unitLossCount(999,true), B.UNIT_LOSS_CRIT_MAX);

console.log('\n[4] Оборонительные постройки снижают потери');
const noReduce=battle.unitLossCount(28,false,0);
const withReduce=battle.unitLossCount(28,false,0.5);
ok(`с редукцией 50%: ${withReduce} < ${noReduce}`, withReduce < noReduce);
ok('но не ниже одной единицы', battle.unitLossCount(28,false,0.99) >= 1);

console.log('\n[5] Потолок доли армии защищает малые армии');
ok(`доля вместимости: ${B.UNIT_LOSS_ARMY_PCT*100}%`, B.UNIT_LOSS_ARMY_PCT > 0 && B.UNIT_LOSS_ARMY_PCT <= 1);
const mkVictim=(count)=>({ units:{ ground_1:[count,0,0] } });
const mkEntries=(count)=>[{ unitId:'ground_1', name:'Джип', mk:0, taken:count }];
const lostFrom=(count,want)=>{
  const v=mkVictim(count);
  const res=battle.removeUnits(v, mkEntries(count), want);
  return res.reduce((s,l)=>s+l.count,0);
};
const smallLost=lostFrom(10, 30);
ok(`армия из 10: запрошено 30 → потеряно ${smallLost} (не вся армия)`, smallLost <= 2 && smallLost >= 1);
const bigLost=lostFrom(1000, 30);
eq('армия из 1000: запрошено 30 → потеряно 30', bigLost, 30);
eq('запрошено 0 (уворот) → потерь нет', lostFrom(1000, 0), 0);

console.log('\n[6] Сравнение со старой формулой (доля от армии)');
const oldOn10k=Math.floor(10000*0.004*1.6);
console.log(`  (старая формула на армии 10 000: до ${oldOn10k} единиц за бой)`);
ok(`новый потолок ${B.UNIT_LOSS_CRIT_MAX} ниже старого ${oldOn10k}`, B.UNIT_LOSS_CRIT_MAX < oldOn10k);

console.log(`\nВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${passed} проверок\n`);
process.exit(0);
