'use strict';

/* ═══════════════════════════════════════════════════════════
   Yonin Shogi  –  4-player shogi (client-side game logic + UI)
   ═══════════════════════════════════════════════════════════ */

// ── Constants ──────────────────────────────────────────────
const ROWS = 9, COLS = 9, CENTER = 4;
const P = { PAWN: 0, SILVER: 1, GOLD: 2, ROOK: 3, KING: 4, P_PAWN: 5, P_SILVER: 6, P_ROOK: 7 };
const KANJI = ['歩','銀','金','飛','王','と','全','龍'];
const PIECE_NAMES = ['Pawn','Silver','Gold','Rook','King','Tokin','+Silver','Dragon'];
const DEMOTE = [0,1,2,3,4, 0,1,3]; // promoted → base type
// base → promoted type. NOTE: rook(3) promotes to 7 (dragon), NOT 3+5=8 — the
// +5 shortcut only holds for pawn(0→5) and silver(1→6). Indices 5-7 are identity.
const PROMOTE = [5,6,2,7,4, 5,6,7];
const CAN_PROMOTE = [true, true, false, true, false, false, false, false];
const PLAYER_LABELS = ['South','West','North','East'];
const PLAYER_COLORS = ['#d4a84b','#5e8ec5','#9a9a9a','#c55e5e'];

// Movement vectors for piece facing UP (player 0 = south).
// Step moves: list of [dr, dc]
// Slide moves: { slides: [[dr,dc], ...] }
const MOVES = {
  [P.PAWN]:     { steps: [[-1,0]] },
  [P.SILVER]:   { steps: [[-1,-1],[-1,0],[-1,1],[1,-1],[1,1]] },
  [P.GOLD]:     { steps: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,0]] },
  [P.ROOK]:     { slides: [[-1,0],[1,0],[0,-1],[0,1]] },
  [P.KING]:     { steps: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]] },
  [P.P_PAWN]:   { steps: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,0]] },  // = gold
  [P.P_SILVER]: { steps: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,0]] },  // = gold
  [P.P_ROOK]:   { slides: [[-1,0],[1,0],[0,-1],[0,1]], steps: [[-1,-1],[-1,1],[1,-1],[1,1]] }, // rook + diag 1
};

// ── Rotation helpers ──────────────────────────────────────
function rotateVec(dr, dc, n) {
  // Rotate vector by n * 90° clockwise
  for (let i = 0; i < (n % 4); i++) { [dr, dc] = [dc, -dr]; }
  return [dr, dc];
}

function rotatePos(r, c, n) {
  // Rotate board position around center (4,4) by n * 90° CW
  let dr = r - CENTER, dc = c - CENTER;
  [dr, dc] = rotateVec(dr, dc, n);
  return [CENTER + dr, CENTER + dc];
}

function inBounds(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }

// ── Piece helpers ─────────────────────────────────────────
function makePiece(type, owner, promoted) {
  return { type: promoted && CAN_PROMOTE[type] ? PROMOTE[type] : type, owner };
}

function isPromoted(type) { return type >= P.P_PAWN; }
function baseType(type) { return DEMOTE[type]; }

// A piece's movement/facing direction. Normally equal to its owner, but pieces
// inherited via checkmate keep the eliminated player's direction (stored in `dir`),
// while their control (owner) passes to the mating player.
function dirOf(p) { return p.dir != null ? p.dir : p.owner; }

// Promotion zones: 3 ranks closest to opposite player
function getPromotionZone(player) {
  // Player 0 (south) promotes in rows 0-2 (north zone)
  // Player 1 (west)  promotes in cols 6-8 (east zone)
  // Player 2 (north) promotes in rows 6-8 (south zone)
  // Player 3 (east)  promotes in cols 0-2 (west zone)
  switch (player) {
    case 0: return (r, c) => r <= 2;
    case 1: return (r, c) => c >= 6;
    case 2: return (r, c) => r >= 6;
    case 3: return (r, c) => c <= 2;
  }
}

// Dead zone: rank where pawn can never move again
function isDeadZone(player, r, c) {
  switch (player) {
    case 0: return r === 0;
    case 1: return c === 8;
    case 2: return r === 8;
    case 3: return c === 0;
  }
}

// ── Initial board setup ───────────────────────────────────
// Offsets from king position for player 0 (south, king at [8,4]):
// S(-2), G(-1,0), K(0,0), G(+1,0), S(+2)  — rank 9
// P(-1), R(0), P(+1)                         — rank 8
// P(0)                                        — rank 7
const SETUP_OFFSETS = [
  { type: P.SILVER, dr: 0, dc: -2 },
  { type: P.GOLD,   dr: 0, dc: -1 },
  { type: P.KING,   dr: 0, dc:  0 },
  { type: P.GOLD,   dr: 0, dc:  1 },
  { type: P.SILVER, dr: 0, dc:  2 },
  { type: P.PAWN,   dr:-1, dc: -1 },
  { type: P.ROOK,   dr:-1, dc:  0 },
  { type: P.PAWN,   dr:-1, dc:  1 },
  { type: P.PAWN,   dr:-2, dc:  0 },
];

// King positions for each player (before rotation)
const KING_POS = [[8, 4], [4, 0], [0, 4], [4, 8]];

function createInitialBoard() {
  const board = Array.from({ length: 9 }, () => Array(9).fill(null));
  for (let player = 0; player < 4; player++) {
    const [kr, kc] = KING_POS[player];
    for (const off of SETUP_OFFSETS) {
      const [dr, dc] = rotateVec(off.dr, off.dc, player);
      const r = kr + dr, c = kc + dc;
      if (inBounds(r, c)) {
        board[r][c] = { type: off.type, owner: player };
      }
    }
  }
  return board;
}

function createInitialPlayers() {
  return [0,1,2,3].map(i => ({
    id: i,
    name: '',
    connected: false,
    alive: true,
    hand: { 0:0, 1:0, 2:0, 3:0 } // pawn, silver, gold, rook counts
  }));
}

