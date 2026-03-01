const boardSize = 19;
const boardCanvas = document.getElementById("board");
const analyzeBtn = document.getElementById("analyzeBtn");
const exportSgfBtn = document.getElementById("exportSgfBtn");
const importSgfBtn = document.getElementById("importSgfBtn");
const sgfInput = document.getElementById("sgfInput");
const toStartBtn = document.getElementById("toStartBtn");
const back5Btn = document.getElementById("back5Btn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const forward5Btn = document.getElementById("forward5Btn");
const toEndBtn = document.getElementById("toEndBtn");
const passBtn = document.getElementById("passBtn");
const undoBtn = document.getElementById("undoBtn");
const resetBtn = document.getElementById("resetBtn");
const moveLabelModeSelect = document.getElementById("moveLabelMode");
const visitsInput = document.getElementById("visitsInput");
const topNInput = document.getElementById("topNInput");
const boardOverlayModeSelect = document.getElementById("boardOverlayMode");
const listScopeModeSelect = document.getElementById("listScopeMode");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const movesList = document.getElementById("movesList");
const heatLegendEl = document.getElementById("heatLegend");
const heatLegendHintEl = document.getElementById("heatLegendHint");
const heatLegendMinEl = document.getElementById("heatLegendMin");
const heatLegendMidEl = document.getElementById("heatLegendMid");
const heatLegendMaxEl = document.getElementById("heatLegendMax");

const ctx = boardCanvas.getContext("2d");
const defaultRules = "chinese";
const defaultKomi = 7.5;
const defaultTopVariations = 10;
const defaultVariationLength = 10;
const maxDrawnSuggestions = 10;
const heatmapPalette = [
  { t: 0.0, rgb: [122, 0, 24] },
  { t: 0.22, rgb: [231, 76, 60] },
  { t: 0.5, rgb: [244, 208, 63] },
  { t: 0.72, rgb: [127, 211, 78] },
  { t: 1.0, rgb: [14, 143, 122] },
];

const state = {
  board: createBoard(boardSize),
  moveNumberBoard: createBoard(boardSize),
  recordMoves: [],
  moves: [],
  nextPlayer: "B",
  suggestions: [],
  allCandidates: [],
  candidateCount: 0,
  lastRootInfo: {},
  captures: { B: 0, W: 0 },
  koPoint: null,
  lastMovePoint: null,
  lastMoveNumber: null,
  lastMoveIsPass: false,
  consecutivePasses: 0,
  snapshots: [],
  heatmapStats: null,
};
let analyzeRequestSeq = 0;
const apiBase = (window.GEJUBOT_API_BASE || "").trim().replace(/\/+$/, "");

function apiUrl(path) {
  return apiBase ? `${apiBase}${path}` : path;
}

async function postAnalyze(payload) {
  const resp = await fetch(apiUrl("/api/analyze"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: backend returned non-JSON response`);
    }
    throw new Error("backend returned invalid JSON");
  }
  if (!resp.ok) {
    throw new Error((data && data.error) || `HTTP ${resp.status}`);
  }
  return data;
}

function createBoard(size) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function clonePoint(p) {
  return p ? { x: p.x, y: p.y } : null;
}

function pointKey(x, y) {
  return `${x},${y}`;
}

function isOnBoard(x, y) {
  return x >= 0 && x < boardSize && y >= 0 && y < boardSize;
}

function getNeighbors(x, y) {
  return [
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y - 1 },
    { x, y: y + 1 },
  ].filter((p) => isOnBoard(p.x, p.y));
}

function opponent(player) {
  return player === "B" ? "W" : "B";
}

function gtpColToIndex(letter) {
  const c = letter.toUpperCase();
  if (c < "A" || c > "T" || c === "I") {
    return -1;
  }
  const code = c.charCodeAt(0);
  if (code <= "H".charCodeAt(0)) {
    return code - "A".charCodeAt(0);
  }
  return code - "A".charCodeAt(0) - 1;
}

function indexToGtpCol(index) {
  const code = index <= 7 ? "A".charCodeAt(0) + index : "A".charCodeAt(0) + index + 1;
  return String.fromCharCode(code);
}

function pointToGtp(x, y) {
  const col = indexToGtpCol(x);
  const row = boardSize - y;
  return `${col}${row}`;
}

function gtpToPoint(move) {
  const text = move.toUpperCase();
  if (text === "PASS") {
    return null;
  }
  const col = gtpColToIndex(text[0]);
  const row = Number(text.slice(1));
  if (col < 0 || Number.isNaN(row)) {
    return null;
  }
  const y = boardSize - row;
  if (y < 0 || y >= boardSize) {
    return null;
  }
  return { x: col, y };
}

function sgfCoordToPoint(coord) {
  if (coord === "") {
    return null;
  }
  const c = coord.toLowerCase();
  if (!/^[a-z]{2}$/.test(c)) {
    return null;
  }
  const x = c.charCodeAt(0) - "a".charCodeAt(0);
  const y = c.charCodeAt(1) - "a".charCodeAt(0);
  if (!isOnBoard(x, y)) {
    return null;
  }
  return { x, y };
}

function gtpToSgfCoord(move) {
  const p = gtpToPoint(move);
  if (!p) {
    return "";
  }
  return String.fromCharCode("a".charCodeAt(0) + p.x) + String.fromCharCode("a".charCodeAt(0) + p.y);
}

function sgfToGtp(coord) {
  const c = coord.toLowerCase();
  const p = sgfCoordToPoint(coord);
  if (c === "" || (boardSize <= 19 && c === "tt")) {
    return "pass";
  }
  if (!p) {
    return null;
  }
  return pointToGtp(p.x, p.y);
}

function parseSgfMoves(text) {
  const normalized = text.replace(/^\uFEFF/, "").trim();
  if (!normalized) {
    throw new Error("Empty SGF file.");
  }
  const variationCount = (normalized.match(/\(\s*;/g) || []).length;
  if (variationCount > 1) {
    throw new Error("Only single-variation SGF is supported for now.");
  }
  const sizeMatch = normalized.match(/SZ\[(\d+)\]/i);
  if (sizeMatch && Number(sizeMatch[1]) !== boardSize) {
    throw new Error(`Only SZ[${boardSize}] is supported.`);
  }

  const result = [];
  const moveRegex = /;([BW])\[((?:\\.|[^\]])*)\]/gi;
  let m = null;
  while ((m = moveRegex.exec(normalized)) !== null) {
    const player = m[1].toUpperCase();
    const rawCoord = m[2]
      .replace(/\\\\/g, "\\")
      .replace(/\\\]/g, "]")
      .replace(/\s+/g, "")
      .toLowerCase();
    const gtp = sgfToGtp(rawCoord);
    if (gtp === null) {
      throw new Error(`Invalid SGF coordinate: ${rawCoord || "(empty)"}`);
    }
    result.push([player, gtp]);
  }
  return result;
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function buildSgfText() {
  const dt = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const header =
    `(;GM[1]FF[4]CA[UTF-8]AP[GejuBot:0.1]SZ[${boardSize}]RU[${defaultRules}]KM[${defaultKomi}]DT[${dt}]`;
  const nodes = state.recordMoves.map(([player, move]) => `;${player}[${gtpToSgfCoord(move)}]`).join("");
  return `${header}${nodes})\n`;
}

function downloadSgf() {
  if (!state.recordMoves.length) {
    summaryEl.textContent = "No moves to export.";
    return;
  }
  const sgf = buildSgfText();
  const blob = new Blob([sgf], { type: "application/x-go-sgf; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gejubot_${nowStamp()}.sgf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  summaryEl.textContent = `SGF exported. Moves: ${state.recordMoves.length}`;
}

function importSgfMoves(moves) {
  reset();
  if (!moves.length) {
    summaryEl.textContent = "Imported SGF with 0 moves.";
    return;
  }

  state.nextPlayer = moves[0][0];
  updateStatus();

  for (let i = 0; i < moves.length; i += 1) {
    const [player, move] = moves[i];
    if (player !== state.nextPlayer) {
      reset();
      summaryEl.textContent = `Import failed at move ${i + 1}: turn order mismatch.`;
      return;
    }

    let ok = false;
    if (move === "pass") {
      ok = playPass();
    } else {
      const p = gtpToPoint(move);
      if (!p) {
        reset();
        summaryEl.textContent = `Import failed at move ${i + 1}: invalid coordinate ${move}.`;
        return;
      }
      ok = playMoveAt(p.x, p.y);
    }
    if (!ok) {
      const reason = summaryEl.textContent;
      reset();
      summaryEl.textContent = `Import failed at move ${i + 1}: ${reason}`;
      return;
    }
  }

  clearAnalysis();
  summaryEl.textContent = `Imported SGF successfully. Moves: ${moves.length}`;
}

async function importSgfFile(file) {
  try {
    const text = await file.text();
    const moves = parseSgfMoves(text);
    importSgfMoves(moves);
  } catch (err) {
    summaryEl.textContent = `Import failed: ${err.message}`;
  }
}

function getGroupAndLiberties(board, x, y) {
  const color = board[y][x];
  const queue = [{ x, y }];
  const seen = new Set([pointKey(x, y)]);
  const stones = [];
  const liberties = new Set();

  while (queue.length > 0) {
    const p = queue.pop();
    stones.push(p);
    for (const n of getNeighbors(p.x, p.y)) {
      const v = board[n.y][n.x];
      if (v === null) {
        liberties.add(pointKey(n.x, n.y));
        continue;
      }
      if (v !== color) {
        continue;
      }
      const key = pointKey(n.x, n.y);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      queue.push(n);
    }
  }

  return { stones, liberties };
}

function removeStones(board, stones) {
  for (const p of stones) {
    board[p.y][p.x] = null;
  }
}

function simulateMove(board, x, y, player, koPoint) {
  if (!isOnBoard(x, y)) {
    return { ok: false, error: "Out of board." };
  }
  if (board[y][x] !== null) {
    return { ok: false, error: "Intersection is occupied." };
  }
  if (koPoint && koPoint.x === x && koPoint.y === y) {
    return { ok: false, error: "Illegal ko recapture." };
  }

  const working = cloneBoard(board);
  working[y][x] = player;

  const captured = [];
  const processed = new Set();
  for (const n of getNeighbors(x, y)) {
    if (working[n.y][n.x] !== opponent(player)) {
      continue;
    }
    const key = pointKey(n.x, n.y);
    if (processed.has(key)) {
      continue;
    }
    const group = getGroupAndLiberties(working, n.x, n.y);
    for (const s of group.stones) {
      processed.add(pointKey(s.x, s.y));
    }
    if (group.liberties.size === 0) {
      captured.push(...group.stones);
      removeStones(working, group.stones);
    }
  }

  const ownGroup = getGroupAndLiberties(working, x, y);
  if (ownGroup.liberties.size === 0) {
    return { ok: false, error: "Suicide is not allowed." };
  }

  let nextKoPoint = null;
  if (captured.length === 1 && ownGroup.stones.length === 1 && ownGroup.liberties.size === 1) {
    nextKoPoint = { x: captured[0].x, y: captured[0].y };
  }

  return {
    ok: true,
    board: working,
    captured,
    nextKoPoint,
  };
}

function computeStateFromMoves(moves) {
  let board = createBoard(boardSize);
  let moveNumberBoard = createBoard(boardSize);
  const captures = { B: 0, W: 0 };
  let nextPlayer = moves.length > 0 ? moves[0][0] : "B";
  if (nextPlayer !== "B" && nextPlayer !== "W") {
    nextPlayer = "B";
  }
  let koPoint = null;
  let lastMovePoint = null;
  let lastMoveNumber = null;
  let lastMoveIsPass = false;
  let consecutivePasses = 0;

  for (let i = 0; i < moves.length; i += 1) {
    const [player, move] = moves[i];
    if (player !== nextPlayer) {
      return { ok: false, error: `Turn mismatch at move ${i + 1}.` };
    }

    if (move === "pass") {
      koPoint = null;
      lastMovePoint = null;
      lastMoveNumber = i + 1;
      lastMoveIsPass = true;
      consecutivePasses += 1;
      nextPlayer = opponent(nextPlayer);
      continue;
    }

    const p = gtpToPoint(move);
    if (!p) {
      return { ok: false, error: `Invalid move at ${i + 1}: ${move}` };
    }
    const result = simulateMove(board, p.x, p.y, player, koPoint);
    if (!result.ok) {
      return { ok: false, error: `Illegal move at ${i + 1}: ${result.error}` };
    }

    board = result.board;
    moveNumberBoard[p.y][p.x] = i + 1;
    for (const c of result.captured) {
      moveNumberBoard[c.y][c.x] = null;
    }
    captures[player] += result.captured.length;
    koPoint = result.nextKoPoint;
    lastMovePoint = { x: p.x, y: p.y };
    lastMoveNumber = i + 1;
    lastMoveIsPass = false;
    consecutivePasses = 0;
    nextPlayer = opponent(nextPlayer);
  }

  return {
    ok: true,
    board,
    moveNumberBoard,
    captures,
    nextPlayer,
    koPoint,
    lastMovePoint,
    lastMoveNumber,
    lastMoveIsPass,
    consecutivePasses,
  };
}

function applyDisplayedMoves(displayMoves) {
  const result = computeStateFromMoves(displayMoves);
  if (!result.ok) {
    summaryEl.textContent = result.error;
    return false;
  }

  state.moves = displayMoves.map((m) => [m[0], m[1]]);
  state.board = result.board;
  state.moveNumberBoard = result.moveNumberBoard;
  state.captures = result.captures;
  state.nextPlayer = result.nextPlayer;
  state.koPoint = result.koPoint;
  state.lastMovePoint = result.lastMovePoint;
  state.lastMoveNumber = result.lastMoveNumber;
  state.lastMoveIsPass = result.lastMoveIsPass;
  state.consecutivePasses = result.consecutivePasses;
  return true;
}

function pushSnapshot() {
  state.snapshots.push({
    board: cloneBoard(state.board),
    moveNumberBoard: cloneBoard(state.moveNumberBoard),
    recordMoves: state.recordMoves.map((m) => [m[0], m[1]]),
    moves: state.moves.map((m) => [m[0], m[1]]),
    nextPlayer: state.nextPlayer,
    captures: { B: state.captures.B, W: state.captures.W },
    koPoint: clonePoint(state.koPoint),
    lastMovePoint: clonePoint(state.lastMovePoint),
    lastMoveNumber: state.lastMoveNumber,
    lastMoveIsPass: state.lastMoveIsPass,
    consecutivePasses: state.consecutivePasses,
  });
}

function clearAnalysis() {
  state.suggestions = [];
  state.allCandidates = [];
  state.candidateCount = 0;
  state.lastRootInfo = {};
  state.heatmapStats = null;
  summaryEl.textContent = "No analysis yet.";
  movesList.innerHTML = "";
}

function getBoardOverlayMode() {
  return boardOverlayModeSelect?.value || "off";
}

function getListScopeMode() {
  return listScopeModeSelect?.value || "topN";
}

function shouldUseAllCandidates() {
  return getBoardOverlayMode() === "allHeatmap" || getListScopeMode() === "all";
}

function getRenderedListItems() {
  const listScope = getListScopeMode();
  if (listScope === "all" && state.allCandidates.length) {
    return state.allCandidates;
  }
  return state.suggestions;
}

function countRemainingPoints() {
  let count = 0;
  for (let y = 0; y < boardSize; y += 1) {
    for (let x = 0; x < boardSize; x += 1) {
      if (state.board[y][x] === null) {
        count += 1;
      }
    }
  }
  return count;
}

function syncTopNInputDefault(force = false) {
  if (!topNInput) {
    return;
  }
  const remaining = countRemainingPoints();
  const maxTopN = Math.max(1, remaining);
  topNInput.max = String(maxTopN);

  const autoDefault = Number(topNInput.dataset.autoDefault || "0");
  const raw = topNInput.value.trim();
  const current = Number(raw);
  const isCurrentValid = Number.isFinite(current) && current > 0;
  const shouldAuto =
    force || raw === "" || topNInput.dataset.userSet !== "1" || (isCurrentValid && Math.floor(current) === autoDefault);

  if (shouldAuto) {
    topNInput.value = String(maxTopN);
    topNInput.dataset.autoDefault = String(maxTopN);
    topNInput.dataset.userSet = "0";
    return;
  }

  const clamped = Math.min(maxTopN, Math.max(1, Math.floor(isCurrentValid ? current : maxTopN)));
  topNInput.value = String(clamped);
  topNInput.dataset.autoDefault = String(maxTopN);
}

function updateStatus() {
  syncTopNInputDefault();
  const turn = state.nextPlayer === "B" ? "Black" : "White";
  const ko = state.koPoint ? ` | Ko: ${pointToGtp(state.koPoint.x, state.koPoint.y)}` : "";
  const view = ` | View: ${state.moves.length}/${state.recordMoves.length}`;
  let last = "";
  if (state.moves.length > 0) {
    const m = state.moves[state.moves.length - 1];
    last = ` | Last: ${m[0]}-${m[1]}`;
  }
  statusEl.textContent =
    `Turn: ${turn} | Moves: ${state.moves.length} | Captures B:${state.captures.B} W:${state.captures.W}${view}${last}${ko}`;
}

function boardMetrics() {
  const size = boardCanvas.width;
  const margin = size * 0.06;
  const grid = (size - margin * 2) / (boardSize - 1);
  return { size, margin, grid };
}

function drawBoard() {
  const { size, margin, grid } = boardMetrics();
  ctx.clearRect(0, 0, size, size);

  ctx.fillStyle = "#d6ad67";
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "#2b2b2b";
  ctx.lineWidth = 1;
  for (let i = 0; i < boardSize; i += 1) {
    const p = margin + i * grid;
    ctx.beginPath();
    ctx.moveTo(margin, p);
    ctx.lineTo(size - margin, p);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p, margin);
    ctx.lineTo(p, size - margin);
    ctx.stroke();
  }

  drawStarPoints(margin, grid);
  drawStones(margin, grid);
  if (getBoardOverlayMode() === "allHeatmap") {
    drawAllPointsHeatmap(margin, grid);
  }
  drawMoveAnnotations(margin, grid);
  if (getBoardOverlayMode() !== "allHeatmap") {
    drawSuggestions(margin, grid);
  }
  renderHeatmapLegend();
}

function drawStarPoints(margin, grid) {
  const stars = [3, 9, 15];
  ctx.fillStyle = "#2b2b2b";
  for (const x of stars) {
    for (const y of stars) {
      ctx.beginPath();
      ctx.arc(margin + x * grid, margin + y * grid, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawStones(margin, grid) {
  const radius = grid * 0.43;
  for (let y = 0; y < boardSize; y += 1) {
    for (let x = 0; x < boardSize; x += 1) {
      const color = state.board[y][x];
      if (!color) {
        continue;
      }
      const cx = margin + x * grid;
      const cy = margin + y * grid;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      if (color === "B") {
        ctx.fillStyle = "#1f1f1f";
        ctx.fill();
        ctx.strokeStyle = "#080808";
        ctx.stroke();
      } else {
        ctx.fillStyle = "#f0f0f0";
        ctx.fill();
        ctx.strokeStyle = "#9d9d9d";
        ctx.stroke();
      }
    }
  }
}

function shouldShowMoveNumber(moveNumber, mode) {
  if (typeof moveNumber !== "number") {
    return false;
  }
  if (mode === "all") {
    return true;
  }
  if (mode === "last5") {
    return moveNumber > Math.max(0, state.moves.length - 5);
  }
  if (mode === "current") {
    return moveNumber === state.moves.length;
  }
  return false;
}

function drawLastMoveMarker(margin, grid) {
  if (state.lastMoveIsPass) {
    drawPassBadge(margin, grid);
    return;
  }
  const p = state.lastMovePoint;
  if (!p) {
    return;
  }
  if (!isOnBoard(p.x, p.y)) {
    return;
  }
  if (!state.board[p.y][p.x]) {
    return;
  }
  const cx = margin + p.x * grid;
  const cy = margin + p.y * grid;
  ctx.beginPath();
  ctx.strokeStyle = "#d72626";
  ctx.lineWidth = 2.5;
  ctx.arc(cx, cy, grid * 0.18, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPassBadge(margin, grid) {
  const x = margin + grid * 0.4;
  const y = margin + grid * 0.4;
  const w = grid * 2.25;
  const h = grid * 0.9;
  const r = grid * 0.15;

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();

  ctx.fillStyle = "rgba(215, 38, 38, 0.92)";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = `${Math.floor(grid * 0.46)}px Segoe UI`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("PASS", x + w / 2, y + h / 2 + 0.5);
}

function drawMoveAnnotations(margin, grid) {
  const mode = moveLabelModeSelect?.value || "all";
  if (mode === "lastMarker") {
    drawLastMoveMarker(margin, grid);
    return;
  }
  if (mode === "current" && state.lastMoveIsPass) {
    drawPassBadge(margin, grid);
    return;
  }

  ctx.font = `${Math.floor(grid * 0.46)}px Segoe UI`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let y = 0; y < boardSize; y += 1) {
    for (let x = 0; x < boardSize; x += 1) {
      const color = state.board[y][x];
      if (!color) {
        continue;
      }
      const moveNumber = state.moveNumberBoard[y][x];
      if (!shouldShowMoveNumber(moveNumber, mode)) {
        continue;
      }
      const cx = margin + x * grid;
      const cy = margin + y * grid;
      ctx.fillStyle = color === "B" ? "#f6f6f6" : "#1d1d1d";
      ctx.fillText(String(moveNumber), cx, cy + 0.5);
    }
  }
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function getHeatmapSource() {
  return state.allCandidates.length ? state.allCandidates : state.suggestions;
}

function getHeatmapStats(source) {
  let minWinrate = Infinity;
  let maxWinrate = -Infinity;
  source.forEach((item) => {
    if (typeof item?.winrate !== "number") {
      return;
    }
    minWinrate = Math.min(minWinrate, item.winrate);
    maxWinrate = Math.max(maxWinrate, item.winrate);
  });
  if (!Number.isFinite(minWinrate) || !Number.isFinite(maxWinrate)) {
    return { hasData: false, minWinrate: 0, maxWinrate: 1 };
  }
  return { hasData: true, minWinrate, maxWinrate };
}

function heatColorFor(tRaw, alpha = 0.82) {
  const t = clamp01(tRaw);
  let left = heatmapPalette[0];
  let right = heatmapPalette[heatmapPalette.length - 1];
  for (let i = 0; i < heatmapPalette.length - 1; i += 1) {
    const a = heatmapPalette[i];
    const b = heatmapPalette[i + 1];
    if (t >= a.t && t <= b.t) {
      left = a;
      right = b;
      break;
    }
  }
  const local = right.t > left.t ? (t - left.t) / (right.t - left.t) : 0;
  const r = Math.round(lerp(left.rgb[0], right.rgb[0], local));
  const g = Math.round(lerp(left.rgb[1], right.rgb[1], local));
  const b = Math.round(lerp(left.rgb[2], right.rgb[2], local));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawAllPointsHeatmap(margin, grid) {
  const source = getHeatmapSource();
  const candidateByMove = new Map();
  const stats = getHeatmapStats(source);

  source.forEach((item) => {
    const move = typeof item?.move === "string" ? item.move.toUpperCase() : null;
    if (!move || move === "PASS") {
      return;
    }
    candidateByMove.set(move, item);
  });
  state.heatmapStats = stats;

  const radius = grid * 0.14;
  const haloRadius = grid * 0.3;
  for (let y = 0; y < boardSize; y += 1) {
    for (let x = 0; x < boardSize; x += 1) {
      const cx = margin + x * grid;
      const cy = margin + y * grid;
      const stone = state.board[y][x];
      if (stone) {
        ctx.beginPath();
        ctx.fillStyle = "rgba(108, 108, 108, 0.52)";
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      const move = pointToGtp(x, y);
      const candidate = candidateByMove.get(move);
      if (!candidate || typeof candidate.winrate !== "number") {
        ctx.beginPath();
        ctx.fillStyle = "rgba(115, 115, 115, 0.22)";
        ctx.arc(cx, cy, radius * 0.9, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      const winrate = candidate.winrate;
      const normalized =
        stats.hasData && stats.maxWinrate > stats.minWinrate
          ? (winrate - stats.minWinrate) / (stats.maxWinrate - stats.minWinrate)
          : 0.5;
      ctx.beginPath();
      ctx.fillStyle = heatColorFor(normalized, 0.22);
      ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = heatColorFor(normalized, 0.85);
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function renderHeatmapLegend() {
  if (!heatLegendEl) {
    return;
  }
  if (getBoardOverlayMode() !== "allHeatmap") {
    heatLegendEl.hidden = true;
    return;
  }
  heatLegendEl.hidden = false;
  const source = getHeatmapSource();
  const stats = state.heatmapStats || getHeatmapStats(source);
  state.heatmapStats = stats;
  if (!stats.hasData) {
    heatLegendHintEl.textContent = "Run analysis to map color to winrate";
    heatLegendMinEl.textContent = "-";
    heatLegendMidEl.textContent = "-";
    heatLegendMaxEl.textContent = "-";
    return;
  }
  const mid = (stats.minWinrate + stats.maxWinrate) / 2;
  heatLegendHintEl.textContent = "Relative winrate scale for current position";
  heatLegendMinEl.textContent = formatPct(stats.minWinrate);
  heatLegendMidEl.textContent = formatPct(mid);
  heatLegendMaxEl.textContent = formatPct(stats.maxWinrate);
}

function drawSuggestions(margin, grid) {
  if (!state.suggestions.length) {
    return;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  state.suggestions.slice(0, maxDrawnSuggestions).forEach((moveInfo, index) => {
    const p = gtpToPoint(moveInfo.move);
    if (!p) {
      return;
    }
    const cx = margin + p.x * grid;
    const cy = margin + p.y * grid;

    ctx.beginPath();
    ctx.fillStyle = index === 0 ? "rgba(208, 35, 35, 0.9)" : "rgba(10, 95, 56, 0.86)";
    ctx.arc(cx, cy, grid * 0.26, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    const label = String(index + 1);
    ctx.font = `${Math.floor(grid * (label.length > 1 ? 0.42 : 0.5))}px Segoe UI`;
    ctx.fillText(String(index + 1), cx, cy + 0.5);
  });
}

function renderSuggestions(rootInfo = state.lastRootInfo) {
  state.lastRootInfo = rootInfo || {};
  movesList.innerHTML = "";
  const items = getRenderedListItems();
  if (!items.length) {
    summaryEl.textContent = "No candidate move.";
    return;
  }

  const scoreSelf = state.lastRootInfo?.scoreSelfplay ?? null;
  const scoreLead = state.lastRootInfo?.scoreLead ?? null;
  const winrate = state.lastRootInfo?.winrate ?? null;
  const requestedTopN = Number(topNInput.value || defaultTopVariations);
  const displayCount =
    getListScopeMode() === "topN"
      ? Math.min(state.suggestions.length, requestedTopN > 0 ? requestedTopN : defaultTopVariations)
      : items.length;
  const candidateCount = typeof state.candidateCount === "number" ? state.candidateCount : items.length;
  const listLabel = getListScopeMode() === "all" ? "All" : "Top N";
  summaryEl.textContent =
    `Root winrate: ${formatPct(winrate)} | scoreLead: ${formatNumber(scoreLead)} | scoreSelfplay: ${formatNumber(scoreSelf)} | candidates: ${candidateCount} | showing: ${displayCount} | list: ${listLabel}`;

  items.forEach((m) => {
    const li = document.createElement("li");
    const line1 = document.createElement("div");
    line1.className = "move-line";
    line1.textContent =
      `#${m.rank} ${m.move} | winrate ${formatPct(m.winrate)} | score ${formatNumber(m.scoreLead)} | visits ${m.visits ?? "-"}`;
    const line2 = document.createElement("div");
    line2.className = "pv-line";
    const pvText = Array.isArray(m.pv) && m.pv.length ? m.pv.join(" ") : "-";
    line2.textContent = `PV: ${pvText}`;
    li.appendChild(line1);
    li.appendChild(line2);
    movesList.appendChild(li);
  });
}

function formatPct(v) {
  if (typeof v !== "number") {
    return "-";
  }
  return `${(v * 100).toFixed(1)}%`;
}

function formatNumber(v) {
  if (typeof v !== "number") {
    return "-";
  }
  return v.toFixed(2);
}

function switchTurn() {
  state.nextPlayer = opponent(state.nextPlayer);
}

function pointFromCanvasClick(evt) {
  const rect = boardCanvas.getBoundingClientRect();
  const scaleX = boardCanvas.width / rect.width;
  const scaleY = boardCanvas.height / rect.height;
  const x = (evt.clientX - rect.left) * scaleX;
  const y = (evt.clientY - rect.top) * scaleY;
  const { margin, grid } = boardMetrics();
  const boardX = Math.round((x - margin) / grid);
  const boardY = Math.round((y - margin) / grid);
  if (boardX < 0 || boardX >= boardSize || boardY < 0 || boardY >= boardSize) {
    return null;
  }
  return { x: boardX, y: boardY };
}

function playMoveAt(x, y) {
  const player = state.nextPlayer;
  const result = simulateMove(state.board, x, y, player, state.koPoint);
  if (!result.ok) {
    summaryEl.textContent = result.error;
    return false;
  }

  pushSnapshot();
  if (state.moves.length < state.recordMoves.length) {
    state.recordMoves = state.moves.slice();
  }
  state.recordMoves.push([player, pointToGtp(x, y)]);
  applyDisplayedMoves(state.recordMoves.slice());
  clearAnalysis();
  updateStatus();
  drawBoard();
  return true;
}

function playPass() {
  pushSnapshot();
  if (state.moves.length < state.recordMoves.length) {
    state.recordMoves = state.moves.slice();
  }
  const player = state.nextPlayer;
  state.recordMoves.push([player, "pass"]);
  applyDisplayedMoves(state.recordMoves.slice());
  clearAnalysis();
  if (state.consecutivePasses >= 2) {
    summaryEl.textContent = "Both players passed. Position is ready for scoring review.";
  }
  updateStatus();
  drawBoard();
  return true;
}

function navigateTo(moveIndex) {
  const clamped = Math.max(0, Math.min(moveIndex, state.recordMoves.length));
  const ok = applyDisplayedMoves(state.recordMoves.slice(0, clamped));
  if (!ok) {
    return;
  }
  clearAnalysis();
  updateStatus();
  drawBoard();
}

function getLegalCandidateMoves() {
  const out = [];
  const player = state.nextPlayer;
  for (let y = 0; y < boardSize; y += 1) {
    for (let x = 0; x < boardSize; x += 1) {
      if (state.board[y][x] !== null) {
        continue;
      }
      const test = simulateMove(state.board, x, y, player, state.koPoint);
      if (test.ok) {
        out.push(pointToGtp(x, y));
      }
    }
  }
  return out;
}

async function analyzePosition() {
  const maxVisits = Number(visitsInput.value || 120);
  const remaining = countRemainingPoints();
  const defaultTopN = Math.max(1, remaining);
  const topNValue = Number(topNInput.value || defaultTopN);
  const topN = Number.isFinite(topNValue) && topNValue > 0 ? Math.min(defaultTopN, Math.floor(topNValue)) : defaultTopN;
  const needAllCandidates = shouldUseAllCandidates();
  const quickTopN = Math.max(1, Math.min(topN, 20));
  const shouldRefine = needAllCandidates || topN > quickTopN;
  const requestSeq = ++analyzeRequestSeq;
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Analyzing...";
  summaryEl.textContent = "KataGo is thinking...";
  try {
    const quickData = await postAnalyze({
      moves: state.moves,
      nextPlayer: state.nextPlayer,
      maxVisits: maxVisits > 0 ? Math.floor(maxVisits) : 120,
      topN: quickTopN,
      pvLength: defaultVariationLength,
      returnAllCandidates: false,
      expandCandidates: false,
    });
    if (requestSeq !== analyzeRequestSeq) {
      return;
    }
    state.suggestions = Array.isArray(quickData.topMoves) ? quickData.topMoves : [];
    state.allCandidates = [];
    state.candidateCount =
      typeof quickData.candidateCount === "number" ? quickData.candidateCount : state.suggestions.length;
    state.lastRootInfo = quickData.rootInfo || {};
    renderSuggestions();
    drawBoard();

    if (!shouldRefine) {
      return;
    }

    analyzeBtn.textContent = "Refining...";
    const refinePayload = {
      moves: state.moves,
      nextPlayer: state.nextPlayer,
      candidateMoves: getLegalCandidateMoves(),
      maxVisits: maxVisits > 0 ? Math.floor(maxVisits) : 120,
      topN,
      pvLength: defaultVariationLength,
      returnAllCandidates: needAllCandidates,
      expandCandidates: true,
    };
    const refineData = await postAnalyze(refinePayload);
    if (requestSeq !== analyzeRequestSeq) {
      return;
    }
    state.suggestions = Array.isArray(refineData.topMoves) ? refineData.topMoves : state.suggestions;
    state.allCandidates = Array.isArray(refineData.allCandidates) ? refineData.allCandidates : [];
    state.candidateCount =
      typeof refineData.candidateCount === "number" ? refineData.candidateCount : state.suggestions.length;
    state.lastRootInfo = refineData.rootInfo || state.lastRootInfo;
    renderSuggestions();
    drawBoard();
  } catch (err) {
    if (requestSeq === analyzeRequestSeq) {
      summaryEl.textContent = `Analyze failed: ${err.message}`;
    }
  } finally {
    if (requestSeq === analyzeRequestSeq) {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = "Analyze";
    }
  }
}

function undo() {
  if (!state.snapshots.length) {
    return;
  }
  const prev = state.snapshots.pop();
  state.board = prev.board;
  state.moveNumberBoard = prev.moveNumberBoard ? prev.moveNumberBoard : createBoard(boardSize);
  state.recordMoves = prev.recordMoves ? prev.recordMoves : prev.moves.slice();
  state.moves = prev.moves;
  state.nextPlayer = prev.nextPlayer;
  state.captures = prev.captures;
  state.koPoint = prev.koPoint;
  state.lastMovePoint = prev.lastMovePoint ? prev.lastMovePoint : null;
  state.lastMoveNumber = typeof prev.lastMoveNumber === "number" ? prev.lastMoveNumber : null;
  state.lastMoveIsPass = !!prev.lastMoveIsPass;
  state.consecutivePasses = prev.consecutivePasses;
  clearAnalysis();
  updateStatus();
  drawBoard();
}

function reset() {
  state.board = createBoard(boardSize);
  state.moveNumberBoard = createBoard(boardSize);
  state.recordMoves = [];
  state.moves = [];
  state.nextPlayer = "B";
  state.suggestions = [];
  state.captures = { B: 0, W: 0 };
  state.koPoint = null;
  state.lastMovePoint = null;
  state.lastMoveNumber = null;
  state.lastMoveIsPass = false;
  state.consecutivePasses = 0;
  state.snapshots = [];
  clearAnalysis();
  updateStatus();
  drawBoard();
}

boardCanvas.addEventListener("click", (evt) => {
  const p = pointFromCanvasClick(evt);
  if (!p) {
    return;
  }
  playMoveAt(p.x, p.y);
});

analyzeBtn.addEventListener("click", () => {
  analyzePosition();
});

exportSgfBtn.addEventListener("click", () => {
  downloadSgf();
});

importSgfBtn.addEventListener("click", () => {
  sgfInput.click();
});

sgfInput.addEventListener("change", (evt) => {
  const file = evt.target.files && evt.target.files[0];
  if (!file) {
    return;
  }
  importSgfFile(file);
  sgfInput.value = "";
});

toStartBtn.addEventListener("click", () => {
  navigateTo(0);
});

back5Btn.addEventListener("click", () => {
  navigateTo(state.moves.length - 5);
});

prevBtn.addEventListener("click", () => {
  navigateTo(state.moves.length - 1);
});

nextBtn.addEventListener("click", () => {
  navigateTo(state.moves.length + 1);
});

forward5Btn.addEventListener("click", () => {
  navigateTo(state.moves.length + 5);
});

toEndBtn.addEventListener("click", () => {
  navigateTo(state.recordMoves.length);
});

moveLabelModeSelect.addEventListener("change", () => {
  drawBoard();
});

boardOverlayModeSelect.addEventListener("change", () => {
  drawBoard();
});

listScopeModeSelect.addEventListener("change", () => {
  renderSuggestions();
  drawBoard();
});

topNInput.addEventListener("input", () => {
  const raw = topNInput.value.trim();
  if (raw === "") {
    topNInput.dataset.userSet = "0";
    return;
  }
  topNInput.dataset.userSet = "1";
  const remaining = Math.max(1, countRemainingPoints());
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    topNInput.value = String(remaining);
    return;
  }
  topNInput.value = String(Math.min(remaining, Math.floor(n)));
});

passBtn.addEventListener("click", () => {
  playPass();
});

undoBtn.addEventListener("click", () => {
  undo();
});

resetBtn.addEventListener("click", () => {
  reset();
});

syncTopNInputDefault(true);
updateStatus();
drawBoard();
if (window.location.hostname.endsWith("github.io") && !apiBase) {
  summaryEl.textContent =
    "Static mode on GitHub Pages: board/SGF features work. Set GEJUBOT_API_BASE to enable Analyze.";
}
