// ===================================================================
// src/services/social.ts — общий чат, почта (личные сообщения), зал славы
// ===================================================================

import config = require('../../config/gameConfig');
import db = require('../core/db');
import u = require('../core/utils');
import player = require('./player');
import type { User, Notices } from '../types';

function world(): any {
  const w = db.load('world', { chat: [], auctions: [], seq: 1 });
  if (!w.chat) w.chat = [];
  if (!w.auctions) w.auctions = [];
  if (!w.seq) w.seq = 1;
  return w;
}

function mailboxOf(userId: string): any[] {
  const boxes = db.load('mail', {});
  if (!boxes[userId]) boxes[userId] = [];
  return boxes[userId];
}

// ---------- ЧАТ ----------
// Каждому сообщению добавляем признак ally: автор состоит в личном альянсе
// со смотрящим ВЗАИМНО (как в списке целей). По нему фронт рисует звёздочку,
// чтобы сразу видеть, свой в эфире или нет.
// Удаление сообщений игрока из ОБЩЕГО чата. Чат легиона и личную
// переписку не трогаем — это закрытые каналы, разбирательство там не
// касается остальных игроков.
// Удаление «мягкое»: сообщение помечается, а не стирается, иначе
// администрация не смогла бы потом проверить, за что человек наказан.
function purgeChatMessages(userId: string, byName: string): number {
  const w = world();
  let n = 0;
  const now = Date.now();
  for (const m of w.chat as any[]) {
    if (m.uid !== userId || m.del) continue;
    m.del = true;
    m.delAt = now;
    m.delBy = byName || '';
    n++;
  }
  if (n) db.save('world');
  return n;
}

// Текст-заглушка на месте удалённого сообщения. Оставляем сам факт
// сообщения в ленте: так видно, что модерация работает, и разговор не
// теряет связность — иначе ответы на удалённую реплику повисают в воздухе.
const DELETED_TEXT = 'Сообщение удалено';

// Какая комната запрошена. Общий эфир и «Позывные» читают все, чат
// альянса — только взаимные союзники автора.
function roomOf(room?: string): string {
  return room === 'recruit' ? 'recruit' : room === 'alliance' ? 'alliance' : 'global';
}

// Обращаются ли в сообщении к этому игроку. Кнопка «Ответить» ставит
// «Позывной, …» в начало, но обратиться могут и посреди фразы, и через
// @. Ищем позывной отдельным словом, не внутри другого: «Барс» не
// должен подсвечиваться у «Барсук».
function mentionsName(text: string, name: string): boolean {
  const n = String(name || '').trim();
  if (n.length < 2) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Границу слова задаём сами: \b в JS не работает с кириллицей
  return new RegExp(`(^|[^0-9A-Za-zА-Яа-яЁё_])@?${esc}($|[^0-9A-Za-zА-Яа-яЁё_])`, 'i').test(String(text || ''));
}

// Лента страницами: страница 1 — самая свежая, дальше вглубь истории.
// Возвращаем и сами сообщения, и сколько всего страниц, — иначе
// листалку внизу нечем рисовать.
function pageOf(all: any[], page?: number | string) {
  const size = config.CHAT.PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(all.length / size));
  const p = Math.min(Math.max(1, u.toInt(page, 1) || 1), pages);
  const end = all.length - (p - 1) * size;
  return { slice: all.slice(Math.max(0, end - size), Math.max(0, end)), page: p, pages, size };
}