// ── Move generation ───────────────────────────────────────
function getReachable(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const mv = MOVES[piece.type];
  const results = [];
  const n = dirOf(piece); // rotation amount (movement direction)

  if (mv.steps) {
    for (const [dr0, dc0] of mv.steps) {
      const [dr, dc] = rotateVec(dr0, dc0, n);
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const target = board[nr][nc];
      if (target && target.owner === piece.owner) continue;
      // Can't capture dead kings
      if (target && target.type === P.KING && !findPlayer(target.owner).alive) continue;
      results.push([nr, nc]);
    }
  }
  if (mv.slides) {
    for (const [dr0, dc0] of mv.slides) {
      const [dr, dc] = rotateVec(dr0, dc0, n);
      let nr = r + dr, nc = c + dc;
      while (inBounds(nr, nc)) {
        const target = board[nr][nc];
        if (target) {
          if (target.owner !== piece.owner) {
            // Can't capture dead kings
            if (!(target.type === P.KING && !findPlayer(target.owner).alive)) {
              results.push([nr, nc]);
            }
          }
          break;
        }
        results.push([nr, nc]);
        nr += dr; nc += dc;
      }
    }
  }
  return results;
}

function findKing(board, player) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r][c] && board[r][c].type === P.KING && board[r][c].owner === player)
        return [r, c];
  return null;
}

function isThreatened(board, r, c, byPlayers) {
  // Check if square [r,c] is attacked by any of byPlayers
  for (let pr = 0; pr < 9; pr++) {
    for (let pc = 0; pc < 9; pc++) {
      const p = board[pr][pc];
      if (!p || !byPlayers.includes(p.owner)) continue;
      if (!findPlayer(p.owner).alive) continue;
      const reach = getReachable(board, pr, pc);
      if (reach.some(([rr, rc]) => rr === r && rc === c)) return true;
    }
  }
  return false;
}

function isInCheck(board, player) {
  const kp = findKing(board, player);
  if (!kp) return false;
  const enemies = [0,1,2,3].filter(i => i !== player && findPlayer(i).alive);
  return isThreatened(board, kp[0], kp[1], enemies);
}

function simulateMove(board, fr, fc, tr, tc) {
  const copy = board.map(row => row.map(cell => cell ? { ...cell } : null));
  copy[tr][tc] = copy[fr][fc];
  copy[fr][fc] = null;
  return copy;
}

function getValidMoves(board, r, c, player) {
  const piece = board[r][c];
  if (!piece || piece.owner !== player) return [];
  const reachable = getReachable(board, r, c);
  // Filter out moves that leave own king in check
  return reachable.filter(([tr, tc]) => {
    const sim = simulateMove(board, r, c, tr, tc);
    return !isInCheck(sim, player);
  });
}

function getDroppableSquares(board, pieceType, player) {
  const results = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c]) continue;
      // Pawns can't be dropped in dead zone
      if (pieceType === P.PAWN && isDeadZone(player, r, c)) continue;
      // Nifu: no two unpromoted pawns in the same column/row (relative to player)
      if (pieceType === P.PAWN && hasNifu(board, player, r, c)) continue;
      // Check if drop doesn't leave king in check (it shouldn't, but verify)
      const sim = board.map(row => row.map(cell => cell ? { ...cell } : null));
      sim[r][c] = { type: pieceType, owner: player };
      if (isInCheck(sim, player)) continue;
      // Uchifuzume: pawn drop can't immediately checkmate
      if (pieceType === P.PAWN) {
        const enemies = [0,1,2,3].filter(i => i !== player && findPlayer(i).alive);
        for (const enemy of enemies) {
          if (isCheckmated(sim, enemy)) return results; // skip this drop
        }
      }
      results.push([r, c]);
    }
  }
  return results;
}

function hasNifu(board, player, r, c) {
  // Nifu check depends on player orientation:
  // Player 0/2: same column; Player 1/3: same row
  if (player === 0 || player === 2) {
    for (let rr = 0; rr < 9; rr++) {
      const p = board[rr][c];
      if (p && p.type === P.PAWN && p.owner === player) return true;
    }
  } else {
    for (let cc = 0; cc < 9; cc++) {
      const p = board[r][cc];
      if (p && p.type === P.PAWN && p.owner === player) return true;
    }
  }
  return false;
}

function isCheckmated(board, player) {
  if (!findPlayer(player).alive) return false;
  if (!isInCheck(board, player)) return false;
  // Try all moves for all pieces of this player
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] && board[r][c].owner === player) {
        if (getValidMoves(board, r, c, player).length > 0) return false;
      }
    }
  }
  // Try all drops
  const hand = game.players[player].hand;
  for (let pt = 0; pt <= 3; pt++) {
    if (hand[pt] > 0) {
      if (getDroppableSquares(board, pt, player).length > 0) return false;
    }
  }
  return true;
}

function hasAnyLegalMove(board, player) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] && board[r][c].owner === player) {
        if (getValidMoves(board, r, c, player).length > 0) return true;
      }
    }
  }
  const hand = game.players[player].hand;
  for (let pt = 0; pt <= 3; pt++) {
    if (hand[pt] > 0) {
      if (getDroppableSquares(board, pt, player).length > 0) return true;
    }
  }
  return false;
}

// ── Game state ────────────────────────────────────────────
let game = {
  roomId: null,
  board: null,
  players: null,
  currentPlayer: 0,
  myPlayer: -1,  // which seat I'm in (-1 = spectator)
  status: 'waiting', // waiting | playing | finished
  moveHistory: [],
  lastMove: null,
  winner: null,
  pollTimer: null,
  selectedSquare: null,
  selectedHandPiece: null,
  validMoves: [],
  local: false,        // solo-vs-bots mode (runs entirely client-side)
  botSeats: [],        // seats controlled by the computer
  botTimer: null,      // pending bot-move timeout
  boardRotation: 0,    // quarter-turns the board view is rotated clockwise (0-3)
  showCp: false,       // show the bot's centipawn evaluation of each move it plays
};

function findPlayer(id) {
  return game.players ? game.players[id] : { alive: true };
}

// ── Multiplayer API ───────────────────────────────────────
const API = '/api';

async function apiCall(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(API + path, opts);
  return resp.json();
}

async function createRoom() {
  const data = await apiCall('POST', '/create');
  if (data.roomId) {
    window.location.href = '/game/' + data.roomId;
  }
}

// Take a seat. If we already hold a seat this becomes a "change seat": we claim
// the new seat first, then release the old one so a failed claim never strands us.
async function joinSeat(seat) {
  const prevSeat = game.myPlayer;
  if (prevSeat === seat) return;
  const name = document.getElementById('ys-player-name')?.value?.trim()
    || localStorage.getItem('ys_name_' + game.roomId) || 'Player';
  const data = await apiCall('POST', '/join/' + game.roomId, { seat, name });
  if (data.success) {
    if (prevSeat >= 0 && prevSeat !== seat) {
      await apiCall('POST', '/leave/' + game.roomId, { seat: prevSeat });
    }
    game.myPlayer = seat;
    orientToSeat(seat);
    localStorage.setItem('ys_seat_' + game.roomId, seat);
    localStorage.setItem('ys_name_' + game.roomId, name);
    renderAll();
  } else {
    alert(data.error || 'Could not join');
  }
}

