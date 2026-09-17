// ═══════════════════════════════════════════════════════════════════
// src/services/realStats.ts — реальные характеристики игрока для
// командных сражений (новые групповые бои и арена)
//
// Решение владельца (17.09.2026): «всё как в игре». Здоровье, энергия и
// боеприпасы — максимумы игрока по его навыкам; удар — та же пороговая
// формула, что в войне (атака армии против защиты цели, 3–30), крит и
// уворот — от жестокости и ловкости, с допингом и трофеем силы крита.
//
// Берутся МАКСИМУМЫ, а не текущие запасы, и в бою живёт копия: иначе
// командное сражение обнуляло бы игроку здоровье и боеприпасы в войне,
// а вышедший с пустым запасом был бы для команды балластом.
//
// Ботам характеристики считаются от средних у живых игроков боя.
// ═══════════════════════════════════════════════════════════════════

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import player = require('./player');
import type { User } from '../types';

const B = config.BATTLE;

type Stats = {
  hp: number; energy: number; ammo: number;
  atk: number; def: number;              // мощь армии в атаке и в защите
  critChance: number; critMult: number;
  dodgeChance: number;
};

// Снимок игрока на момент старта боя
function snapshot(user: User): Stats {
  const mx = player.maxima(user);
  const atk = Math.max(10, Math.round(player.totalPower(user, 'atk').power || 0));
  const def = Math.max(10, Math.round(player.totalPower(user, 'def').power || 0));
  const critBase = Math.min(B.CRIT_MAX_CHANCE, B.CRIT_BASE + (user.skills.cruelty || 0) * B.CRIT_PER_CRUELTY);
  const critChance = Math.max(0, critBase + player.effMul(user, 'crit_bonus') - 1);
  let critPower = 0;
  try { critPower = require('./trophies').critPower(user) || 0; } catch (e) { critPower = 0; }
  const dodge = Math.min(B.DODGE_MAX, (user.skills.agility || 0) * B.DODGE_PER_AGILITY)
    + player.effMul(user, 'dodge_bonus') - 1;
  return {
    hp: mx.hp, energy: mx.en, ammo: mx.am,
    atk, def,
    critChance: Math.min(0.95, critChance),
    critMult: B.CRIT_MULT * (1 + critPower),
    dodgeChance: u.clamp(dodge, 0, 0.75),
  };
}

// Средние характеристики по списку. Пустой список — базовый игрок без
// навыков: так бот не рождается с нулями, если считать не по кому.
function average(list: Stats[]): Stats {
  if (!list.length) {
    return { hp: config.PLAYER.BASE_HP, energy: config.PLAYER.BASE_ENERGY, ammo: config.PLAYER.BASE_AMMO,
             atk: 10, def: 10, critChance: B.CRIT_BASE, critMult: B.CRIT_MULT, dodgeChance: 0 };
  }
  const avg = (k: keyof Stats) => list.reduce((s, x) => s + (Number(x[k]) || 0), 0) / list.length;
  return {
    hp: avg('hp'), energy: avg('energy'), ammo: avg('ammo'),
    atk: avg('atk'), def: avg('def'),
    critChance: avg('critChance'), critMult: avg('critMult'), dodgeChance: avg('dodgeChance'),
  };
}

// Бот: «ХП и мощь» — доля k от средних; энергия и боеприпасы — средние,
// иначе бот с урезанным запасом просто стоял бы без патронов.
// Шансы крита и уворота тоже срезаются на k: это часть силы бойца.
function botStats(avg: Stats, k: number): Stats {
  return {
    hp: Math.max(1, Math.round(avg.hp * k)),
    energy: Math.max(0, Math.round(avg.energy)),
    ammo: Math.max(1, Math.round(avg.ammo)),
    atk: Math.max(10, Math.round(avg.atk * k)),
    def: Math.max(10, Math.round(avg.def * k)),
    critChance: avg.critChance * k,
    critMult: avg.critMult,
    dodgeChance: avg.dodgeChance * k,
  };
}

// Один удар по формуле войны. Уворот — первым: увернувшийся не получает
// ничего. mul — множители поверх (роль, прикрытие и т. п.) применяет
// вызывающий: здесь только то, что «как в игре».
function hit(att: Stats, tgt: Stats): { dmg: number; crit: boolean; dodged: boolean } {
  if (Math.random() < (tgt.dodgeChance || 0)) return { dmg: 0, crit: false, dodged: true };
  const { dealt } = require('./battle').resolveDamage(att.atk, tgt.def);
  const crit = Math.random() < (att.critChance || 0);
  const dmg = crit ? Math.round(dealt * (att.critMult || B.CRIT_MULT)) : dealt;
  return { dmg: Math.max(1, dmg), crit, dodged: false };
}

export = { snapshot, average, botStats, hit };