function chatGet(viewer: User | null, afterId?: number | string, room?: string, page?: number | string) {
  const after = u.toInt(afterId, 0);
  // Старые сообщения без комнаты считаются общим чатом
  const wantRoom = roomOf(room);
  let all = world().chat.filter((m) => m.id > after && ((m as any).room || 'global') === wantRoom);
  // Чат альянса у каждого свой: альянсы в игре личные, общего «клана»
  // нет. Игрок видит написанное теми, с кем он в ВЗАИМНОМ альянсе, и
  // своё. Поэтому лента собирается под конкретного читателя.
  if (wantRoom === 'alliance') {
    if (!viewer) return { messages: [] };
    const paSrv = require('./personalAlliance');
    const people: Record<string, User> = require('./player').users();
    all = all.filter((m: any) => {
      if (m.uid === viewer.id) return true;
      const author = m.uid ? people[m.uid] : null;
      return !!author && paSrv.areAllies(viewer, author);
    });
  }
  // Гостю показываем заглушки без имени автора
  if (!viewer) {
    const g = pageOf(all, page);
    return {
      messages: g.slice.map((m: any) => (m.del
        ? { ...m, text: DELETED_TEXT, tombstone: true }
        : m)),
      page: g.page, pages: g.pages, pageSize: g.size, total: all.length,
    };
  }
  const pa = require('./personalAlliance');
  const players: Record<string, User> = require('./player').users();
  const rolesSrv = require('./roles');
  const viewerIsStaff = rolesSrv.isModerator(viewer);
  // Исходный текст удалённого сообщения видят только администрация и
  // владелец — им нужно проверять решения модераторов. Остальные, включая
  // самого автора, видят на его месте строку «Сообщение удалено».
  const seesDeleted = rolesSrv.isAdmin(viewer);
  const pg = pageOf(all, page);
  return {
    page: pg.page, pages: pg.pages, pageSize: pg.size, total: all.length,
    messages: pg.slice.map((m: any) => {
      const author = m.uid ? players[m.uid] : null;
      const roles = require('./roles');
      return {
        ...m,
        ally: !!author && pa.areAllies(viewer, author),
        self: m.uid === viewer.id,
        // Обращаются ко мне: игрок должен видеть это сразу, а не
        // вычитывать своё имя в потоке чужих сообщений. Своё же
        // сообщение обращением к себе не считаем.
        toMe: m.uid !== viewer.id && !m.del && mentionsName(m.text, viewer.name),
        // Значок сотрудника проекта: «Дозор» у модератора, свои подписи
        // у администратора и владельца — чтобы в чате было видно, кто есть кто
        staff: author ? (roles.roleOf(author) || null) : null,
        staffLabel: author ? (roles.roleLabel(author) || null) : null,
        staffTag: author ? (roles.roleTag(author) || null) : null,
        vip: author ? (() => { try { return require('./vip').isVip(author); } catch (e) { return false; } })() : false,
        // Сотрудникам показываем, кто уже под блокировкой — чтобы не
        // выдавать повторную и видеть, кем уже занимались
        banned: (viewerIsStaff && author) ? !!roles.chatBanInfo(author) : false,
        // Пометка удаления. Администрация видит исходный текст и автора
        // решения, остальные — только заглушку.
        deleted: !!m.del,
        deletedBy: seesDeleted ? (m.delBy || '') : '',
        tombstone: !!m.del && !seesDeleted,
        ...(m.del && !seesDeleted ? { text: DELETED_TEXT } : {}),
      };
    }),
  };
}