// Give up our seat and return to spectating.
async function leaveSeat() {
  if (game.myPlayer < 0) return;
  const seat = game.myPlayer;
  game.myPlayer = -1;
  localStorage.removeItem('ys_seat_' + game.roomId);
  await apiCall('POST', '/leave/' + game.roomId, { seat });
  renderAll();
}

async function startGame() {
  const data = await apiCall('POST', '/start/' + game.roomId);
  if (!data.success) alert(data.error || 'Cannot start');
}

async function sendMove(move, silent) {
  // The move carries its own player (a human's own seat, or a bot seat the host
  // is driving), which must match the server's currentPlayer.
  const data = await apiCall('POST', '/move/' + game.roomId, { seat: move.player, move });
  if (!data.success && !silent) {
    alert(data.error || 'Invalid move');
  }
  return data;
}

// ── Host-authoritative bots in online rooms ───────────────
// Bot seats are run client-side by exactly one player: the connected human with
// the lowest seat index. That client computes the bot's move and relays it like
// any other move; everyone else just sees it arrive via polling.
async function addBot(seat, level) {
  const data = await apiCall('POST', '/addbot/' + game.roomId, { seat, level });
  if (data.success) pollState();
  else alert(data.error || 'Could not add bot');
}

async function removeBot(seat) {
  const data = await apiCall('POST', '/removebot/' + game.roomId, { seat });
  if (data.success) pollState();
  else alert(data.error || 'Could not remove bot');
}

function iAmBotRunner() {
  if (!game.players || game.myPlayer < 0) return false;
  const runner = game.players.findIndex(p => p && p.connected && !p.isBot);
  return runner !== -1 && runner === game.myPlayer;
}

function scheduleOnlineBotMove() {
  // Online bot seats are now driven authoritatively by the server (it computes
  // and relays their moves), so the client no longer runs them. Solo bots are
  // still handled locally by scheduleBotMove().
  if (game.botTimer) { clearTimeout(game.botTimer); game.botTimer = null; }
}

async function pollState() {
  try {
    const data = await apiCall('GET', '/state/' + game.roomId);
    if (!data.error) {
      applyServerState(data);
    }
  } catch (e) { /* retry next poll */ }
}

function applyServerState(data) {
  const prevMoveCount = game.moveHistory.length;
  // Detect changes against the *previous* state before overwriting it, otherwise
  // these comparisons would compare the incoming data against itself and never fire.
  const statusChanged = data.status !== game.status;
  const didPlayersChange = playersChanged(data.players);

  game.players = data.players;
  game.status = data.status;
  game.currentPlayer = data.currentPlayer;
  game.winner = data.winner;

  // Replay moves from server to rebuild board state
  if (data.moves && data.moves.length !== prevMoveCount) {
    game.board = createInitialBoard();
    game.players.forEach(p => { p.hand = { 0:0, 1:0, 2:0, 3:0 }; p.alive = true; });
    game.moveHistory = data.moves;
    game.lastMove = null;

    for (const m of data.moves) {
      applyMoveToBoard(m);
    }
    renderAll();
  } else if (statusChanged || didPlayersChange) {
    renderAll();
  }

  // After any state update, the host may need to play a bot whose turn it is.
  scheduleOnlineBotMove();
}

function playersChanged(newPlayers) {
  if (!game.players) return true;
  for (let i = 0; i < 4; i++) {
    if (game.players[i].name !== newPlayers[i].name ||
        game.players[i].connected !== newPlayers[i].connected) return true;
  }
  return false;
}

function applyMoveToBoard(m) {
  if (m.type === 'move') {
    const [fr, fc] = m.from;
    const [tr, tc] = m.to;
    const captured = game.board[tr][tc];

    // Capture
    if (captured) {
      const bt = baseType(captured.type);
      if (bt !== P.KING) {
        game.players[m.player].hand[bt]++;
      }
    }

    // Move piece
    game.board[tr][tc] = game.board[fr][fc];
    game.board[fr][fc] = null;

    // Promote
    if (m.promote) {
      const pt = game.board[tr][tc].type;
      if (CAN_PROMOTE[pt]) {
        game.board[tr][tc].type = PROMOTE[pt];
      }
    }

    game.lastMove = { from: [fr, fc], to: [tr, tc] };

    // Check for checkmates after this move
    handleCheckmates(m.player);
  } else if (m.type === 'drop') {
    const [tr, tc] = m.to;
    game.board[tr][tc] = { type: m.pieceType, owner: m.player };
    game.players[m.player].hand[m.pieceType]--;
    game.lastMove = { to: [tr, tc] };

    handleCheckmates(m.player);
  }
}

function handleCheckmates(mover) {
  // Check each alive enemy for checkmate
  for (let i = 0; i < 4; i++) {
    if (i === mover || !game.players[i].alive) continue;
    if (isCheckmated(game.board, i)) {
      eliminatePlayer(i, mover);
    }
  }
}

function eliminatePlayer(loser, winner) {
  game.players[loser].alive = false;
  // Transfer pieces (except king) to winner
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = game.board[r][c];
      if (p && p.owner === loser) {
        if (p.type === P.KING) {
          // Dead king stays as obstacle (mark dead)
          p.dead = true;
        } else {
          // Transfer control to the winner, but the piece keeps moving in the
          // eliminated player's original direction (yonin rule).
          if (p.dir == null) p.dir = p.owner;
          p.owner = winner;
        }
      }
    }
  }
  // Transfer hand pieces
  for (let pt = 0; pt <= 3; pt++) {
    game.players[winner].hand[pt] += game.players[loser].hand[pt];
    game.players[loser].hand[pt] = 0;
  }
}

// ── Local move execution ──────────────────────────────────
function tryMove(fr, fc, tr, tc) {
  if (game.status !== 'playing') return;
  if (game.currentPlayer !== game.myPlayer) return;

  const piece = game.board[fr][fc];
  if (!piece || piece.owner !== game.myPlayer) return;

  const valid = getValidMoves(game.board, fr, fc, game.myPlayer);
  if (!valid.some(([r, c]) => r === tr && c === tc)) return;

  // Check promotion
  const promoZone = getPromotionZone(dirOf(piece));
  const canPro = CAN_PROMOTE[piece.type] && !isPromoted(piece.type) &&
                 (promoZone(fr, fc) || promoZone(tr, tc));
  const mustPro = canPro && piece.type === P.PAWN && isDeadZone(dirOf(piece), tr, tc);

  if (mustPro) {
    executeMove(fr, fc, tr, tc, true);
  } else if (canPro) {
    showPromotionDialog(fr, fc, tr, tc);
  } else {
    executeMove(fr, fc, tr, tc, false);
  }
}

