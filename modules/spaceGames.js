// =====================================================================
// modules/spaceGames.js — Playable local-first couple games.
//
// Each game is self-contained:
//   mountTicTacToe(root, opts)  → { destroy, remoteMove? }
//   mountConnect4(root, opts)   → { destroy, remoteMove? }
//   mountChessUI(root)          → { destroy }
//   mountGame(type, root, opts) → dispatcher
//
// Exposes window.NuvvunenuGames for non-module call sites.
// All UI strings/CSS classes are scoped under .sp-*.
// =====================================================================
import { toast, toastSuccess, toastWarn } from "../utils/toast.js";

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function headerHTML(title) {
  return `
    <div class="sp-game-root__head">
      <h4>${escapeHtml(title)}</h4>
      <span class="sp-turn" data-role="turn">Your turn</span>
      <div class="sp-score" data-role="score">You 0 · 0 Partner</div>
      <button class="sp-game-reset" data-role="reset">Reset</button>
    </div>`;
}
function setScore(root, score) {
  const el = root.querySelector('[data-role="score"]');
  if (el) el.textContent = `You ${score.me} · ${score.them} Partner`;
}
function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// =====================================================================
// 1) TIC TAC TOE
// =====================================================================
export function mountTicTacToe(root, opts = {}) {
  if (!root) return { destroy() {} };
  const symbols = { me: "❌", them: "⭕" };
  let board   = Array(9).fill("");
  let myTurn  = true;
  let over    = false;
  let score   = { me: 0, them: 0 };

  root.innerHTML = `
    <div class="sp-game-root">
      ${headerHTML("❌⭕ Tic Tac Toe")}
      <div class="sp-ttt" role="grid" aria-label="Tic Tac Toe"></div>
    </div>`;

  const grid     = root.querySelector(".sp-ttt");
  const turnEl   = root.querySelector('[data-role="turn"]');
  const resetBtn = root.querySelector('[data-role="reset"]');

  function draw() {
    grid.innerHTML = board.map((v, i) =>
      `<button class="sp-ttt__cell" data-i="${i}" role="gridcell" aria-label="cell ${i+1}">${escapeHtml(v)}</button>`
    ).join("");
  }
  function checkWin() {
    const L = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (const line of L) {
      const [a,b,c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line };
    }
    if (board.every(Boolean)) return { winner: "draw" };
    return null;
  }
  function updateTurn() {
    turnEl.innerHTML = myTurn
      ? `<span class="sp-turn__badge">${symbols.me}</span> Your turn`
      : `<span class="sp-turn__badge">${symbols.them}</span> Partner's turn`;
  }
  function onCell(e) {
    if (over) return;
    const cell = e.target.closest(".sp-ttt__cell");
    if (!cell) return;
    const i = Number(cell.dataset.i);
    if (board[i] || !myTurn) { toast("Wait for your turn"); return; }

    board[i] = symbols.me;
    myTurn = false; draw(); updateTurn();
    const r = checkWin(); if (r) return finish(r);

    opts.onMove?.({ index: i, symbol: symbols.me, board });
    if (opts.partnerMove) return; // remote will respond
    setTimeout(aiMove, 500);
  }
  function aiMove() {
    if (over) return;
    const empty = board.map((v, i) => v ? null : i).filter(i => i !== null);
    if (!empty.length) return;
    const i = empty[Math.floor(Math.random() * empty.length)];
    board[i] = symbols.them;
    myTurn = true; draw(); updateTurn();
    const r = checkWin(); if (r) finish(r);
  }
  function remoteMove(index) {
    if (over || board[index]) return;
    board[index] = symbols.them;
    myTurn = true; draw(); updateTurn();
    const r = checkWin(); if (r) finish(r);
  }
  function finish({ winner, line }) {
    over = true;
    if (line) line.forEach(i => grid.children[i]?.classList.add("is-win"));
    if (winner === symbols.me)        { score.me++;  toastSuccess("You won 🎉"); }
    else if (winner === symbols.them) { score.them++; toast("Partner won"); }
    else                              { toast("It's a draw"); }
    setScore(root, score);
  }
  function reset() {
    board = Array(9).fill(""); myTurn = true; over = false;
    draw(); updateTurn();
  }

  grid.addEventListener("click", onCell);
  resetBtn.addEventListener("click", reset);
  draw(); updateTurn(); setScore(root, score);

  return {
    destroy() {
      grid.removeEventListener("click", onCell);
      resetBtn.removeEventListener("click", reset);
      root.innerHTML = "";
    },
    remoteMove
  };
}

