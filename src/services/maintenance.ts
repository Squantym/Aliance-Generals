// ===================================================================
// src/services/maintenance.ts — режим обслуживания
//
// Зачем. Обновление игры — это несколько минут, в которые данные
// меняются на ходу: идут бои, тратятся ресурсы, начисляются награды.
// Обновлять «как есть» значит либо потерять чьи-то действия, либо
// получить полурассчитанный бой в базе. Правильный порядок — сначала
// закрыть вход всем, кроме сотрудников, дать доиграть текущим запросам,
// и только потом обновляться.
//
// Что здесь важно и неочевидно:
//
//  1. СОСТОЯНИЕ ЛЕЖИТ В БАЗЕ, а не в памяти процесса. Иначе перезапуск
//     сервера — то есть ровно то, ради чего режим включают, — снимал бы
//     его сам. Игроки влетели бы в наполовину обновлённую игру.
//
//  2. СОТРУДНИКОВ ПУСКАЕМ ВСЕГДА. Режим, запирающий и владельца, снять
//     будет нечем: панель — тоже часть игры.
//
//  3. ЭТО НЕ ЗАКРЫВАЕТ ОКНО САМОГО ПЕРЕЗАПУСКА. Пока процесс
//     перезагружается, отвечать некому: игрок увидит ошибку сервера, а
//     не наше окно. Чтобы закрыть и эти секунды, нужен запасной ответ
//     nginx — он описан в ОБНОВЛЕНИЯ-И-ТЕСТ.md. Здесь мы честно
//     закрываем всё остальное время.
//
//  4. СРОК ОКОНЧАНИЯ — ОРИЕНТИР, А НЕ ТАЙМЕР. Режим не снимается сам по
//     истечении времени: если обновление затянулось, автоматическое
//     открытие впустило бы людей в сломанную игру. Время показывается
//     игроку, снимает режим человек.
// ===================================================================
import db = require('../core/db');
import u = require('../core/utils');

type State = {
  on: boolean;
  reason: string;      // что показать игроку
  until: number;       // ориентировочное окончание, 0 — не назвали
  by: string;          // кто включил
  at: number;          // когда включили
  offAt: number;       // когда сняли (для журнала)
};

const DEFAULT_REASON = 'Идёт обновление игры. Скоро вернёмся.';

function state(): State {
  const s = db.load<State>('maintenance', {} as State);
  if (typeof s.on !== 'boolean') s.on = false;
  return s;
}

function isOn(): boolean { return !!state().on; }

// Что показать игроку. Ничего лишнего: причина, срок и время включения.
// Кто именно включил — сведение служебное, наружу не отдаём.
function view() {
  const s = state();
  return {
    on: !!s.on,
    reason: String(s.reason || DEFAULT_REASON),
    until: Number(s.until) || 0,
    at: Number(s.at) || 0,
  };
}

// Полная картина — для панели.
function adminView() {
  const s = state();
  return { ...view(), by: String(s.by || ''), offAt: Number(s.offAt) || 0 };
}

function turnOn(byName: string, reason?: string, minutes?: number) {
  const s = state();
  s.on = true;
  s.reason = String(reason || '').trim().slice(0, 300) || DEFAULT_REASON;
  const m = Math.max(0, Math.min(1440, Math.round(Number(minutes) || 0)));
  s.until = m ? Date.now() + m * 60000 : 0;
  s.by = String(byName || '').slice(0, 60);
  s.at = Date.now();
  s.offAt = 0;
  db.save('maintenance');
  console.log(`🛠  Режим обслуживания ВКЛЮЧЁН (${s.by}): ${s.reason}`);
  return view();
}

function turnOff(byName: string) {
  const s = state();
  if (!s.on) throw new u.ApiError('Режим обслуживания и так выключен');
  s.on = false;
  s.offAt = Date.now();
  db.save('maintenance');
  console.log(`✅ Режим обслуживания снят (${String(byName || '')})`);
  return view();
}

export = { isOn, view, adminView, turnOn, turnOff, DEFAULT_REASON };