function executeMove(fr, fc, tr, tc, promote) {
  const move = { type: 'move', player: game.myPlayer, from: [fr, fc], to: [tr, tc], promote };
  commitMove(move);
}

// Shared commit path for human (and bot, via player on the move object).
function commitMove(move) {
  if (!game.local) sendMove(move);
  game.moveHistory.push(move);
  applyMoveToBoard(move);
  advanceTurn();
  clearSelection();
  renderAll();
  if (game.local) {
    checkLocalEnd();
    renderAll();
    scheduleBotMove();
  }
}

function tryDrop(pieceType, tr, tc) {
  if (game.status !== 'playing') return;
  if (game.currentPlayer !== game.myPlayer) return;
  if (game.players[game.myPlayer].hand[pieceType] <= 0) return;

  const valid = getDroppableSquares(game.board, pieceType, game.myPlayer);
  if (!valid.some(([r, c]) => r === tr && c === tc)) return;

  const move = { type: 'drop', player: game.myPlayer, pieceType, to: [tr, tc] };
  commitMove(move);
}

function advanceTurn() {
  // Yonin rule: if the move leaves an opponent in check, that player takes the
  // next turn immediately (clockwise-first if several are checked); clockwise
  // play then resumes from there. Checkmated players are already eliminated, so
  // they are skipped here. The server applies the same rule for online rooms;
  // here it keeps the optimistic local view in sync until the next poll.
  if (game.board) {
    for (let step = 1; step <= 4; step++) {
      const cand = (game.currentPlayer + step) % 4;
      if (game.players[cand].alive && isInCheck(game.board, cand)) {
        game.currentPlayer = cand;
        return;
      }
    }
  }
  // Next alive player clockwise
  let next = (game.currentPlayer + 1) % 4;
  for (let i = 0; i < 4; i++) {
    if (game.players[next].alive) { game.currentPlayer = next; return; }
    next = (next + 1) % 4;
  }
}

// ── Solo mode (play vs bots) ──────────────────────────────
function checkLocalEnd() {
  const alive = game.players.filter(p => p.alive);
  if (alive.length <= 1) {
    game.status = 'finished';
    const w = game.players.findIndex(p => p.alive);
    game.winner = w >= 0 ? w : null;
  }
}

function scheduleBotMove() {
  if (game.botTimer) { clearTimeout(game.botTimer); game.botTimer = null; }
  if (!game.local || game.status !== 'playing') return;
  if (!game.botSeats.includes(game.currentPlayer)) return;
  game.botTimer = setTimeout(runBotMove, 650);
}

function runBotMove() {
  game.botTimer = null;
  if (!game.local || game.status !== 'playing') return;
  const player = game.currentPlayer;
  if (!game.botSeats.includes(player)) return;

  const move = chooseBotMove(player, game.players[player].botLevel);
  if (!move) {
    // No legal move (rare in shogi) — concede this seat and continue.
    game.players[player].alive = false;
    checkLocalEnd();
    if (game.status === 'playing') advanceTurn();
    renderAll();
    scheduleBotMove();
    return;
  }
  move.cp = botMoveCp(move);  // centipawn eval of the chosen move (for the CP toggle)
  commitMove(move);
}

// Material-only centipawn eval of a board from `player`'s view: own material
// minus the strongest opponent's, ×100. Mirrors ShogiEngine.materialCp so solo
// and online show the same numbers.
function materialCp(board, player) {
  const mat = (pl) => {
    let s = 0;
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (p && p.owner === pl) s += PIECE_VALUE[p.type];
      }
    return s;
  };
  const mine = mat(player);
  let best = 0;
  for (let o = 0; o < 4; o++) if (o !== player) best = Math.max(best, mat(o));
  return Math.round((mine - best) * 100);
}

// CP of a bot move: evaluate the position right after the move (pre-elimination).
function botMoveCp(move) {
  const b = cloneBoard(game.board);
  if (move.type === 'move') {
    const [fr, fc] = move.from, [tr, tc] = move.to;
    b[tr][tc] = b[fr][fc]; b[fr][fc] = null;
    if (move.promote && b[tr][tc] && CAN_PROMOTE[b[tr][tc].type] && !isPromoted(b[tr][tc].type)) {
      b[tr][tc] = { ...b[tr][tc], type: PROMOTE[b[tr][tc].type] };
    }
  } else {
    const [tr, tc] = move.to;
    b[tr][tc] = { type: move.pieceType, owner: move.player };
  }
  return materialCp(b, move.player);
}

// Material values indexed by piece type (pawn,silver,gold,rook,king,tokin,+silver,dragon)
const PIECE_VALUE = [1, 5, 6, 11, 0, 7, 7, 13];

function cloneBoard(b) {
  return b.map(row => row.map(cell => cell ? { ...cell } : null));
}

function bestPromote(piece, fr, fc, tr, tc) {
  if (!CAN_PROMOTE[piece.type] || isPromoted(piece.type)) return false;
  const zone = getPromotionZone(dirOf(piece));
  // Pawn forced to promote in its dead zone; otherwise bots always take a promotion.
  return zone(fr, fc) || zone(tr, tc);
}

// Squares attacked by any alive enemy on the given board (one full scan).
function computeEnemyAttacks(board, enemies) {
  const map = Array.from({ length: 9 }, () => Array(9).fill(false));
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p || !enemies.includes(p.owner)) continue;
      for (const [rr, rc] of getReachable(board, r, c)) map[rr][rc] = true;
    }
  }
  return map;
}

// Difficulty tuning. `refine` = how many top candidates pay for full check/mate
// analysis, `window` = score spread of the random pick pool (bigger = looser
// play), `blunderChance` = probability of an outright random legal move.
const BOT_LEVELS = {
  easy:   { refine: 4,  window: 2.5,  blunderChance: 0.30 },
  medium: { refine: 12, window: 0.6,  blunderChance: 0 },
  hard:   { refine: 22, window: 0.05, blunderChance: 0 },
};

