// ===================================================================
// src/services/landmines.ts — мины как средство защиты при атаке
//
// Механика (согласовано с владельцем проекта):
//   1. Мины покупаются на чёрном рынке (10 золота за штуку, до 5 за
//      покупку, максимум 10 в запасе). Хранятся у игрока как у ЖЕРТВЫ.
//   2. Срабатывают АВТОМАТИЧЕСКИ, когда кто-то атакует владельца мин —
//      шанс зависит от трофея «Растяжка» жертвы (2%..20% за ур.1..10)
//      и требует хотя бы 1 мины в запасе (мина расходуется при срабатывании
//      независимо от исхода разминирования).
//   3. Нападающему показывается мини-игра «обезвредь провод»: 6 проводов,
//      3 цвета в раскладе 3-2-1 — нужно перерезать ЕДИНСТВЕННЫЙ провод
//      цвета, которого больше ни у кого нет. Единственная попытка — не
//      тот провод = взрыв.
//   4. Взрыв: 100% здоровья нападающего + % его техники в бою (по
//      трофею жертвы, 3%..30% за ур.1..10) — уничтожается НАПРЯМУЮ,
//      без рандомизации (обещанный игроку процент должен быть точным).
// ===================================================================

import config = require('../../config/gameConfig');
import u = require('../core/utils');

const WIRE_COLORS: Record<string, string> = {
  red: 'красный', blue: 'синий', yellow: 'жёлтый', green: 'зелёный',
  white: 'белый', black: 'чёрный', orange: 'оранжевый', purple: 'фиолетовый',
};
const WIRE_HEX: Record<string, string> = {
  red: '#e83f3f', blue: '#3f7fe8', yellow: '#e8d13f', green: '#3fe86a',
  white: '#f0f0f0', black: '#2a2a2a', orange: '#e8843f', purple: '#a03fe8',
};

// Максимум мин в запасе — используется и при покупке (market.ts), и при отображении
function maxStock(): number { return config.MINES.maxStock; }

// ---------- Генерация раскладки проводов (3 цвета, 3-2-1) ----------
function generateWires(): { wires: string[]; correctIdx: number } {
  const palette = Object.keys(WIRE_COLORS);
  // Выбираем 3 разных случайных цвета из палитры
  const pool = palette.slice();
  const picked: string[] = [];
  for (let i = 0; i < 3; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  // Раскладка 3-2-1: picked[0] ×3, picked[1] ×2, picked[2] ×1 (единственный — верный)
  const counts = [3, 2, 1];
  let list: string[] = [];
  picked.forEach((color, i) => { for (let n = 0; n < counts[i]; n++) list.push(color); });
  // Перемешиваем позиции (Fisher-Yates)
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const correctColor = picked[2]; // единственный (счётчик 1)
  const correctIdx = list.indexOf(correctColor);
  return { wires: list, correctIdx };
}

// Для клиента — цвета в виде {id, name, hex}, БЕЗ указания, какой верный
function wiresView(wires: string[]): { id: string; name: string; hex: string }[] {
  return wires.map((c) => ({ id: c, name: WIRE_COLORS[c] || c, hex: WIRE_HEX[c] || '#888' }));
}

// ---------- Проверка срабатывания мины у жертвы ----------
// level — уровень трофея «Растяжка» у ЖЕРТВЫ (target). Возвращает true,
// если мина сработала (и уже списана из запаса жертвы вызывающим кодом).
function rollTrigger(level: number): boolean {
  const chance = config.MINES.triggerChancePct[Math.max(0, Math.min(10, level || 0))];
  if (chance <= 0) return false;
  return Math.random() * 100 < chance;
}

// % техники к уничтожению при взрыве (по трофею жертвы)
function techLossPct(level: number): number {
  return config.MINES.techLossPct[Math.max(0, Math.min(10, level || 0))];
}

// ---------- Точное (не случайное) уничтожение % техники атакующего ----------
// В отличие от battle.removeUnits (случайный разброс вокруг базовой доли),
// здесь процент ТОЧНО тот, что обещан по уровню трофея — это финальный,
// катастрофический удар, а не обычная боевая потеря.
function destroyExactPct(victim: any, armyEntries: any[], pct: number): any[] {
  const pool = armyEntries
    .filter((e) => !e.secret && e.unitId && e.taken > 0)
    .slice()
    .sort((a, b) => {
      if (a.mk !== b.mk) return a.mk - b.mk;
      const cuA = config.UNIT_BY_ID[a.unitId];
      const cuB = config.UNIT_BY_ID[b.unitId];
      return (cuA ? cuA.unlock : 0) - (cuB ? cuB.unlock : 0);
    });
  const totalTaken = pool.reduce((s, e) => s + e.taken, 0);
  if (totalTaken <= 0 || pct <= 0) return [];
  let toLose = Math.ceil(totalTaken * pct / 100);

  const lost: Record<string, number> = {};
  const lostMeta: Record<string, { id: string; type: string }> = {};
  for (const e of pool) {
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
    if ((m[0] || 0) + (m[1] || 0) + (m[2] || 0) <= 0) delete victim.units[e.unitId];
  }
  return Object.entries(lost).map(([name, count]) => ({
    name, count, id: lostMeta[name].id, unitType: lostMeta[name].type,
  }));
}

export = { maxStock, generateWires, wiresView, rollTrigger, techLossPct, destroyExactPct, WIRE_COLORS };