function chatPost(user: User, text: string, room?: string) {
  text = String(text || '').trim().slice(0, config.CHAT.MAX_LEN);
  if (!text) throw new u.ApiError('Пустое сообщение');
  // Кляп на «Чат легиона» закрывает и альянс: в правах это один канал
  require('./roles').assertCanWrite(user, room === 'alliance' ? 'legion' : 'global');
  const now = Date.now();
  // Простейшая защита от спама: не чаще одного сообщения в 3 секунды
  if (user.lastChatAt && now - user.lastChatAt < config.CHAT.RATE_MS) {
    throw new u.ApiError('Не так быстро, боец! Подожди пару секунд.');
  }
  user.lastChatAt = now;
  const w = world();
  // Комната: 'global' — общий эфир, 'recruit' — «Позывные», доска для
  // поиска соратников. Разделение нужно, чтобы объявления о наборе не
  // тонули в живом чате, а чат не превращался в ленту объявлений.
  const roomId = roomOf(room);
  // В альянс пишут только тем, у кого есть хоть один взаимный союзник:
  // иначе сообщение уходит в пустоту, и игрок думает, что чат сломан.
  if (roomId === 'alliance') {
    const roster = ((user as any).allianceRoster || []).filter((m: any) => m && !m.isBot);
    const people: Record<string, User> = require('./player').users();
    const paSrv = require('./personalAlliance');
    const allies = roster.filter((m: any) => people[m.id] && paSrv.areAllies(user, people[m.id]));
    if (!allies.length) {
      throw new u.ApiError('В вашем альянсе пока нет взаимных союзников — писать некому');
    }
  }
  w.chat.push({ id: w.seq++, uid: user.id, name: user.name, flag: player.flag(user), level: user.level, text, at: now, room: roomId });
  // Счётчик сообщений: по нему считаются условия приглашений («друзья
  // написали 100 сообщений»). Сама лента хранит только последние N
  // сообщений, поэтому посчитать задним числом по ней нельзя.
  try { require('./dailyQuests').bump(user, 'chatMessages', 1); } catch (e) {}
  // Обучение: задание «Выйти на связь»
  try { require('./tutorial').notify(user, 'chat', []); } catch (e) {}
  // Храним только последние N сообщений
  if (w.chat.length > config.CHAT.KEEP) w.chat.splice(0, w.chat.length - config.CHAT.KEEP);
}

// ---------- ПОЧТА (только письма между игроками, треды по собеседнику) ----------
// Каждое письмо кладётся ОБЕИМ сторонам: получателю (dir:'in') и
// отправителю (dir:'out', уже прочитано — сам же написал). Это даёт
// полноценную историю переписки с каждым конкретным игроком.
// Системные события (приглашения, ачивки, аукцион и т.п.) сюда больше
// НЕ попадают — для них есть notifications.ts (колокольчик).
function pushMailEntry(userId: string, entry: any): void {
  const box = mailboxOf(userId);
  box.push(entry);
  if (box.length > config.MAIL.KEEP) box.splice(0, box.length - config.MAIL.KEEP);
}

// Письмо ТОЛЬКО от реального игрока — сохраняем копию и отправителю
// (dir:'out'), чтобы у обоих была полная история переписки.
function mailBetween(fromUser: User, toUser: User, subject: string, text: string): void {
  const at = Date.now();
  // Пустая тема остаётся пустой. Раньше подставлялось «(без темы)», и в
  // переписке над КАЖДЫМ сообщением висела эта заглушка — интерфейс
  // писем вообще не спрашивает тему, так что она была пустой всегда.
  // Кто написал, теперь видно по позывному над сообщением.
  const s = String(subject || '').slice(0, 80);
  const t = String(text || '').slice(0, config.MAIL.MAX_LEN);
  pushMailEntry(toUser.id, { id: u.uid(10), dir: 'in', otherId: fromUser.id, otherName: fromUser.name, subject: s, text: t, at, read: false });
  pushMailEntry(fromUser.id, { id: u.uid(10), dir: 'out', otherId: toUser.id, otherName: toUser.name, subject: s, text: t, at, read: true });
  db.save('mail');
}

// Непрочитанные — только входящие письма от РЕАЛЬНЫХ игроков (otherId
// задан). Старые системные записи (otherId=null, до перехода на
// notifications.ts) в счётчик и в список ниже не попадают.
function unread(user: User): number {
  return mailboxOf(user.id).filter((m) => !m.read && m.dir !== 'out' && m.otherId).length;
}

// Список ТРЕДОВ (переписок) — сгруппировано по собеседнику, последнее
// сообщение сверху. Легаси-записи без otherId (старые системные письма)
// отфильтровываются — это и убирает уведомления из почты «задним числом».
function inbox(user: User) {
  const box = mailboxOf(user.id).filter((m) => m.otherId); // только реальные переписки
  const threads = new Map<string, any>();
  for (const m of box) {
    let th = threads.get(m.otherId);
    if (!th) { th = { otherId: m.otherId, otherName: m.otherName, lastAt: 0, unread: 0, messages: [] }; threads.set(m.otherId, th); }
    th.messages.push({ id: m.id, dir: m.dir, subject: m.subject, text: m.text, at: m.at, read: m.read });
    if (m.at > th.lastAt) { th.lastAt = m.at; th.otherName = m.otherName; } // имя берём из последнего сообщения (могло смениться)
    if (m.dir !== 'out' && !m.read) th.unread++;
  }
  const list = Array.from(threads.values());
  list.forEach((th) => th.messages.sort((a: any, b: any) => a.at - b.at));
  list.sort((a, b) => b.lastAt - a.lastAt);
  return { threads: list };
}

