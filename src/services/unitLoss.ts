// ═══════════════════════════════════════════════════════════════════
// src/services/unitLoss.ts — как техника уходит из армии
//
// Механика потерь была записана ДВАЖДЫ, слово в слово: в обычном бою
// (battle.removeUnits) и на минах (landmines.destroyExactPct). Двадцать
// строк, различавшиеся ровно одной — той, что решает, СКОЛЬКО единиц
// потерять.
//
// Это самый дорогой класс ошибок в проекте: правишь одну копию, вторая
// молча живёт по-старому. Так уже расходились цена ускорения, история
// боёв и флаг победы. Здесь копии пока совпадали, но любая правка
// порядка списания — скажем, «Mk2 теряется первым» — развела бы их
// навсегда и незаметно: бой и мины начали бы считать по-разному.
//
// Поэтому здесь ОБЩАЯ механика, а решение «сколько» осталось у каждого
// своё и осознанно разное:
//   • бой — доля от взятой в бой техники, чтобы один крит не выкосил
//     маленькую армию новичка целиком;
//   • мины — ровно обещанный процент трофея, без смягчения: это
//     финальный удар, а не обычная боевая потеря.
// ═══════════════════════════════════════════════════════════════════
import config = require('../../config/gameConfig');

// Кого списывать первым. От слабой к сильной: сначала Mk0, потом Mk1,
// Mk2; внутри одного Mk — по возрастанию уровня открытия. Секретную
// технику не трогаем вовсе.
function pool(armyEntries: any[]): any[] {
  return armyEntries
    .filter((e) => !e.secret && e.unitId && e.taken > 0)
    .slice()
    .sort((a, b) => {
      if (a.mk !== b.mk) return a.mk - b.mk;
      const cuA = config.UNIT_BY_ID[a.unitId];
      const cuB = config.UNIT_BY_ID[b.unitId];
      return (cuA ? cuA.unlock : 0) - (cuB ? cuB.unlock : 0);
    });
}

function totalTaken(p: any[]): number {
  return p.reduce((s, e) => s + e.taken, 0);
}

// Списать toLose единиц по порядку из pool. Меняет и армию жертвы, и
// сам pool (e.taken): вызывающий код на это опирается.
function take(victim: any, p: any[], toLose: number): any[] {
  const lost: Record<string, number> = {};
  const lostMeta: Record<string, { id: string; type: string }> = {};
  for (const e of p) {
    if (toLose <= 0) break;
    const m = victim.units[e.unitId];
    const have = m ? (m[e.mk] || 0) : 0;
    if (have <= 0 || e.taken <= 0) continue;
    const n = Math.min(have, e.taken, toLose);
    m[e.mk] = have - n;
    e.taken -= n;
    toLose -= n;
    lost[e.name] = (lost[e.name] || 0) + n;
    lostMeta[e.name] = { id: e.unitId, type: (config.UNIT_BY_ID[e.unitId] || {}).type };
    // Пустую строку убираем целиком: иначе в армии копятся нули, и
    // «у меня есть танки» перестаёт значить, что они есть.
    if ((m[0] || 0) + (m[1] || 0) + (m[2] || 0) <= 0) delete victim.units[e.unitId];
  }
  // Отдаём с id — фронт по нему подставляет картинку.
  return Object.entries(lost).map(([name, count]) => ({
    name, count, id: lostMeta[name].id, unitType: lostMeta[name].type,
  }));
}

export = { pool, totalTaken, take };