function chooseBotMove(player, level) {
  const cfg = BOT_LEVELS[level] || BOT_LEVELS.medium;
  const enemies = [0, 1, 2, 3].filter(i => i !== player && findPlayer(i).alive);
  const attackMap = computeEnemyAttacks(game.board, enemies);
  const candidates = [];

  // Board moves
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = game.board[r][c];
      if (!piece || piece.owner !== player) continue;
      const moves = getValidMoves(game.board, r, c, player);
      for (const [tr, tc] of moves) {
        const promote = bestPromote(piece, r, c, tr, tc);
        const move = { type: 'move', player, from: [r, c], to: [tr, tc], promote };
        candidates.push({ move, score: cheapScore(player, move, attackMap) });
      }
    }
  }

  // Drops from hand
  const hand = game.players[player].hand;
  for (let pt = 0; pt <= 3; pt++) {
    if (hand[pt] <= 0) continue;
    const squares = getDroppableSquares(game.board, pt, player);
    for (const [tr, tc] of squares) {
      const move = { type: 'drop', player, pieceType: pt, to: [tr, tc] };
      candidates.push({ move, score: cheapScore(player, move, attackMap) });
    }
  }

  if (candidates.length === 0) return null;

  // Easy bots occasionally just throw away the turn on a random legal move.
  if (cfg.blunderChance > 0 && prng() < cfg.blunderChance) {
    return candidates[Math.floor(prng() * candidates.length)].move;
  }

  candidates.sort((a, b) => b.score - a.score);

  // Only the most promising candidates pay for full check/checkmate detection.
  const refine = Math.min(cfg.refine, candidates.length);
  for (let i = 0; i < refine; i++) {
    candidates[i].score += threatBonus(player, candidates[i].move, enemies);
  }
  candidates.sort((a, b) => b.score - a.score);

  // Pick among the near-best for variety; a wider window means weaker play.
  const topScore = candidates[0].score;
  const pool = candidates.filter(x => x.score >= topScore - cfg.window);
  const idx = Math.floor(prng() * pool.length);
  return pool[Math.min(idx, pool.length - 1)].move;
}

// Lightweight deterministic-ish PRNG seeded from move count (avoids global RNG bans elsewhere).
let _rngState = 0x2545f491;
function prng() {
  _rngState ^= _rngState << 13; _rngState ^= _rngState >>> 17; _rngState ^= _rngState << 5;
  _rngState >>>= 0;
  return (_rngState % 100000) / 100000;
}

// Fast heuristic — material, promotion, central control, hanging penalty via attack map.
function cheapScore(player, move, attackMap) {
  let score = prng() * 0.5; // tie-break jitter
  if (move.type === 'move') {
    const [fr, fc] = move.from, [tr, tc] = move.to;
    const captured = game.board[tr][tc];
    if (captured && captured.owner !== player && captured.type !== P.KING) {
      score += PIECE_VALUE[captured.type];
    }
    let movedType = game.board[fr][fc].type;
    if (move.promote && CAN_PROMOTE[movedType] && !isPromoted(movedType)) { movedType = PROMOTE[movedType]; score += 0.7; }
    if (attackMap[tr][tc]) score -= PIECE_VALUE[movedType] * 0.6; // landing on an attacked square
    score -= (Math.abs(tr - CENTER) + Math.abs(tc - CENTER)) * 0.03; // mild central preference
  } else {
    const [tr, tc] = move.to;
    if (attackMap[tr][tc]) score -= PIECE_VALUE[move.pieceType] * 0.5;
    score -= 0.25; // slight preference for developing board pieces over dropping
  }
  return score;
}

// Expensive — only run on the top candidates: rewards checks and checkmates the move delivers.
function threatBonus(player, move, enemies) {
  const sim = cloneBoard(game.board);
  if (move.type === 'move') {
    const [fr, fc] = move.from, [tr, tc] = move.to;
    sim[tr][tc] = sim[fr][fc];
    sim[fr][fc] = null;
    if (move.promote && CAN_PROMOTE[sim[tr][tc].type] && !isPromoted(sim[tr][tc].type)) {
      sim[tr][tc] = { ...sim[tr][tc], type: PROMOTE[sim[tr][tc].type] };
    }
  } else {
    const [tr, tc] = move.to;
    sim[tr][tc] = { type: move.pieceType, owner: player };
  }
  return evalThreats(sim, player, enemies);
}

// Reward checks and (especially) checkmates the move delivers.
function evalThreats(sim, player, enemies) {
  let s = 0;
  for (const e of enemies) {
    if (isCheckmated(sim, e)) {
      s += 60;
      // Bonus for the material we'd inherit on elimination.
      for (let r = 0; r < 9; r++)
        for (let c = 0; c < 9; c++) {
          const p = sim[r][c];
          if (p && p.owner === e && p.type !== P.KING) s += PIECE_VALUE[p.type] * 0.4;
        }
    } else if (isInCheck(sim, e)) {
      s += 1.5;
    }
  }
  return s;
}