// =====================================================================
// 2) CONNECT 4
// =====================================================================
export function mountConnect4(root, opts = {}) {
  if (!root) return { destroy() {} };
  const ROWS = 6, COLS = 7;
  const EMPTY = 0, ME = 1, THEM = 2;
  let board  = Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
  let myTurn = true;
  let over   = false;
  let score  = { me: 0, them: 0 };

  root.innerHTML = `
    <div class="sp-game-root">
      ${headerHTML("🔴🟡 Connect 4")}
      <div class="sp-c4" role="grid" aria-label="Connect Four"></div>
    </div>`;

  const grid     = root.querySelector(".sp-c4");
  const turnEl   = root.querySelector('[data-role="turn"]');
  const resetBtn = root.querySelector('[data-role="reset"]');

  function draw() {
    grid.innerHTML = board.flatMap((row, r) =>
      row.map((v, c) =>
        `<div class="sp-c4__cell ${v === ME ? "is-red" : v === THEM ? "is-yellow" : ""}"
              data-r="${r}" data-c="${c}" role="gridcell"></div>`)
    ).join("");
  }
  function lowestEmptyRow(col) {
    for (let r = ROWS - 1; r >= 0; r--) if (board[r][col] === EMPTY) return r;
    return -1;
  }
  function checkWin(who) {
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (board[r][c] !== who) continue;
      for (const [dr, dc] of dirs) {
        const coords = [[r, c]];
        for (let k = 1; k < 4; k++) {
          const nr = r + dr * k, nc = c + dc * k;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
          if (board[nr][nc] !== who) break;
          coords.push([nr, nc]);
        }
        if (coords.length === 4) return coords;
      }
    }
    return null;
  }
  function updateTurn() {
    turnEl.innerHTML = myTurn
      ? `<span class="sp-turn__badge">🔴</span> Your turn`
      : `<span class="sp-turn__badge">🟡</span> Partner's turn`;
  }
  function onCell(e) {
    if (over) return;
    const cell = e.target.closest(".sp-c4__cell");
    if (!cell) return;
    if (!myTurn) { toast("Wait for partner"); return; }
    const col = Number(cell.dataset.c);
    const row = lowestEmptyRow(col);
    if (row < 0) { toast("Column full"); return; }
    drop(col, ME);
    opts.onMove?.({ column: col, who: ME });
    if (over) return;
    if (opts.partnerMove) return;
    setTimeout(() => aiMove(), 500);
  }
  function drop(col, who) {
    const row = lowestEmptyRow(col);
    if (row < 0) return false;
    board[row][col] = who;
    myTurn = who === THEM;
    draw(); updateTurn();
    const w = checkWin(who);
    if (w) {
      over = true;
      w.forEach(([r, c]) => {
        const idx = r * COLS + c;
        grid.children[idx]?.classList.add("is-win");
      });
      if (who === ME) { score.me++;   toastSuccess("You won 🎉"); }
      else            { score.them++; toast("Partner won"); }
      setScore(root, score);
      return true;
    }
    if (board.flat().every(v => v !== EMPTY)) { over = true; toast("Draw!"); }
    return true;
  }
  function aiMove() {
    if (over) return;
    const cands = [];
    for (let c = 0; c < COLS; c++) if (lowestEmptyRow(c) >= 0) cands.push(c);
    if (!cands.length) return;
    drop(cands[Math.floor(Math.random() * cands.length)], THEM);
  }
  function remoteMove(col) { if (!over) drop(col, THEM); }
  function reset() {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
    myTurn = true; over = false;
    draw(); updateTurn();
  }

  grid.addEventListener("click", onCell);
  resetBtn.addEventListener("click", reset);
  draw(); updateTurn(); setScore(root, score);

  return {
    destroy() { grid.removeEventListener("click", onCell); resetBtn.removeEventListener("click", reset); root.innerHTML = ""; },
    remoteMove
  };
}

