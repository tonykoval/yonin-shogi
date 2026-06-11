/*
 * Regression test for the online "create game" flow.
 *
 * Bug: applyServerState() overwrote game.status / game.players with the incoming
 * server data BEFORE running its change-detection, so the comparisons compared a
 * value against itself and never fired renderAll(). Result: after creating a room
 * the host's screen never updated when a second player joined or when the game
 * started (status waiting -> playing with no moves yet).
 *
 * This test loads the real yonin-shogi.js in a sandbox, replaces renderAll() with
 * a spy, and asserts that a relevant state change triggers a re-render.
 *
 * Run:  node src/test/js/applyServerState.test.js
 * (No npm dependencies — uses only Node built-ins: vm, fs, path, assert.)
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.resolve(__dirname, '../../main/resources/js/yonin-shogi.js');

// ── Minimal browser stubs ─────────────────────────────────
// applyServerState() touches only `game`, playersChanged() and renderAll() in the
// scenarios below — no DOM — but the module needs `window` to exist at load time.
const sandbox = {
  console,
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  fetch: async () => ({ json: async () => ({}) }),
  localStorage: { _s: {}, getItem(k) { return k in this._s ? this._s[k] : null; }, setItem(k, v) { this._s[k] = String(v); } },
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }) },
  navigator: { clipboard: { writeText: async () => {} } },
};
sandbox.window = sandbox;            // code does `window.YoninShogi = ...` and reads window.i18n
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });

// ── Spy on renderAll ──────────────────────────────────────
// Top-level `function renderAll()` is a writable property of the sandbox global,
// and applyServerState() resolves `renderAll` dynamically through that global, so
// reassigning it here intercepts the call.
let renderCount = 0;
sandbox.renderAll = () => { renderCount++; };

assert.strictEqual(typeof sandbox.applyServerState, 'function', 'applyServerState should be loadable from the module');

// ── Helpers ───────────────────────────────────────────────
function players(connectedFlags) {
  return connectedFlags.map((connected, i) => ({
    id: i,
    name: connected ? 'P' + i : '',
    connected,
    alive: true,
    hand: { 0: 0, 1: 0, 2: 0, 3: 0 },
  }));
}
function state(opts) {
  return {
    roomId: 'r',
    status: opts.status || 'waiting',
    currentPlayer: opts.currentPlayer || 0,
    players: opts.players,
    moves: opts.moves || [],
    winner: opts.winner !== undefined ? opts.winner : null,
  };
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  PASS  ' + name);
  } catch (e) {
    failures++;
    console.log('  FAIL  ' + name + '\n        ' + e.message);
  }
}

// ── Tests ─────────────────────────────────────────────────
console.log('applyServerState change-detection:');

check('re-renders when a second player joins (no moves yet)', () => {
  sandbox.applyServerState(state({ players: players([true, false, false, false]) })); // baseline
  renderCount = 0;
  sandbox.applyServerState(state({ players: players([true, true, false, false]) }));  // player 2 joins
  assert.strictEqual(renderCount, 1, `expected renderAll to fire once on join, got ${renderCount}`);
});

check('re-renders when the game starts (waiting -> playing, no moves)', () => {
  const p = players([true, true, false, false]);
  sandbox.applyServerState(state({ status: 'waiting', players: p })); // baseline
  renderCount = 0;
  sandbox.applyServerState(state({ status: 'playing', players: players([true, true, false, false]) }));
  assert.strictEqual(renderCount, 1, `expected renderAll to fire once on start, got ${renderCount}`);
});

check('does NOT re-render when nothing changed', () => {
  const p = players([true, true, false, false]);
  sandbox.applyServerState(state({ status: 'playing', players: p })); // baseline
  renderCount = 0;
  sandbox.applyServerState(state({ status: 'playing', players: players([true, true, false, false]) }));
  assert.strictEqual(renderCount, 0, `expected no extra render when unchanged, got ${renderCount}`);
});

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