// ── Promotion dialog ──────────────────────────────────────
function showPromotionDialog(fr, fc, tr, tc) {
  const overlay = document.createElement('div');
  overlay.className = 'ys-promo-overlay';
  overlay.innerHTML = `
    <div class="ys-promo-dialog">
      <h5>${window.i18n?.['yonin.promote'] || 'Promote piece?'}</h5>
      <button class="btn btn-success" id="ys-promo-yes">${window.i18n?.['yonin.yes'] || 'Yes'}</button>
      <button class="btn btn-outline-secondary" id="ys-promo-no">${window.i18n?.['yonin.no'] || 'No'}</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('ys-promo-yes').onclick = () => { overlay.remove(); executeMove(fr, fc, tr, tc, true); };
  document.getElementById('ys-promo-no').onclick = () => { overlay.remove(); executeMove(fr, fc, tr, tc, false); };
}

// ── Selection & interaction ───────────────────────────────
function clearSelection() {
  game.selectedSquare = null;
  game.selectedHandPiece = null;
  game.validMoves = [];
}

function onCellClick(r, c) {
  if (game.status !== 'playing') return;
  if (game.myPlayer < 0) return; // spectator

  const isMyTurn = game.currentPlayer === game.myPlayer;

  // If dropping from hand
  if (game.selectedHandPiece !== null && isMyTurn) {
    if (game.validMoves.some(([vr, vc]) => vr === r && vc === c)) {
      tryDrop(game.selectedHandPiece, r, c);
      return;
    }
    clearSelection();
    renderAll();
    return;
  }

  // If piece selected, try to move there
  if (game.selectedSquare && isMyTurn) {
    const [sr, sc] = game.selectedSquare;
    if (sr === r && sc === c) {
      clearSelection();
      renderAll();
      return;
    }
    if (game.validMoves.some(([vr, vc]) => vr === r && vc === c)) {
      tryMove(sr, sc, r, c);
      return;
    }
  }

  // Select own piece
  const piece = game.board[r][c];
  if (piece && piece.owner === game.myPlayer && isMyTurn) {
    game.selectedSquare = [r, c];
    game.selectedHandPiece = null;
    game.validMoves = getValidMoves(game.board, r, c, game.myPlayer);
    renderAll();
    return;
  }

  clearSelection();
  renderAll();
}

function onHandPieceClick(pieceType) {
  if (game.status !== 'playing') return;
  if (game.currentPlayer !== game.myPlayer) return;
  if (game.players[game.myPlayer].hand[pieceType] <= 0) return;

  game.selectedSquare = null;
  game.selectedHandPiece = pieceType;
  game.validMoves = getDroppableSquares(game.board, pieceType, game.myPlayer);
  renderAll();
}

// ── Rendering ─────────────────────────────────────────────
function renderAll() {
  renderBoard();
  renderHands();
  renderPlayerCards();
  renderStatus();
  renderMoveLog();
  renderLobby();
  renderSoloControls();
  applyBoardRotation();
}

// ── Board rotation ────────────────────────────────────────
// Rotating the whole board area (board + the four hands) is a pure visual
// transform: clicks still hit the right cells, and each piece glyph — which
// already faces its owner's direction — rotates along so the chosen player's
// pieces end up pointing "up". Default orientation puts your own seat at the
// bottom; rotation = (4 - seat) % 4 brings seat `seat` to the bottom.
function orientToSeat(seat) {
  const s = seat >= 0 ? seat : 0;
  game.boardRotation = (4 - s) % 4;
}

function rotateBoard() {
  game.boardRotation = (game.boardRotation + 1) % 4;
  applyBoardRotation();
}

function applyBoardRotation() {
  const area = document.querySelector('.ys-board-area');
  if (area) area.style.transform = `rotate(${game.boardRotation * 90}deg)`;
}

function renderSoloControls() {
  if (!game.local) return;
  const copyCtl = document.getElementById('ys-copy-controls');
  if (copyCtl) copyCtl.style.display = 'none';
  const soloCtl = document.getElementById('ys-solo-controls');
  if (soloCtl) soloCtl.style.display = game.status === 'finished' ? '' : 'none';
}

function renderBoard() {
  const el = document.getElementById('ys-board');
  if (!el || !game.board) return;

  el.innerHTML = '';
  const checkedPlayers = new Set();
  if (game.status === 'playing') {
    for (let i = 0; i < 4; i++) {
      if (game.players[i].alive && isInCheck(game.board, i)) checkedPlayers.add(i);
    }
  }

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement('div');
      cell.className = 'ys-cell';
      cell.dataset.r = r;
      cell.dataset.c = c;

      // Star points
      if ((r === 2 || r === 6) && (c === 2 || c === 6)) cell.classList.add('star');

      // Last move highlight
      if (game.lastMove) {
        if (game.lastMove.from && game.lastMove.from[0] === r && game.lastMove.from[1] === c) cell.classList.add('last-move');
        if (game.lastMove.to[0] === r && game.lastMove.to[1] === c) cell.classList.add('last-move');
      }

      // Selection
      if (game.selectedSquare && game.selectedSquare[0] === r && game.selectedSquare[1] === c) {
        cell.classList.add('selected');
      }

      // Valid move dots
      const isValid = game.validMoves.some(([vr, vc]) => vr === r && vc === c);
      if (isValid) {
        if (game.board[r][c]) cell.classList.add('valid-capture');
        else cell.classList.add('valid-move');
      }

      // Piece
      const piece = game.board[r][c];
      if (piece) {
        const pieceEl = document.createElement('div');
        pieceEl.className = `ys-piece player-${piece.owner} facing-${dirOf(piece)}`;
        if (isPromoted(piece.type)) pieceEl.classList.add('promoted');
        if (piece.dead) pieceEl.classList.add('dead-king');
        pieceEl.textContent = KANJI[piece.type];

        // Check highlight on king
        if (piece.type === P.KING && checkedPlayers.has(piece.owner)) {
          cell.classList.add('in-check');
        }

        cell.appendChild(pieceEl);
      }

      cell.addEventListener('click', () => onCellClick(r, c));
      el.appendChild(cell);
    }
  }
}

function renderHands() {
  if (!game.players) return;
  const handEls = {
    0: document.getElementById('ys-hand-south'),
    1: document.getElementById('ys-hand-west'),
    2: document.getElementById('ys-hand-north'),
    3: document.getElementById('ys-hand-east'),
  };

  for (let player = 0; player < 4; player++) {
    const el = handEls[player];
    if (!el) continue;
    el.innerHTML = '';
    const hand = game.players[player].hand;
    for (let pt = 0; pt <= 3; pt++) {
      if (hand[pt] <= 0) continue;
      const wrapper = document.createElement('div');
      wrapper.className = 'ys-hand-piece';
      if (game.selectedHandPiece === pt && player === game.myPlayer) {
        wrapper.classList.add('selected');
      }

      const pieceEl = document.createElement('div');
      pieceEl.className = `ys-piece player-${player} facing-${player}`;
      pieceEl.textContent = KANJI[pt];
      wrapper.appendChild(pieceEl);

      if (hand[pt] > 1) {
        const cnt = document.createElement('span');
        cnt.className = 'ys-count';
        cnt.textContent = hand[pt];
        wrapper.appendChild(cnt);
      }

      if (player === game.myPlayer) {
        wrapper.addEventListener('click', () => onHandPieceClick(pt));
      }

      el.appendChild(wrapper);
    }
  }
}

function renderPlayerCards() {
  const el = document.getElementById('ys-player-cards');
  if (!el || !game.players) return;

  el.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const p = game.players[i];
    const card = document.createElement('div');
    card.className = `ys-player-card player-${i}`;
    if (game.status === 'playing' && game.currentPlayer === i && p.alive) card.classList.add('active-turn');
    if (!p.alive) card.classList.add('eliminated');

    const dot = `<span class="ys-player-dot"></span>`;
    const label = PLAYER_LABELS[i];
    const name = p.name ? escapeHtml(p.name) : (p.connected ? '...' : (window.i18n?.['yonin.empty'] || 'Empty'));
    const me = i === game.myPlayer ? ' (' + (window.i18n?.['yonin.you'] || 'You') + ')' : '';
    card.innerHTML = `${dot}<strong>${label}</strong>: ${name}${me}`;
    el.appendChild(card);
  }
}

function renderStatus() {
  const el = document.getElementById('ys-status');
  if (!el) return;

  if (game.status === 'waiting') {
    const count = game.players ? game.players.filter(p => p.connected).length : 0;
    el.innerHTML = `<i class="bi bi-hourglass-split me-2"></i>${window.i18n?.['yonin.waitingPlayers'] || 'Waiting for players'} (${count}/4)`;
  } else if (game.status === 'playing') {
    const cp = game.players[game.currentPlayer];
    const label = PLAYER_LABELS[game.currentPlayer];
    const style = `color: ${PLAYER_COLORS[game.currentPlayer]}`;
    if (game.currentPlayer === game.myPlayer) {
      el.innerHTML = `<span style="${style}"><i class="bi bi-arrow-right-circle-fill me-2"></i>${window.i18n?.['yonin.yourTurn'] || 'Your turn!'}</span>`;
    } else if (game.local && game.botSeats.includes(game.currentPlayer)) {
      el.innerHTML = `<span style="${style}"><span class="spinner-border spinner-border-sm me-2"></span>${cp.name || label}: ${window.i18n?.['yonin.botThinking'] || 'Bot is thinking…'}</span>`;
    } else {
      el.innerHTML = `<span style="${style}"><i class="bi bi-clock me-2"></i>${cp.name || label}'s turn</span>`;
    }
  } else if (game.status === 'finished') {
    const winnerName = game.winner !== null ? (game.players[game.winner].name || PLAYER_LABELS[game.winner]) : '?';
    el.innerHTML = `<i class="bi bi-trophy-fill text-warning me-2"></i>${winnerName} ${window.i18n?.['yonin.wins'] || 'wins!'}`;
  }
}