// =====================================================================
// 3) CHESS (UI only — piece movement, no legality engine)
// =====================================================================
export function mountChessUI(root) {
  if (!root) return { destroy() {} };
  const START = [
    "♜","♞","♝","♛","♚","♝","♞","♜",
    "♟","♟","♟","♟","♟","♟","♟","♟",
    "", "", "", "", "", "", "", "",
    "", "", "", "", "", "", "", "",
    "", "", "", "", "", "", "", "",
    "", "", "", "", "", "", "", "",
    "♙","♙","♙","♙","♙","♙","♙","♙",
    "♖","♘","♗","♕","♔","♗","♘","♖"
  ];
  let board    = [...START];
  let selected = -1;

  root.innerHTML = `
    <div class="sp-game-root">
      <div class="sp-game-root__head">
        <h4>♔ Chess (UI preview)</h4>
        <span class="sp-turn">Move pieces freely · engine coming soon</span>
        <button class="sp-game-reset" data-role="reset">Reset</button>
      </div>
      <div class="sp-chess" role="grid" aria-label="Chessboard"></div>
    </div>`;

  const grid     = root.querySelector(".sp-chess");
  const resetBtn = root.querySelector('[data-role="reset"]');

  function draw() {
    grid.innerHTML = board.map((p, i) => {
      const r = Math.floor(i / 8), c = i % 8;
      const light = (r + c) % 2 === 0;
      const sel = i === selected ? " is-sel" : "";
      return `<button class="sp-chess__sq ${light ? "is-light" : "is-dark"}${sel}" data-i="${i}" role="gridcell">${p}</button>`;
    }).join("");
  }
  function onSq(e) {
    const sq = e.target.closest(".sp-chess__sq");
    if (!sq) return;
    const i = Number(sq.dataset.i);
    if (selected < 0) {
      if (!board[i]) return;
      selected = i; draw(); return;
    }
    if (i === selected) { selected = -1; draw(); return; }
    board[i] = board[selected]; board[selected] = "";
    selected = -1; draw();
  }
  function reset() { board = [...START]; selected = -1; draw(); }

  grid.addEventListener("click", onSq);
  resetBtn.addEventListener("click", reset);
  draw();

  return {
    destroy() { grid.removeEventListener("click", onSq); resetBtn.removeEventListener("click", reset); root.innerHTML = ""; }
  };
}

// =====================================================================
// 4) COUPLE TRIVIA — multiple-choice questions, score tracking
// =====================================================================
const TRIVIA_BANK = [
  { q: "What's the average length of a date in early relationships?", choices: ["1 hour", "3 hours", "5 hours", "8 hours"], answer: 1 },
  { q: "Which language has the word 'cwtch' meaning a warm cuddle?", choices: ["Welsh", "Dutch", "Swedish", "Korean"], answer: 0 },
  { q: "What flower symbolises eternal love?", choices: ["Lily", "Rose", "Tulip", "Jasmine"], answer: 1 },
  { q: "Who wrote 'Pride and Prejudice'?", choices: ["Brontë", "Austen", "Eliot", "Woolf"], answer: 1 },
  { q: "What's the name of the Mexican holiday for the dead and remembered?", choices: ["Carnaval", "Día de Muertos", "Cinco de Mayo", "Navidad"], answer: 1 },
  { q: "How long is the average kiss in seconds?", choices: ["3", "12", "30", "60"], answer: 1 },
  { q: "Which planet is associated with love?", choices: ["Mars", "Venus", "Jupiter", "Saturn"], answer: 1 },
  { q: "What gem is given for a 25th anniversary?", choices: ["Gold", "Silver", "Diamond", "Pearl"], answer: 1 },
  { q: "Which fruit do Romeo and Juliet share at the masque?", choices: ["Apple", "Pomegranate", "Fig", "None"], answer: 3 },
  { q: "What does the K in K-drama traditionally stand for?", choices: ["Kingdom", "Korean", "Kindred", "Kept"], answer: 1 },
];

