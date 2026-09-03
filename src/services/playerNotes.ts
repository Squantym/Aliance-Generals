// ═══════════════════════════════════════════════════════════════════
// src/services/playerNotes.ts — служебные заметки о игроке
//
// Зачем. Всё, что панель знает о человеке, — это его действия: что он
// нажимал, сколько получил, за что наказан. Нигде нельзя записать то,
// что знает только разбиравший сотрудник: «жаловался дважды, оба раза не
// подтвердилось», «обещал вернуть выданное по ошибке», «пишет из двух
// стран, объяснил командировкой».
//
// Без этого каждый следующий разбор начинается с нуля — в том числе у
// того же самого сотрудника через месяц. Он перечитывает журнал заново и
// приходит к тем же выводам, потратив то же время.
//
// Решения, которые здесь приняты намеренно:
//
//  1. ЗАМЕТКА НЕ УДАЛЯЕТСЯ ЧУЖИМИ. Убрать может автор или владелец.
//     Иначе запись «этот сотрудник выдал себе ресурсы» жила бы ровно до
//     того, как он её увидит.
//
//  2. АВТОР И ВРЕМЯ ПИШУТСЯ ВСЕГДА. Заметка без подписи бесполезна:
//     непонятно, чьё это мнение и насколько оно свежее.
//
//  3. ЭТО НЕ ПЕРЕПИСКА С ИГРОКОМ. Заметки видны только сотрудникам, и
//     игроку они не отдаются ни в одной ручке. Для разговора с человеком
//     есть обращения в поддержку.
//
//  4. ХРАНИМ ПОСЛЕДНИЕ 50 НА ИГРОКА. Не «всё вообще»: заметки нужны как
//     живой контекст, а не как второй журнал — журнал уже есть и в нём
//     полная история.
// ═══════════════════════════════════════════════════════════════════
import db = require('../core/db');
import u = require('../core/utils');

type Note = {
  id: string;
  at: number;
  by: string;          // id сотрудника
  byName: string;      // имя на момент записи — сотрудник мог смениться
  text: string;
};

const KEEP_PER_PLAYER = 50;
const MAX_LEN = 1000;

function store(): Record<string, Note[]> {
  return db.load<Record<string, Note[]>>('playerNotes', {});
}

function list(userId: string): Note[] {
  const s = store();
  const arr = s[String(userId)] || [];
  // Новые сверху: разбор начинают с последнего, а не с первого.
  return arr.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
}

function add(actor: any, userId: string, text: string): Note {
  const id = String(userId || '');
  if (!id) throw new u.ApiError('Не указан игрок');
  const clean = String(text || '')
    // Переносы строк оставляем: заметка на три строки читается лучше
    // одной длинной. Всё прочее управляющее — вон.
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_LEN);
  if (!clean) throw new u.ApiError('Заметка пустая');

  const s = store();
  const arr = s[id] || (s[id] = []);
  const note: Note = {
    id: 'n' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36),
    at: Date.now(),
    by: String((actor && actor.id) || ''),
    byName: String((actor && actor.name) || '—').slice(0, 40),
    text: clean,
  };
  arr.push(note);
  if (arr.length > KEEP_PER_PLAYER) arr.splice(0, arr.length - KEEP_PER_PLAYER);
  db.save('playerNotes');
  return note;
}

// Убрать может автор или владелец. Чужую заметку о себе стереть нельзя —
// в этом весь смысл: иначе запись «выдал себе ресурсы» жила бы до первого
// прочтения тем, о ком она.
function remove(actor: any, userId: string, noteId: string, isOwner: boolean): void {
  const s = store();
  const arr = s[String(userId)] || [];
  const i = arr.findIndex((n) => n && n.id === String(noteId));
  if (i === -1) throw new u.ApiError('Заметка не найдена');
  const mine = arr[i].by === String((actor && actor.id) || '');
  if (!mine && !isOwner) throw new u.ApiError('Убрать чужую заметку может только владелец');
  arr.splice(i, 1);
  db.save('playerNotes');
}

// Сколько заметок у игрока — для списка игроков и карточки, чтобы было
// видно «про этого уже что-то знают», не открывая.
function count(userId: string): number {
  return (store()[String(userId)] || []).length;
}

export = { list, add, remove, count };
