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
import { toast, toastSuccess } from "../utils/toast.js";

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
// Dispatcher
// =====================================================================
export function mountGame(type, root, opts) {
  switch (type) {
    case "tictactoe": return mountTicTacToe(root, opts);
    case "connect4":  return mountConnect4(root, opts);
    case "chess":     return mountChessUI(root);
    default:
      root.innerHTML = `<div class="sp-empty"><div class="sp-empty__icon">🎮</div><h4>Game coming soon</h4></div>`;
      return { destroy() {} };
  }
}

if (typeof window !== "undefined") {
  window.NuvvunenuGames = { mountTicTacToe, mountConnect4, mountChessUI, mountGame };
}