export function mountTrivia(root, opts = {}) {
  if (!root) return { destroy() {} };
  // Pick 8 random questions
  const pool = [...TRIVIA_BANK].sort(() => Math.random() - 0.5).slice(0, 8);
  let idx = 0, score = 0;

  function draw() {
    if (idx >= pool.length) return drawDone();
    const q = pool[idx];
    root.innerHTML = `
      <div class="sp-game-root">
        <div class="sp-game-root__head">
          <h4>🎯 Couple Trivia</h4>
          <span class="sp-turn">Question ${idx + 1} of ${pool.length}</span>
          <div class="sp-score">Score ${score}</div>
        </div>
        <div class="sp-tv-q">${escapeHtml(q.q)}</div>
        <div class="sp-tv-grid">
          ${q.choices.map((c, i) => `<button class="sp-tv-btn" data-i="${i}">${escapeHtml(c)}</button>`).join("")}
        </div>
      </div>`;
    root.querySelectorAll(".sp-tv-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const i = Number(b.dataset.i);
        const correct = i === q.answer;
        b.classList.add(correct ? "is-correct" : "is-wrong");
        if (!correct) {
          const right = root.querySelectorAll(".sp-tv-btn")[q.answer];
          right?.classList.add("is-correct");
        }
        if (correct) { score++; toastSuccess("Correct! 💜"); }
        else toast(`The answer was: ${q.choices[q.answer]}`);
        root.querySelectorAll(".sp-tv-btn").forEach((x) => (x.disabled = true));
        setTimeout(() => { idx++; draw(); }, 900);
      });
    });
  }
  function drawDone() {
    const pct = Math.round((score / pool.length) * 100);
    root.innerHTML = `
      <div class="sp-game-root">
        <div class="sp-game-root__head">
          <h4>🎯 Couple Trivia</h4>
          <span class="sp-turn">Final score</span>
          <button class="sp-game-reset" data-role="reset">Play again</button>
        </div>
        <div class="sp-tv-done">
          <div class="sp-tv-done__score">${score} <small>/ ${pool.length}</small></div>
          <div class="sp-tv-done__pct">${pct}%</div>
          <p>${pct >= 80 ? "Brilliant! 🌟" : pct >= 50 ? "Solid run 💜" : "Try again — you'll know more next time."}</p>
        </div>
      </div>`;
    root.querySelector('[data-role="reset"]').addEventListener("click", () => {
      idx = 0; score = 0;
      // Re-pick questions
      pool.length = 0; pool.push(...[...TRIVIA_BANK].sort(() => Math.random() - 0.5).slice(0, 8));
      draw();
    });
  }
  draw();
  return { destroy() { root.innerHTML = ""; } };
}

// =====================================================================
// 5) WHO KNOWS BETTER — both partners answer; compare guesses
//    Single-device mode for now: you answer 5 prompts, then see them.
// =====================================================================
const WKB_PROMPTS = [
  "My favourite comfort food",
  "My favourite city to visit",
  "My biggest fear",
  "Song that always cheers me up",
  "My ideal lazy Sunday",
  "Show I rewatch the most",
  "My go-to ice-cream flavour",
  "A place I'd love to travel next",
  "My morning drink of choice",
  "What makes me laugh hardest",
];

export function mountWhoKnowsBetter(root, opts = {}) {
  if (!root) return { destroy() {} };
  const prompts = [...WKB_PROMPTS].sort(() => Math.random() - 0.5).slice(0, 5);
  const answers = [];
  let i = 0;

  function draw() {
    if (i >= prompts.length) return drawDone();
    root.innerHTML = `
      <div class="sp-game-root">
        <div class="sp-game-root__head">
          <h4>💞 Who Knows Better</h4>
          <span class="sp-turn">${i + 1} of ${prompts.length}</span>
        </div>
        <div class="sp-wkb-prompt">${escapeHtml(prompts[i])}</div>
        <input class="sp-wkb-input" id="wkbInput" placeholder="Your honest answer…" autocomplete="off" maxlength="80">
        <button class="sp-wkb-next" id="wkbNext">Next →</button>
      </div>`;
    const input = root.querySelector("#wkbInput");
    input.focus();
    const submit = () => {
      const v = input.value.trim();
      if (!v) { toastWarn("Type something"); return; }
      answers.push({ prompt: prompts[i], answer: v });
      i++; draw();
    };
    root.querySelector("#wkbNext").addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  }

  function drawDone() {
    root.innerHTML = `
      <div class="sp-game-root">
        <div class="sp-game-root__head">
          <h4>💞 Who Knows Better</h4>
          <span class="sp-turn">Your answers — share with your partner</span>
          <button class="sp-game-reset" data-role="reset">Restart</button>
        </div>
        <div class="sp-wkb-list">
          ${answers.map((a) => `
            <div class="sp-wkb-row">
              <div class="sp-wkb-q">${escapeHtml(a.prompt)}</div>
              <div class="sp-wkb-a">${escapeHtml(a.answer)}</div>
            </div>
          `).join("")}
        </div>
        <p class="sp-wkb-hint">Pass the device to your partner and let them guess each one. (Coming next: live partner-sync mode.)</p>
      </div>`;
    root.querySelector('[data-role="reset"]').addEventListener("click", () => {
      answers.length = 0; i = 0; draw();
    });
  }

  draw();
  return { destroy() { root.innerHTML = ""; } };
}

