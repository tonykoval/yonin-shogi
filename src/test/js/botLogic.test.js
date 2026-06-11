/*
 * Unit tests for host-authoritative online bots and bot difficulty.
 *
 *  - iAmBotRunner(): exactly one client (the connected human with the lowest
 *    seat index) drives the bot seats.
 *  - chooseBotMove(seat, level): returns a legal move for every difficulty on the
 *    opening position, exercising the real move generator + heuristic.
 *
 * Run:  node src/test/js/botLogic.test.js   (Node built-ins only)
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.resolve(__dirname, '../../main/resources/js/yonin-shogi.js');

// Permissive DOM stub so initSoloGame()'s render pass doesn't crash.
function el() {
  const e = {
    dataset: {}, style: {}, children: [], value: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, removeChild() {}, setAttribute() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
  Object.defineProperty(e, 'innerHTML', { set() {}, get() { return ''; } });
  Object.defineProperty(e, 'textContent', { set() {}, get() { return ''; } });
  return e;
}
const sandbox = {
  console,
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  fetch: async () => ({ json: async () => ({}) }),
  localStorage: { _s: {}, getItem(k) { return k in this._s ? this._s[k] : null; }, setItem(k, v) { this._s[k] = String(v); } },
  document: { getElementById: () => el(), createElement: () => el(), querySelector: () => null, querySelectorAll: () => [] },
  navigator: { clipboard: { writeText: async () => {} } },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });
sandbox.renderAll = () => {}; // silence the DOM render path

const { chooseBotMove, iAmBotRunner, setState } = sandbox.window.YoninShogi._test;

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  PASS  ' + name); }
  catch (e) { failures++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

function seats(spec) {
  // spec: array of 'human' | 'bot' | 'empty'
  return spec.map((kind, i) => ({
    id: i,
    connected: kind !== 'empty',
    isBot: kind === 'bot',
    alive: true,
    name: kind,
    hand: { 0: 0, 1: 0, 2: 0, 3: 0 },
  }));
}

console.log('iAmBotRunner (lowest-index connected human drives bots):');

check('the only human is the runner', () => {
  setState({ myPlayer: 0, players: seats(['human', 'bot', 'bot', 'bot']) });
  assert.strictEqual(iAmBotRunner(), true);
});

check('lowest-index human is the runner, higher human is not', () => {
  const players = seats(['bot', 'human', 'bot', 'human']);
  setState({ myPlayer: 1, players });
  assert.strictEqual(iAmBotRunner(), true, 'seat 1 (first human) should run bots');
  setState({ myPlayer: 3, players });
  assert.strictEqual(iAmBotRunner(), false, 'seat 3 (second human) should not run bots');
});

check('a spectator (no seat) is never the runner', () => {
  setState({ myPlayer: -1, players: seats(['human', 'bot', 'bot', 'bot']) });
  assert.strictEqual(iAmBotRunner(), false);
});

check('with no humans there is no runner', () => {
  setState({ myPlayer: 0, players: seats(['bot', 'bot', 'bot', 'bot']) });
  assert.strictEqual(iAmBotRunner(), false);
});

console.log('chooseBotMove returns a legal move at every difficulty:');

for (const level of ['easy', 'medium', 'hard']) {
  check(`level=${level} produces a valid move from the opening`, () => {
    // initSoloGame builds the real opening board + players (renderAll is stubbed).
    sandbox.window.YoninShogi.initSoloGame(3, level);
    const move = chooseBotMove(1, level); // seat 1 is a bot in solo mode
    assert.ok(move, 'expected a move, got ' + move);
    assert.ok(move.type === 'move' || move.type === 'drop', 'unexpected move type: ' + move.type);
    assert.strictEqual(move.player, 1, 'move should belong to the asked seat');
    if (move.type === 'move') {
      assert.ok(Array.isArray(move.from) && Array.isArray(move.to), 'move needs from/to');
    } else {
      assert.ok(Array.isArray(move.to), 'drop needs a target');
    }
  });
}

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
