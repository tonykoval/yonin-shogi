'use strict';

/* ═══════════════════════════════════════════════════════════
   Yonin Shogi  –  Interactive rules tutorial
   Reuses the game engine from yonin-shogi.js (movement, check,
   checkmate, elimination) by driving the shared global `game`.
   ═══════════════════════════════════════════════════════════ */

(function () {
  // Engine globals provided by yonin-shogi.js (loaded first on the page).
  if (typeof getValidMoves !== 'function' || typeof game === 'undefined') {
    console.error('[yonin-tutorial] engine (yonin-shogi.js) not loaded');
    return;
  }

  const t = (k) => (window.i18n && window.i18n[k]) || k;
  const ACTOR = 0; // the learner always plays South

  // ── Board builders ──────────────────────────────────────
  function emptyBoard() {
    return Array.from({ length: 9 }, () => Array(9).fill(null));
  }
  function pc(type, owner, promoted) {
    return { type: (promoted && CAN_PROMOTE[type]) ? PROMOTE[type] : type, owner };
  }
  function players(hands) {
    const ps = [0, 1, 2, 3].map(i => ({
      id: i, name: PLAYER_LABELS[i], connected: true, alive: true,
      hand: { 0: 0, 1: 0, 2: 0, 3: 0 }
    }));
    if (hands) for (const k in hands) Object.assign(ps[k].hand, hands[k]);
    return ps;
  }
  const eq = (a, r, c) => a[0] === r && a[1] === c;

  // ── Tutorial steps ──────────────────────────────────────
  // Each step: { info?, titleKey, bodyKey, hintKey, cue?, build(), goal(move) }
  const STEPS = [
    {
      info: true,
      titleKey: 'yonin.tut.introTitle', bodyKey: 'yonin.tut.introBody',
      build: () => ({ board: createInitialBoard(), players: players() })
    },
    {
      titleKey: 'yonin.tut.moveTitle', bodyKey: 'yonin.tut.moveBody', hintKey: 'yonin.tut.moveHint',
      cue: [7, 1],
      build: () => {
        const b = emptyBoard();
        b[8][4] = pc(P.KING, 0);
        b[7][1] = pc(P.ROOK, 0);
        b[0][4] = pc(P.KING, 2);
        return { board: b, players: players() };
      },
      goal: (m) => m.type === 'move' && m.from[0] === 7 && m.from[1] === 1
    },
    {
      titleKey: 'yonin.tut.captureTitle', bodyKey: 'yonin.tut.captureBody', hintKey: 'yonin.tut.captureHint',
      cue: [4, 4],
      build: () => {
        const b = emptyBoard();
        b[8][4] = pc(P.KING, 0);
        b[5][4] = pc(P.GOLD, 0);
        b[4][4] = pc(P.PAWN, 2);
        b[0][4] = pc(P.KING, 2);
        return { board: b, players: players() };
      },
      goal: (m) => m.type === 'move' && eq(m.to, 4, 4)
    },
    {
      titleKey: 'yonin.tut.dropTitle', bodyKey: 'yonin.tut.dropBody', hintKey: 'yonin.tut.dropHint',
      build: () => {
        const b = emptyBoard();
        b[8][4] = pc(P.KING, 0);
        b[6][2] = pc(P.SILVER, 0);
        b[0][4] = pc(P.KING, 2);
        return { board: b, players: players({ 0: { 0: 1 } }) }; // a Pawn in South's hand
      },
      goal: (m) => m.type === 'drop' && m.pieceType === P.PAWN
    },
    {
      titleKey: 'yonin.tut.promoteTitle', bodyKey: 'yonin.tut.promoteBody', hintKey: 'yonin.tut.promoteHint',
      cue: [2, 4],
      build: () => {
        const b = emptyBoard();
        b[8][4] = pc(P.KING, 0);
        b[3][4] = pc(P.PAWN, 0);
        b[0][8] = pc(P.KING, 2);
        return { board: b, players: players() };
      },
      goal: (m) => m.type === 'move' && m.promote === true
    },
    {
      titleKey: 'yonin.tut.checkTitle', bodyKey: 'yonin.tut.checkBody', hintKey: 'yonin.tut.checkHint',
      cue: [2, 4],
      build: () => {
        const b = emptyBoard();
        b[8][4] = pc(P.KING, 0);
        b[3][4] = pc(P.GOLD, 0);
        b[1][4] = pc(P.KING, 2);
        return { board: b, players: players() };
      },
      goal: () => isInCheck(game.board, 2)
    },
    {
      titleKey: 'yonin.tut.mateTitle', bodyKey: 'yonin.tut.mateBody', hintKey: 'yonin.tut.mateHint',
      cue: [1, 4],
      build: () => {
        const b = emptyBoard();
        b[8][4] = pc(P.KING, 0);
        b[1][8] = pc(P.ROOK, 0);  // defends the drop square along rank 1
        b[0][4] = pc(P.KING, 2);
        b[2][0] = pc(P.SILVER, 2); // transfers to you on elimination
        return { board: b, players: players({ 0: { 2: 1 } }) }; // a Gold in South's hand
      },
      // The mating drop eliminates North; check that they were knocked out.
      goal: () => game.players[2] && game.players[2].alive === false
    },
    {
      info: true, finish: true,
      titleKey: 'yonin.tut.doneTitle', bodyKey: 'yonin.tut.doneBody',
      build: () => ({ board: createInitialBoard(), players: players() })
    }
  ];

  // ── Tutorial state ──────────────────────────────────────
  let stepIdx = 0;
  let sel = null;        // selected board square [r,c]
  let selHand = null;    // selected hand piece type
  let valid = [];        // legal targets for the current selection
  let solved = false;

  function loadStep(i) {
    stepIdx = i; sel = null; selHand = null; valid = []; solved = false;
    const s = STEPS[i];
    const built = s.build();
    game.local = true;
    game.status = 'playing';
    game.board = built.board;
    game.players = built.players;
    game.currentPlayer = ACTOR;
    game.myPlayer = ACTOR;
    game.lastMove = null;
    hideFeedback();
    renderBoard();
    renderHand();
    renderPanel();
  }

  // ── Interaction ─────────────────────────────────────────
  function onCell(r, c) {
    const s = STEPS[stepIdx];
    if (s.info || solved) return;

    // Drop mode
    if (selHand !== null) {
      if (valid.some(v => eq(v, r, c))) { commit({ type: 'drop', player: ACTOR, pieceType: selHand, to: [r, c] }); return; }
      selHand = null; valid = []; renderBoard(); renderHand(); return;
    }

    // Move mode
    if (sel) {
      if (eq(sel, r, c)) { sel = null; valid = []; renderBoard(); return; }
      if (valid.some(v => eq(v, r, c))) { tryMoveTo(sel[0], sel[1], r, c); return; }
    }

    const piece = game.board[r][c];
    if (piece && piece.owner === ACTOR) {
      sel = [r, c]; selHand = null;
      valid = getValidMoves(game.board, r, c, ACTOR);
      renderBoard(); renderHand();
      return;
    }
    sel = null; valid = []; renderBoard();
  }

  function onHand(pt) {
    const s = STEPS[stepIdx];
    if (s.info || solved) return;
    if (game.players[ACTOR].hand[pt] <= 0) return;
    sel = null; selHand = pt;
    valid = getDroppableSquares(game.board, pt, ACTOR);
    renderBoard(); renderHand();
  }

  function tryMoveTo(fr, fc, tr, tc) {
    const piece = game.board[fr][fc];
    const zone = getPromotionZone(dirOf(piece));
    const canPro = CAN_PROMOTE[piece.type] && !isPromoted(piece.type) && (zone(fr, fc) || zone(tr, tc));
    const mustPro = canPro && piece.type === P.PAWN && isDeadZone(dirOf(piece), tr, tc);
    const mk = (promote) => ({ type: 'move', player: ACTOR, from: [fr, fc], to: [tr, tc], promote });
    if (mustPro) commit(mk(true));
    else if (canPro) promoDialog(() => commit(mk(true)), () => commit(mk(false)));
    else commit(mk(false));
  }

  function commit(move) {
    applyMoveToBoard(move); // engine: moves/captures/promotes/drops + handles checkmate & elimination
    sel = null; selHand = null; valid = [];
    const s = STEPS[stepIdx];
    if (s.goal(move)) {
      solved = true;
      renderBoard(); renderHand();
      showFeedback(true, t('yonin.tut.correct'));
      renderPanel();
    } else {
      // Wrong choice — reset the position and nudge with the hint.
      loadStep(stepIdx);
      showFeedback(false, t(s.hintKey));
    }
  }

  // ── Promotion mini-dialog ───────────────────────────────
  function promoDialog(onYes, onNo) {
    const overlay = document.createElement('div');
    overlay.className = 'ys-promo-overlay';
    overlay.innerHTML =
      '<div class="ys-promo-dialog">' +
      '<h5>' + t('yonin.promote') + '</h5>' +
      '<button class="btn btn-success" id="yt-promo-yes">' + t('yonin.yes') + '</button>' +
      '<button class="btn btn-outline-secondary" id="yt-promo-no">' + t('yonin.no') + '</button>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#yt-promo-yes').onclick = () => { overlay.remove(); onYes(); };
    overlay.querySelector('#yt-promo-no').onclick = () => { overlay.remove(); onNo(); };
  }

  // ── Rendering ───────────────────────────────────────────
  function renderBoard() {
    const el = document.getElementById('yt-board');
    if (!el || !game.board) return;
    el.innerHTML = '';
    const s = STEPS[stepIdx];

    const checked = new Set();
    for (let i = 0; i < 4; i++) {
      if (game.players[i].alive && isInCheck(game.board, i)) checked.add(i);
    }

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = document.createElement('div');
        cell.className = 'ys-cell';
        if ((r === 2 || r === 6) && (c === 2 || c === 6)) cell.classList.add('star');

        if (game.lastMove) {
          if (game.lastMove.from && game.lastMove.from[0] === r && game.lastMove.from[1] === c) cell.classList.add('last-move');
          if (game.lastMove.to && game.lastMove.to[0] === r && game.lastMove.to[1] === c) cell.classList.add('last-move');
        }
        if (sel && eq(sel, r, c)) cell.classList.add('selected');
        if (valid.some(v => eq(v, r, c))) {
          cell.classList.add(game.board[r][c] ? 'valid-capture' : 'valid-move');
        }
        // Tutorial cue: pulse the target square while unsolved
        if (!solved && s.cue && eq(s.cue, r, c) && !sel && selHand === null) cell.classList.add('yt-cue');

        const piece = game.board[r][c];
        if (piece) {
          const pe = document.createElement('div');
          pe.className = 'ys-piece player-' + piece.owner + ' facing-' + dirOf(piece);
          if (isPromoted(piece.type)) pe.classList.add('promoted');
          if (piece.dead) pe.classList.add('dead-king');
          pe.textContent = KANJI[piece.type];
          if (piece.type === P.KING && checked.has(piece.owner)) cell.classList.add('in-check');
          cell.appendChild(pe);
        }
        cell.addEventListener('click', () => onCell(r, c));
        el.appendChild(cell);
      }
    }
  }

  function renderHand() {
    const el = document.getElementById('yt-hand');
    if (!el) return;
    el.innerHTML = '';
    const hand = game.players[ACTOR].hand;
    let any = false;
    for (let pt = 0; pt <= 3; pt++) {
      if (hand[pt] <= 0) continue;
      any = true;
      const wrap = document.createElement('div');
      wrap.className = 'ys-hand-piece';
      if (selHand === pt) wrap.classList.add('selected');
      const pe = document.createElement('div');
      pe.className = 'ys-piece player-0 facing-0';
      pe.textContent = KANJI[pt];
      wrap.appendChild(pe);
      if (hand[pt] > 1) {
        const cnt = document.createElement('span');
        cnt.className = 'ys-count';
        cnt.textContent = hand[pt];
        wrap.appendChild(cnt);
      }
      wrap.addEventListener('click', () => onHand(pt));
      el.appendChild(wrap);
    }
    el.style.display = any ? '' : 'none';
  }

  function renderPanel() {
    const s = STEPS[stepIdx];
    setText('yt-step-title', t(s.titleKey));
    setText('yt-step-body', t(s.bodyKey));

    // Step dots
    const dots = document.getElementById('yt-dots');
    if (dots) {
      dots.innerHTML = '';
      for (let i = 0; i < STEPS.length; i++) {
        const d = document.createElement('span');
        d.className = 'yt-dot' + (i === stepIdx ? ' active' : '') + (i < stepIdx ? ' done' : '');
        dots.appendChild(d);
      }
    }

    const next = document.getElementById('yt-next');
    const finish = document.getElementById('yt-finish');
    const canAdvance = s.info || solved;
    if (s.finish) {
      if (next) next.style.display = 'none';
      if (finish) finish.style.display = '';
    } else {
      if (next) { next.style.display = ''; next.disabled = !canAdvance; }
      if (finish) finish.style.display = 'none';
    }
  }

  function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

  function showFeedback(ok, msg) {
    const el = document.getElementById('yt-feedback');
    if (!el) return;
    el.style.display = '';
    el.className = 'yt-feedback mb-3 ' + (ok ? 'yt-ok' : 'yt-bad');
    el.innerHTML = '<i class="bi ' + (ok ? 'bi-check-circle-fill' : 'bi-info-circle-fill') + ' me-2"></i>' + msg;
  }
  function hideFeedback() {
    const el = document.getElementById('yt-feedback');
    if (el) el.style.display = 'none';
  }

  // ── Init ────────────────────────────────────────────────
  function init() {
    document.getElementById('yt-next')?.addEventListener('click', () => {
      if (stepIdx < STEPS.length - 1) loadStep(stepIdx + 1);
    });
    document.getElementById('yt-restart')?.addEventListener('click', () => loadStep(0));
    loadStep(0);
  }

  window.YoninTutorial = { init };
})();