// =====================================================================
// 6) MEMORY MATCH — flip-pair cards, timed
// =====================================================================
const MM_FACES = ["💜","🌸","🌙","⭐","🦋","🌺","🍓","✨","🐻","🌷"]; // 10 pairs max
export function mountMemoryMatch(root, opts = {}) {
  if (!root) return { destroy() {} };
  const PAIRS = 8;
  const faces = [...MM_FACES].sort(() => Math.random() - 0.5).slice(0, PAIRS);
  const deck = [...faces, ...faces].sort(() => Math.random() - 0.5);
  const flipped = new Set();   // indices currently face-up
  const matched = new Set();
  let firstIdx = -1, moves = 0, started = 0, lockUntil = 0;
  let ticker = null;

  root.innerHTML = `
    <div class="sp-game-root">
      <div class="sp-game-root__head">
        <h4>🧠 Memory Match</h4>
        <span class="sp-turn" data-role="turn">Find ${PAIRS} pairs</span>
        <div class="sp-score" data-role="score">0 moves · 0:00</div>
        <button class="sp-game-reset" data-role="reset">Reset</button>
      </div>
      <div class="sp-mm" data-role="grid"></div>
    </div>`;
  const grid = root.querySelector('[data-role="grid"]');
  const score = root.querySelector('[data-role="score"]');
  const turn  = root.querySelector('[data-role="turn"]');

  function draw() {
    grid.innerHTML = deck.map((f, i) => {
      const up = flipped.has(i) || matched.has(i);
      return `<button class="sp-mm__card ${up ? "is-up" : ""} ${matched.has(i) ? "is-matched" : ""}" data-i="${i}">
        <span class="sp-mm__face">${escapeHtml(f)}</span>
      </button>`;
    }).join("");
    grid.querySelectorAll(".sp-mm__card").forEach((c) => {
      c.addEventListener("click", () => onClick(Number(c.dataset.i)));
    });
  }

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }
  function paintScore() {
    const elapsed = started ? Date.now() - started : 0;
    score.textContent = `${moves} moves · ${fmtTime(elapsed)}`;
  }

  function onClick(i) {
    if (Date.now() < lockUntil) return;
    if (matched.has(i) || flipped.has(i)) return;
    if (!started) {
      started = Date.now();
      ticker = setInterval(paintScore, 500);
    }
    flipped.add(i); draw();
    if (firstIdx === -1) { firstIdx = i; return; }
    moves++; paintScore();
    if (deck[firstIdx] === deck[i]) {
      matched.add(firstIdx); matched.add(i);
      flipped.clear();
      firstIdx = -1; draw();
      if (matched.size === deck.length) finish();
    } else {
      lockUntil = Date.now() + 700;
      const a = firstIdx, b = i; firstIdx = -1;
      setTimeout(() => { flipped.delete(a); flipped.delete(b); draw(); }, 700);
    }
  }
  function finish() {
    clearInterval(ticker); ticker = null;
    const elapsed = Date.now() - started;
    turn.textContent = `Cleared in ${moves} moves`;
    score.textContent = fmtTime(elapsed);
    toastSuccess(`Cleared in ${fmtTime(elapsed)} 💜`);
  }
  function reset() {
    deck.sort(() => Math.random() - 0.5);
    flipped.clear(); matched.clear();
    firstIdx = -1; moves = 0; started = 0; lockUntil = 0;
    clearInterval(ticker); ticker = null;
    turn.textContent = `Find ${PAIRS} pairs`;
    score.textContent = "0 moves · 0:00";
    draw();
  }
  root.querySelector('[data-role="reset"]').addEventListener("click", reset);
  draw();

  return {
    destroy() {
      clearInterval(ticker); ticker = null;
      root.innerHTML = "";
    }
  };
}

