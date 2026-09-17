// ═══════════════════════════════════════════════════════════════════
// src/services/realStats.ts — характеристики игрока в командных
// сражениях (новые групповые бои и арена)
//
// Решения владельца:
//   17.09.2026 — «всё как в игре»: запасы — из навыков игрока, крит и
//     уворот — от жестокости и ловкости.
//   17.09.2026 (уточнение) —
//     • в бой игрок входит с ТЕКУЩИМИ запасами: было 300/1600 HP,
//       500/1000 энергии и 50/120 боеприпасов — в бою так же;
//     • итог боя переносится обратно в игру (writeBack);
//     • боеприпасы в бою восстанавливаются, как в игре: трофей
//       «Боевая логистика», допинг и VIP ускоряют (regenAmmo);
//     • удар 20–35, крит — ×4–×7.
//
// Ботам характеристики считаются от средних у живых игроков боя.
// ═══════════════════════════════════════════════════════════════════

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import player = require('./player');
import type { User } from '../types';

const B = config.BATTLE;

// Удар и крит — числа владельца
const HIT_MIN = 20, HIT_MAX = 35;
const CRIT_MULT_MIN = 4, CRIT_MULT_MAX = 7;

type Stats = {
  hp: number; maxHp: number;
  energy: number; maxEnergy: number;
  ammo: number; maxAmmo: number;
  ammoRegenSec: number;          // секунд на один боеприпас
  critChance: number;
  dodgeChance: number;
  power: number;                 // множитель урона: 1 у живых, доля у ботов
};

// Снимок игрока на момент входа в бой — с текущими запасами
function snapshot(user: User): Stats {
  player.refresh(user);            // запасы — на эту секунду, с восстановлением
  const mx = player.maxima(user);
  const critBase = Math.min(B.CRIT_MAX_CHANCE, B.CRIT_BASE + (user.skills.cruelty || 0) * B.CRIT_PER_CRUELTY);
  const critChance = Math.max(0, critBase + player.effMul(user, 'crit_bonus') - 1);
  const dodge = Math.min(B.DODGE_MAX, (user.skills.agility || 0) * B.DODGE_PER_AGILITY)
    + player.effMul(user, 'dodge_bonus') - 1;
  const cur = (r: any, max: number) => u.clamp(Math.floor(Number(r && r.cur) || 0), 0, max);
  return {
    hp: cur(user.res.hp, mx.hp), maxHp: mx.hp,
    energy: cur(user.res.en, mx.en), maxEnergy: mx.en,
    ammo: cur(user.res.am, mx.am), maxAmmo: mx.am,
    ammoRegenSec: player.ammoRegenSeconds(user),
    critChance: Math.min(0.95, critChance),
    dodgeChance: u.clamp(dodge, 0, 0.75),
    power: 1,
  };
}

// Средние по списку. Пустой список — новичок без навыков с полными запасами.
function average(list: Stats[]): Stats {
  if (!list.length) {
    const P = config.PLAYER;
    return { hp: P.BASE_HP, maxHp: P.BASE_HP, energy: P.BASE_ENERGY, maxEnergy: P.BASE_ENERGY,
             ammo: P.BASE_AMMO, maxAmmo: P.BASE_AMMO, ammoRegenSec: config.REGEN.am,
             critChance: B.CRIT_BASE, dodgeChance: 0, power: 1 };
  }
  const avg = (k: keyof Stats) => list.reduce((s, x) => s + (Number(x[k]) || 0), 0) / list.length;
  return {
    hp: avg('hp'), maxHp: avg('maxHp'), energy: avg('energy'), maxEnergy: avg('maxEnergy'),
    ammo: avg('ammo'), maxAmmo: avg('maxAmmo'), ammoRegenSec: avg('ammoRegenSec'),
    critChance: avg('critChance'), dodgeChance: avg('dodgeChance'), power: 1,
  };
}