// Открыть переписку с конкретным собеседником — помечает ВСЕ его
// входящие письма прочитанными и возвращает полную историю.
function readThread(user: User, otherId: string) {
  const box = mailboxOf(user.id);
  const messages = box.filter((m) => m.otherId === otherId);
  if (!messages.length) throw new u.ApiError('Переписка не найдена');
  let changed = false;
  for (const m of messages) { if (m.dir !== 'out' && !m.read) { m.read = true; changed = true; } }
  if (changed) db.save('mail');
  messages.sort((a, b) => a.at - b.at);
  return {
    otherId, otherName: messages[messages.length - 1].otherName,
    messages: messages.map((m) => ({ id: m.id, dir: m.dir, subject: m.subject, text: m.text, at: m.at })),
  };
}

function sendMail(user: User, toName: string, subject: string, text: string) {
  // Личные сообщения тоже можно закрыть — но только если модератор выбрал
  // этот канал отдельно. По умолчанию блокировка их не затрагивает.
  require('./roles').assertCanWrite(user, 'mail');
  const target = player.findByName(toName);
  if (!target) throw new u.ApiError('Игрок с таким именем не найден');
  if (target.id === user.id) throw new u.ApiError('Письмо самому себе? Лучше веди дневник.');
  if (!String(text || '').trim()) throw new u.ApiError('Пустое письмо');
  mailBetween(user, target, subject, text);
}

// ---------- ЗАЛ СЛАВЫ ----------
// Топ-10 игроков в нескольких категориях
// Зал славы — вынесен в отдельный модуль
const fameMod: any = require('./fame');
const fame = fameMod.fame;

function markAllRead(user: User) {
  const box = mailboxOf(user.id);
  let n = 0;
  for (const m of box) { if (m.dir !== 'out' && !m.read) { m.read = true; n++; } }
  if (n > 0) db.save('mail');
  return { marked: n };
}

// Удалить ОДНО письмо из ящика игрока (по id записи). Удаляется только из
// ящика этого игрока — у собеседника его копия остаётся.
function deleteMail(user: User, messageId: string) {
  const box = mailboxOf(user.id);
  const idx = box.findIndex((m) => m.id === messageId);
  if (idx === -1) throw new u.ApiError('Письмо не найдено');
  box.splice(idx, 1);
  db.save('mail');
  return { ok: true, deleted: messageId };
}

// Удалить ВСЮ переписку с одним собеседником — из ящика этого игрока.
// У собеседника его копия остаётся: письмо получено, и стереть его у
// другого человека нельзя.
function deleteThread(user: User, otherId: string) {
  const box = mailboxOf(user.id);
  const before = box.length;
  for (let i = box.length - 1; i >= 0; i--) if (box[i].otherId === otherId) box.splice(i, 1);
  const removed = before - box.length;
  if (!removed) throw new u.ApiError('Переписка не найдена');
  db.save('mail');
  return { ok: true, deleted: removed };
}

// Очистить ящик целиком. Письма-награды от «Система» здесь НЕ трогаются:
// они лежат в другом хранилище (rewards.ts), и в незабранном письме
// лежит золото — очистка почты не должна его сжигать.
function clearMail(user: User) {
  const box = mailboxOf(user.id);
  const removed = box.length;
  if (!removed) return { ok: true, deleted: 0 };
  box.length = 0;
  db.save('mail');
  return { ok: true, deleted: removed };
}

export = { chatGet, chatPost, unread, inbox, readThread, markAllRead, deleteMail, deleteThread, clearMail, sendMail, fame, purgeChatMessages,};