function renderMoveLog() {
  const el = document.getElementById('ys-move-log');
  if (!el) return;

  el.innerHTML = '';
  for (let i = 0; i < game.moveHistory.length; i++) {
    const m = game.moveHistory[i];
    const entry = document.createElement('div');
    entry.className = `move-entry player-${m.player}`;
    const label = PLAYER_LABELS[m.player];
    let text;
    if (m.type === 'move') {
      const from = coordToLabel(m.from[0], m.from[1]);
      const to = coordToLabel(m.to[0], m.to[1]);
      const promo = m.promote ? '+' : '';
      text = `${i+1}. ${label}: ${from}→${to}${promo}`;
    } else {
      const to = coordToLabel(m.to[0], m.to[1]);
      text = `${i+1}. ${label}: ${KANJI[m.pieceType]}*${to}`;
    }
    entry.textContent = text;
    // Show the bot's centipawn evaluation of its own move when the toggle is on.
    if (game.showCp && typeof m.cp === 'number') {
      const cp = document.createElement('span');
      cp.className = 'ys-cp';
      const sign = m.cp > 0 ? '+' : '';
      cp.textContent = ` (${sign}${m.cp}cp)`;
      entry.appendChild(cp);
    }
    el.appendChild(entry);
  }
  el.scrollTop = el.scrollHeight;
}

function coordToLabel(r, c) {
  return `${9-c}${String.fromCharCode(97+r)}`;
}

function renderLobby() {
  const lobbyEl = document.getElementById('ys-lobby');
  const gameEl = document.getElementById('ys-game-area');
  if (!lobbyEl || !gameEl) return;

  if (game.status === 'waiting') {
    lobbyEl.style.display = '';
    gameEl.style.display = 'none';
    renderSeats();
  } else {
    lobbyEl.style.display = 'none';
    gameEl.style.display = '';
  }
}

function botLabel(level) {
  const key = 'yonin.' + (level || 'medium');
  const fallback = level ? level.charAt(0).toUpperCase() + level.slice(1) : 'Medium';
  return (window.i18n?.['yonin.bot'] || 'Bot') + ' (' + (window.i18n?.[key] || fallback) + ')';
}

// Escape user-supplied text (nicknames) before injecting via innerHTML.
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderSeats() {
  const el = document.getElementById('ys-seats');
  if (!el || !game.players) return;
  const t = (k, d) => window.i18n?.[k] || d;

  el.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const p = game.players[i];
    const card = document.createElement('div');
    card.className = 'ys-seat-card';
    const colorDot = `<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${PLAYER_COLORS[i]};vertical-align:middle;margin-right:8px;"></span>`;
    const header = `<div class="seat-direction">${colorDot}${PLAYER_LABELS[i]}</div>`;

    if (p.connected && p.isBot) {
      card.classList.add('taken', 'bot-seat');
      card.innerHTML = header + `<div class="mt-1"><i class="bi bi-robot me-1"></i>${botLabel(p.botLevel)}</div>`;
      const rm = document.createElement('button');
      rm.className = 'btn btn-sm btn-outline-danger mt-2';
      rm.innerHTML = `<i class="bi bi-x"></i> ${t('yonin.removeBot', 'Remove')}`;
      rm.addEventListener('click', (e) => { e.stopPropagation(); removeBot(i); });
      card.appendChild(rm);
    } else if (p.connected) {
      card.classList.add('taken');
      const mine = i === game.myPlayer;
      if (mine) card.classList.add('my-seat');
      card.innerHTML = header + `<div class="mt-1 fw-semibold">${escapeHtml(p.name)}${mine ? ' (' + t('yonin.you', 'You') + ')' : ''}</div>`;
      // Let me give up my own seat and go back to spectating.
      if (mine) {
        const leave = document.createElement('button');
        leave.className = 'btn btn-sm btn-outline-secondary mt-2 w-100';
        leave.innerHTML = `<i class="bi bi-box-arrow-left me-1"></i>${t('yonin.leaveSeat', 'Leave seat')}`;
        leave.addEventListener('click', (e) => { e.stopPropagation(); leaveSeat(); });
        card.appendChild(leave);
      }
    } else {
      card.innerHTML = header;
      if (game.myPlayer < 0) {
        // Spectator: take this seat.
        const join = document.createElement('button');
        join.className = 'btn btn-sm btn-outline-warning mt-2 w-100';
        join.textContent = t('yonin.clickToJoin', 'Click to join');
        join.addEventListener('click', () => joinSeat(i));
        card.appendChild(join);
      } else {
        // Already seated: move to this empty seat instead.
        const move = document.createElement('button');
        move.className = 'btn btn-sm btn-outline-warning mt-2 w-100';
        move.innerHTML = `<i class="bi bi-arrow-left-right me-1"></i>${t('yonin.moveHere', 'Move here')}`;
        move.addEventListener('click', () => joinSeat(i));
        card.appendChild(move);
      }
      // ...or fill it with a bot of the chosen strength.
      const botRow = document.createElement('div');
      botRow.className = 'd-flex gap-1 mt-2';
      const sel = document.createElement('select');
      sel.className = 'form-select form-select-sm bg-dark text-light border-secondary';
      [['easy', t('yonin.easy', 'Easy')], ['medium', t('yonin.medium', 'Medium')], ['hard', t('yonin.hard', 'Hard')]]
        .forEach(([v, lbl]) => {
          const o = document.createElement('option');
          o.value = v; o.textContent = lbl;
          o.title = levelDesc(v);            // hover explains what the level does
          if (v === 'medium') o.selected = true;
          sel.appendChild(o);
        });
      sel.title = levelDesc(sel.value);
      sel.addEventListener('change', () => { sel.title = levelDesc(sel.value); });
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-sm btn-outline-info text-nowrap';
      addBtn.innerHTML = `<i class="bi bi-robot me-1"></i>${t('yonin.addBot', 'Add bot')}`;
      addBtn.addEventListener('click', () => addBot(i, sel.value));
      botRow.appendChild(sel);
      botRow.appendChild(addBtn);
      card.appendChild(botRow);
    }
    el.appendChild(card);
  }

  // Start button: shown to the first connected *human* once >= 2 seats are filled
  // (bots count toward the total).
  const startBtn = document.getElementById('ys-start-btn');
  if (startBtn) {
    const filledCount = game.players.filter(p => p.connected).length;
    const firstHuman = game.players.findIndex(p => p.connected && !p.isBot);
    const iAmFirstHuman = firstHuman !== -1 && firstHuman === game.myPlayer;
    startBtn.style.display = (filledCount >= 2 && iAmFirstHuman) ? '' : 'none';
  }
}

