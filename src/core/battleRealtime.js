// ===================================================================
// src/core/battleRealtime.js — WebSocket-обновления боя легиона
// Клиент подключается к /ws/legion-battle?token=...
// Сервер пушит свежее состояние боя всем участникам обоих легионов.
// ===================================================================

const WebSocket = require('ws');
const db = require('./db');
const player = require('../services/player');

let wss = null;
// userId → Set<WebSocket>
const clients = new Map();

function init(httpServer) {
  if (wss) return;
  wss = new WebSocket.Server({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/ws/legion-battle') return;
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, url);
      });
    } catch (e) {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, req, url) => {
    const token = url.searchParams.get('token') || '';
    const sessions = db.load('sessions', {});
    const userId = sessions[token];
    if (!userId) {
      ws.close(4401, 'auth');
      return;
    }
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(ws);

    ws.on('close', () => {
      const set = clients.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) clients.delete(userId);
      }
    });
    ws.on('error', () => ws.close());
  });
}

function send(userId, payload) {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;
  const raw = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(raw);
  }
}

// Отправить актуальное состояние боя всем бойцам обоих легионов.
function pushBattleUpdate(battle) {
  if (!battle || !battle.legionA || !battle.legionB) return;
  const legions = db.load('legions', {});
  const la = legions[battle.legionA];
  const lb = legions[battle.legionB];
  if (!la || !lb) return;

  const userIds = new Set([...(la.members || []), ...(lb.members || [])]);
  const legionBattle = require('../services/legionBattle');
  const users = player.users();

  for (const uid of userIds) {
    const u = users[uid];
    if (!u) continue;
    const { battle: state } = legionBattle.battleState(u);
    if (state) send(uid, { type: 'battle', battle: state });
  }
}

module.exports = { init, pushBattleUpdate };
