// Connect Four — pure game engine (no DOM).
// Board layout: `board[row][col]`, row 0 = top, row ROWS-1 = bottom.
// Cell values: EMPTY (0), player 1, player 2. Gravity pulls discs to the bottom.
// Everything here is a pure function so the same code powers the UI and the tests.

export const COLS = 7;
export const ROWS = 6;
export const EMPTY = 0;
export const P1 = 1;
export const P2 = 2;

/** Create an empty ROWS x COLS board. */
export function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
}

/** Deep-copy a board (fast enough for our small grid). */
export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

/** The opposing player. */
export function other(player) {
  return player === P1 ? P2 : P1;
}

/** Is the top cell of `col` already occupied? */
export function isColumnFull(board, col) {
  return board[0][col] !== EMPTY;
}

/** Columns that can still accept a disc, left-to-right. */
export function legalMoves(board) {
  const moves = [];
  for (let c = 0; c < COLS; c++) {
    if (board[0][c] === EMPTY) moves.push(c);
  }
  return moves;
}

/** Every cell filled (used for draw detection). */
export function isFull(board) {
  return board[0].every((v) => v !== EMPTY);
}

/**
 * Drop a disc for `player` into `col`. Mutates `board`.
 * @returns {{row:number, col:number}|null} landing cell, or null if the column is full / invalid.
 */
export function dropDisc(board, col, player) {
  if (col < 0 || col >= COLS) return null;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === EMPTY) {
      board[r][col] = player;
      return { row: r, col };
    }
  }
  return null;
}

function inBounds(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

// Direction pairs: horizontal, vertical, diagonal "\", diagonal "/".
const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

// Given a same-colour run of cells along a line, return the window of exactly 4
// consecutive cells that contains the just-placed cell (nicest for highlighting).
function windowOfFour(cells, row, col) {
  const idx = cells.findIndex(([r, c]) => r === row && c === col);
  for (let s = 0; s + 4 <= cells.length; s++) {
    if (idx >= s && idx <= s + 3) return cells.slice(s, s + 4);
  }
  return cells.slice(0, 4);
}

/**
 * Check whether the disc just placed at (row, col) completes four-in-a-row.
 * @returns {Array<[number,number]>|null} the 4 winning cells, or null.
 */
export function checkWin(board, row, col) {
  const player = board[row][col];
  if (player === EMPTY) return null;

  for (const [dr, dc] of DIRECTIONS) {
    const cells = [[row, col]];
    // extend one way
    let r = row + dr;
    let c = col + dc;
    while (inBounds(r, c) && board[r][c] === player) {
      cells.push([r, c]);
      r += dr;
      c += dc;
    }
    // extend the other way
    r = row - dr;
    c = col - dc;
    while (inBounds(r, c) && board[r][c] === player) {
      cells.unshift([r, c]);
      r -= dr;
      c -= dc;
    }
    if (cells.length >= 4) return windowOfFour(cells, row, col);
  }
  return null;
}

/**
 * Convenience: scan the whole board for any winning line (used by tests / analysis).
 * @returns {{player:number, cells:Array<[number,number]>}|null}
 */
export function findAnyWin(board) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] === EMPTY) continue;
      const win = checkWin(board, r, c);
      if (win) return { player: board[r][c], cells: win };
    }
  }
  return null;
}