// ── Copy room link ────────────────────────────────────────
function copyRoomLink() {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('ys-copy-link');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }
  });
}

// ── Initialization ────────────────────────────────────────
function initLobbyPage() {
  document.getElementById('ys-create-btn')?.addEventListener('click', createRoom);
  document.getElementById('ys-solo-btn')?.addEventListener('click', () => {
    const bots = document.getElementById('ys-bot-count')?.value || '3';
    const level = document.getElementById('ys-bot-level')?.value || 'medium';
    window.location.href = '/solo?bots=' + bots + '&level=' + level;
  });
  // Keep the difficulty tooltip in sync with the selected option.
  const lvl = document.getElementById('ys-bot-level');
  if (lvl) {
    const sync = () => { lvl.title = lvl.options[lvl.selectedIndex]?.title || ''; };
    lvl.addEventListener('change', sync);
    sync();
  }
}

// One-line description of each bot difficulty (used for hover tooltips).
function levelDesc(level) {
  const k = 'yonin.' + level + 'Desc';
  const fallback = {
    easy: 'Plays fast and makes random mistakes; may hang pieces.',
    medium: 'Captures freely and avoids obvious blunders (1-move lookahead).',
    hard: 'Weighs every move, seeks checks/mates and avoids hanging pieces.',
  };
  return (window.i18n && window.i18n[k]) || fallback[level] || '';
}

function initSoloGame(numBots, level) {
  const botLevel = BOT_LEVELS[level] ? level : 'medium';
  const totalPlayers = Math.max(2, Math.min(4, (parseInt(numBots) || 3) + 1));
  game.local = true;
  game.roomId = null;
  game.board = createInitialBoard();
  game.players = createInitialPlayers();
  game.myPlayer = 0;
  game.botSeats = [];
  game.moveHistory = [];
  game.lastMove = null;
  game.winner = null;

  for (let i = 0; i < 4; i++) {
    if (i < totalPlayers) {
      game.players[i].connected = true;
      game.players[i].alive = true;
      if (i === 0) {
        game.players[i].name = window.i18n?.['yonin.you'] || 'You';
      } else {
        game.players[i].name = (window.i18n?.['yonin.bot'] || 'Bot') + ' ' + i;
        game.players[i].botLevel = botLevel;
        game.botSeats.push(i);
      }
    } else {
      // Unused seats: their armies remain as inert obstacles (same as multiplayer < 4).
      game.players[i].connected = false;
      game.players[i].alive = false;
    }
  }

  game.status = 'playing';
  game.currentPlayer = 0;
  setupCpToggle();
  clearSelection();
  renderAll();
  scheduleBotMove(); // in case seat 0 were ever a bot; harmless otherwise
}

// Wire the "show bot eval (CP)" checkbox and restore its saved state.
function setupCpToggle() {
  const box = document.getElementById('ys-cp-toggle');
  if (!box) return;
  game.showCp = localStorage.getItem('ys_show_cp') === '1';
  box.checked = game.showCp;
  box.addEventListener('change', () => {
    game.showCp = box.checked;
    localStorage.setItem('ys_show_cp', box.checked ? '1' : '0');
    renderMoveLog();
  });
}

function initGamePage(roomId) {
  game.roomId = roomId;
  game.board = createInitialBoard();
  game.players = createInitialPlayers();

  // Restore seat from localStorage
  const savedSeat = localStorage.getItem('ys_seat_' + roomId);
  if (savedSeat !== null) {
    game.myPlayer = parseInt(savedSeat);
  }
  // Orient the board so my own seat is at the bottom.
  orientToSeat(game.myPlayer);

  // Prefill the nickname field with the last name used in this room.
  const savedName = localStorage.getItem('ys_name_' + roomId);
  const nameInput = document.getElementById('ys-player-name');
  if (nameInput && savedName) nameInput.value = savedName;

  document.getElementById('ys-copy-link')?.addEventListener('click', copyRoomLink);
  document.getElementById('ys-start-btn')?.addEventListener('click', startGame);
  setupCpToggle();

  // Start polling
  pollState();
  game.pollTimer = setInterval(pollState, 1500);

  renderAll();
}

// Expose for HTML
window.YoninShogi = {
  initLobbyPage, initGamePage, initSoloGame, createRoom, rotateBoard,
  // Test seam — pure internals exposed for unit tests; no effect on the app.
  _test: { chooseBotMove, iAmBotRunner, setState: (patch) => Object.assign(game, patch) },
};