// Бот: «ХП и мощь» — доля k от средних у живых. Здоровье — от того, с
// чем живые вошли в бой, и бот начинает с полным запасом. Энергия и
// боеприпасы — средние: с урезанным запасом бот просто стоял бы.
function botStats(avg: Stats, k: number): Stats {
  const hp = Math.max(1, Math.round(avg.hp * k));
  const ammo = Math.max(1, Math.round(avg.ammo));
  const energy = Math.max(0, Math.round(avg.energy));
  return {
    hp, maxHp: hp,
    energy, maxEnergy: Math.max(energy, Math.round(avg.maxEnergy)),
    ammo, maxAmmo: Math.max(ammo, Math.round(avg.maxAmmo)),
    ammoRegenSec: Math.max(15, Math.round(avg.ammoRegenSec || config.REGEN.am)),
    critChance: avg.critChance * k,
    dodgeChance: avg.dodgeChance * k,
    power: k,
  };
}

// Один удар: 20–35, крит ×4–×7. Уворот — первым: увернувшийся не
// получает ничего. Множители роли и прикрытия применяет вызывающий.
function hit(att: Stats, tgt: Stats): { dmg: number; crit: boolean; dodged: boolean } {
  if (Math.random() < (tgt.dodgeChance || 0)) return { dmg: 0, crit: false, dodged: true };
  let dmg = u.rnd(HIT_MIN, HIT_MAX);
  const crit = Math.random() < (att.critChance || 0);
  if (crit) dmg = Math.round(dmg * (CRIT_MULT_MIN + Math.random() * (CRIT_MULT_MAX - CRIT_MULT_MIN)));
  dmg = Math.round(dmg * (att.power || 1));
  return { dmg: Math.max(1, dmg), crit, dodged: false };
}

// Восстановление боеприпасов бойца в бою — по правилу игры: целыми
// штуками за прошедшие интервалы, остаток времени не теряется.
// f — боец: ammo, maxAmmo, ammoAt (отметка), stats.ammoRegenSec.
function regenAmmo(f: any, now: number): void {
  const sec = (f.stats && f.stats.ammoRegenSec) || config.REGEN.am;
  if (!f.ammoAt) f.ammoAt = now;
  if (f.ammo >= f.maxAmmo) { f.ammoAt = now; return; }
  const step = sec * 1000;
  const ticks = Math.floor((now - f.ammoAt) / step);
  if (ticks <= 0) return;
  f.ammo = Math.min(f.maxAmmo, f.ammo + ticks);
  f.ammoAt += ticks * step;
  if (f.ammo >= f.maxAmmo) f.ammoAt = now;
}

// Сколько секунд до следующего боеприпаса (0 — запас полный)
function ammoEtaSec(f: any, now: number): number {
  if (f.ammo >= f.maxAmmo) return 0;
  const sec = (f.stats && f.stats.ammoRegenSec) || config.REGEN.am;
  return Math.max(0, Math.ceil((f.ammoAt + sec * 1000 - now) / 1000));
}

// Итог боя — в игру: запасы игрока становятся такими, какими закончился
// бой. Отметки восстановления ставим на «сейчас»: восстановление в игре
// пойдёт с этой секунды, а не задним числом за время боя.
function writeBack(userId: string, f: { hp?: number; energy?: number; ammo?: number }): void {
  const user: any = player.users()[userId];
  if (!user || !user.res) return;
  const mx = player.maxima(user);
  const now = Date.now();
  const put = (r: any, v: number | undefined, max: number) => {
    if (!r || typeof v !== 'number') return;
    r.cur = u.clamp(Math.round(v), 0, max);
    r.t = now;
  };
  put(user.res.hp, f.hp, mx.hp);
  put(user.res.en, f.energy, mx.en);
  put(user.res.am, f.ammo, mx.am);
  require('../core/db').markUser(user.id);
}

export = {
  snapshot, average, botStats, hit, regenAmmo, ammoEtaSec, writeBack,
  HIT_MIN, HIT_MAX, CRIT_MULT_MIN, CRIT_MULT_MAX,
};