// =====================================================================
// 7) SPEED REACTIONS — tap the highlighted cell as fast as possible
// =====================================================================
export function mountSpeedReactions(root, opts = {}) {
  if (!root) return { destroy() {} };
  const ROUNDS = 8;
  const times = [];
  let activeIdx = -1, startTs = 0, round = 0, between = null;

  root.innerHTML = `
    <div class="sp-game-root">
      <div class="sp-game-root__head">
        <h4>⚡ Speed Reactions</h4>
        <span class="sp-turn" data-role="turn">Tap the pink square as fast as you can!</span>
        <div class="sp-score" data-role="score">Round 0 / ${ROUNDS}</div>
        <button class="sp-game-reset" data-role="reset">Reset</button>
      </div>
      <div class="sp-sr-grid" data-role="grid"></div>
      <div class="sp-sr-result" data-role="result"></div>
    </div>`;
  const grid   = root.querySelector('[data-role="grid"]');
  const score  = root.querySelector('[data-role="score"]');
  const turn   = root.querySelector('[data-role="turn"]');
  const result = root.querySelector('[data-role="result"]');

  function draw() {
    grid.innerHTML = Array.from({ length: 9 }, (_, i) =>
      `<button class="sp-sr-cell ${i === activeIdx ? "is-active" : ""}" data-i="${i}"></button>`
    ).join("");
    grid.querySelectorAll(".sp-sr-cell").forEach((c) =>
      c.addEventListener("click", () => onTap(Number(c.dataset.i)))
    );
  }
  function startRound() {
    if (round >= ROUNDS) return finish();
    round++;
    score.textContent = `Round ${round} / ${ROUNDS}`;
    turn.textContent = "Get ready…";
    activeIdx = -1; draw();
    const wait = 700 + Math.random() * 1800;
    between = setTimeout(() => {
      activeIdx = Math.floor(Math.random() * 9);
      startTs = performance.now();
      turn.textContent = "Tap! ⚡";
      draw();
    }, wait);
  }
  function onTap(i) {
    if (activeIdx === -1) {
      // tapped too early — slight penalty
      turn.textContent = "Too early! Wait for pink.";
      return;
    }
    if (i !== activeIdx) {
      turn.textContent = "Wrong cell — wait for pink to appear.";
      return;
    }
    const elapsed = performance.now() - startTs;
    times.push(elapsed);
    activeIdx = -1;
    turn.textContent = `${Math.round(elapsed)}ms`;
    draw();
    setTimeout(startRound, 500);
  }
  function finish() {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const best = Math.min(...times);
    turn.textContent = "All rounds done!";
    score.textContent = `Best ${Math.round(best)}ms`;
    result.innerHTML = `
      <div class="sp-sr-result__row"><span>Avg</span><strong>${Math.round(avg)}ms</strong></div>
      <div class="sp-sr-result__row"><span>Best</span><strong>${Math.round(best)}ms</strong></div>
      <p class="sp-sr-result__hint">${avg < 350 ? "Lightning hands ⚡" : avg < 500 ? "Sharp reflexes 🌟" : "Smooth and steady — ready for round two."}</p>
    `;
    toastSuccess(`Avg ${Math.round(avg)}ms · Best ${Math.round(best)}ms`);
  }
  function reset() {
    clearTimeout(between); between = null;
    times.length = 0; round = 0; activeIdx = -1; startTs = 0;
    score.textContent = `Round 0 / ${ROUNDS}`;
    turn.textContent = "Tap the pink square as fast as you can!";
    result.innerHTML = "";
    draw();
    setTimeout(startRound, 600);
  }
  root.querySelector('[data-role="reset"]').addEventListener("click", reset);
  draw();
  setTimeout(startRound, 600);

  return {
    destroy() {
      clearTimeout(between); between = null;
      root.innerHTML = "";
    }
  };
}

// =====================================================================
// Dispatcher
// =====================================================================
export function mountGame(type, root, opts) {
  switch (type) {
    case "tictactoe":      return mountTicTacToe(root, opts);
    case "connect4":       return mountConnect4(root, opts);
    case "chess":          return mountChessUI(root);
    case "trivia":         return mountTrivia(root, opts);
    case "whoknowsbetter": return mountWhoKnowsBetter(root, opts);
    case "memorymatch":    return mountMemoryMatch(root, opts);
    case "speedreactions": return mountSpeedReactions(root, opts);
    default:
      root.innerHTML = `<div class="sp-empty"><div class="sp-empty__icon">🎮</div><h4>Game coming soon</h4></div>`;
      return { destroy() {} };
  }
}

if (typeof window !== "undefined") {
  window.NuvvunenuGames = {
    mountTicTacToe, mountConnect4, mountChessUI,
    mountTrivia, mountWhoKnowsBetter, mountMemoryMatch, mountSpeedReactions,
    mountGame
  };
}
