/**
 * Battleship LAN Server
 * MIT License
 *
 * Run: node server.js [port]
 * Default port: 3000
 *
 * Two players connect via WebSocket from their browsers.
 * The server acts as a relay and validates shots.
 */

'use strict';

const { WebSocketServer } = require('ws');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2], 10) || 3000;

// ── Static file server ────────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }

  // Only serve index.html from this directory
  const safePath = path.normalize(req.url.split('?')[0]);
  if (safePath === '/' || safePath === '/index.html') {
    const file = path.join(__dirname, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(500); res.end('Server error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

// ── WebSocket server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

// Each room has exactly 2 players (sockets).
// rooms: Map<roomCode, { players: [ws, ws|null], state: roomState }>
const rooms = new Map();

function createRoomState() {
  return {
    phase: 'waiting',   // waiting | setup | playing | over
    boards: [null, null],  // each player's ship layout (set during setup)
    shots: [           // shots[i] = shots fired BY player i (array of {r,c})
      [],
      [],
    ],
    ready: [false, false],
    currentTurn: 0,    // 0 or 1
  };
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function broadcast(room, obj) {
  room.players.forEach(ws => send(ws, obj));
}

function playerIndex(room, ws) {
  return room.players.indexOf(ws);
}

// Validate a board: each ship must be contiguous h or v segment of correct size
// board is an array of 100 numbers (0 = empty, 1-5 = ship id).
// Ship sizes must match [5,4,3,3,2].
const SHIP_SIZES = [5, 4, 3, 3, 2];
function validateBoard(board) {
  if (!Array.isArray(board) || board.length !== 100) return false;
  // Count cells per ship id
  const counts = [0, 0, 0, 0, 0, 0]; // index 1-5
  for (const v of board) {
    if (typeof v !== 'number' || v < 0 || v > 5 || !Number.isInteger(v)) return false;
    if (v > 0) counts[v]++;
  }
  for (let id = 1; id <= 5; id++) {
    if (counts[id] !== SHIP_SIZES[id - 1]) return false;
  }
  return true;
}

function checkSunk(board, shots, shipId) {
  // A ship is sunk when all its cells have been shot
  const shipCells = [];
  for (let i = 0; i < 100; i++) {
    if (board[i] === shipId) shipCells.push(i);
  }
  return shipCells.every(idx => shots.some(s => s.r * 10 + s.c === idx));
}

function allSunk(board, shots) {
  for (let id = 1; id <= 5; id++) {
    if (!checkSunk(board, shots, id)) return false;
  }
  return true;
}

wss.on('connection', (ws) => {
  ws._room = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── JOIN ────────────────────────────────────────────────────────────────
      case 'join': {
        const code = String(msg.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        if (!code) { send(ws, { type: 'error', text: 'Invalid room code.' }); return; }

        let room = rooms.get(code);
        if (!room) {
          room = { players: [ws, null], state: createRoomState() };
          rooms.set(code, room);
          ws._room = code;
          send(ws, { type: 'joined', player: 0, room: code });
          send(ws, { type: 'waiting', text: 'Waiting for Player 2 to join…' });
        } else if (room.players[1] === null) {
          room.players[1] = ws;
          ws._room = code;
          send(ws, { type: 'joined', player: 1, room: code });
          // Both connected — start setup phase
          room.state.phase = 'setup';
          broadcast(room, { type: 'start_setup', text: 'Both players connected! Place your ships.' });
        } else {
          send(ws, { type: 'error', text: 'Room is full.' });
        }
        break;
      }

      // ── BOARD READY ─────────────────────────────────────────────────────────
      case 'board': {
        const code = ws._room;
        const room = rooms.get(code);
        if (!room || room.state.phase !== 'setup') return;

        const idx = playerIndex(room, ws);
        if (idx === -1) return;

        if (!validateBoard(msg.board)) {
          send(ws, { type: 'error', text: 'Invalid board layout.' });
          return;
        }
        room.state.boards[idx] = msg.board;
        room.state.ready[idx] = true;
        send(ws, { type: 'board_ok' });

        if (room.state.ready[0] && room.state.ready[1]) {
          room.state.phase = 'playing';
          room.state.currentTurn = 0;
          broadcast(room, { type: 'game_start', currentTurn: 0 });
        }
        break;
      }

      // ── FIRE ────────────────────────────────────────────────────────────────
      case 'fire': {
        const code = ws._room;
        const room = rooms.get(code);
        if (!room || room.state.phase !== 'playing') return;

        const idx = playerIndex(room, ws);
        if (idx === -1 || idx !== room.state.currentTurn) {
          send(ws, { type: 'error', text: 'Not your turn.' });
          return;
        }

        const r = msg.r, c = msg.c;
        if (typeof r !== 'number' || typeof c !== 'number' ||
            r < 0 || r > 9 || c < 0 || c > 9 ||
            !Number.isInteger(r) || !Number.isInteger(c)) {
          send(ws, { type: 'error', text: 'Invalid coordinates.' }); return;
        }

        const oppIdx = 1 - idx;
        const myShots = room.state.shots[idx];

        // Duplicate shot check
        if (myShots.some(s => s.r === r && s.c === c)) {
          send(ws, { type: 'error', text: 'Already fired there.' }); return;
        }

        myShots.push({ r, c });

        const oppBoard = room.state.boards[oppIdx];
        const cellIdx  = r * 10 + c;
        const shipId   = oppBoard[cellIdx];
        const hit      = shipId > 0;
        let sunk = false;
        if (hit) sunk = checkSunk(oppBoard, myShots, shipId);

        const shotResult = { type: 'shot_result', shooter: idx, r, c, hit, sunk, shipId };

        if (allSunk(oppBoard, myShots)) {
          room.state.phase = 'over';
          broadcast(room, { ...shotResult, type: 'game_over', winner: idx });
        } else {
          if (!hit) room.state.currentTurn = oppIdx; // miss => switch turn
          broadcast(room, shotResult);
          if (hit) broadcast(room, { type: 'turn', currentTurn: idx }); // stay on turn
          else     broadcast(room, { type: 'turn', currentTurn: oppIdx });
        }
        break;
      }

      // ── CHAT ────────────────────────────────────────────────────────────────
      case 'chat': {
        const code = ws._room;
        const room = rooms.get(code);
        if (!room) return;
        const idx = playerIndex(room, ws);
        const text = String(msg.text || '').slice(0, 200);
        broadcast(room, { type: 'chat', player: idx + 1, text });
        break;
      }

      default: break;
    }
  });

  ws.on('close', () => {
    const code = ws._room;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const idx = room.players.indexOf(ws);
    if (idx !== -1) room.players[idx] = null;
    const other = room.players[1 - idx];
    if (other) send(other, { type: 'opponent_left' });
    // Clean up room if both gone
    if (!room.players[0] && !room.players[1]) rooms.delete(code);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(require('os').networkInterfaces())
    .flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);

  console.log(`\n🚢  Battleship LAN Server running!\n`);
  console.log(`  Local:   http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  Network: http://${ip}:${PORT}`));
  console.log(`\nShare a Network URL with Player 2 on the same Wi-Fi / LAN.\n`);
});
