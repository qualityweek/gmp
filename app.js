// ======= Apps Script API URL (replace with your Web App URL) =======
const API_URL = "https://rough-brook-18f6.brunaramos.workers.dev/"

// ======= API helpers =======
async function apiPost(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("API error " + res.status);
  return res.json();
}

async function hasPlayedRemote(nameNorm) {
  try {
    const j = await apiPost({ action: "check", name: nameNorm });
    return !!(j && j.played);
  } catch (e) {
    console.error("check failed", e);
    return false; // fail-open
  }
}

async function reserveNameRemote(nameNorm, meta = {}) {
  try {
    const j = await apiPost({ action: "reserve", name: nameNorm, meta });
    return !!(j && j.reserved);
  } catch (e) {
    console.error("reserve failed:", e);
    return false;
  }
}

async function completeAttemptRemote(record) {
  try {
    const j = await apiPost({ action: "complete", ...record });
    return !!(j && j.ok);
  } catch (e) {
    console.error("complete failed", e);
    return false;
  }
}

// ======= UI refs =======
const stage = document.getElementById("stage");
const ctx = stage.getContext("2d");
const btnPrev = document.getElementById("btnPrev");
const btnNext = document.getElementById("btnNext");
const btnHint = document.getElementById("btnHint");
const btnReveal = document.getElementById("btnReveal");
const btnReset = document.getElementById("btnReset");
const btnFinish = document.getElementById("btnFinish");
const sceneTitle = document.getElementById("sceneTitle");
const foundCount = document.getElementById("foundCount");
const totalCount = document.getElementById("totalCount");
const foundList = document.getElementById("foundList");
const playerBadge = document.getElementById("playerBadge");

const loginScreen = document.getElementById("loginScreen");
const startGame = document.getElementById("startGame");
const playerNameInput = document.getElementById("playerName");
const btnApiTest = document.getElementById("btnApiTest");
const apiStatus = document.getElementById("apiStatus");

const resultsScreen = document.getElementById("resultsScreen");
const scoreLine = document.getElementById("scoreLine");
const missedWrap = document.getElementById("missedWrap");
const btnReplay = document.getElementById("btnReplay");
const submitStatus = document.getElementById("submitStatus");

// ======= Scenes data =======
const data = { "tolerance": 28, "scenes": [{ "file": "assets/scenes/scene1.png", "title": "Packing Line", "hotspots": [{ "x": 905, "y": 180, "r": 45, "tag": "no_hairnet", "desc": "No hairnet" }, { "x": 835, "y": 470, "r": 26, "tag": "jewelry", "desc": "Jewelry in production" }, { "x": 775, "y": 560, "r": 34, "tag": "open_drink", "desc": "Open drink in production" }, { "x": 235, "y": 440, "r": 55, "tag": "boxes_on_belt", "desc": "Cardboard on belt" }, { "x": 420, "y": 465, "r": 60, "tag": "boxes_on_belt", "desc": "Cardboard on belt" }, { "x": 170, "y": 615, "r": 32, "tag": "knife_left", "desc": "Knife left on line" }] }, { "file": "assets/scenes/scene2.png", "title": "Mixing Area", "hotspots": [{ "x": 160, "y": 210, "r": 60, "tag": "mold_wall", "desc": "Mold on wall" }, { "x": 1040, "y": 520, "r": 60, "tag": "open_bin", "desc": "Open bin" }, { "x": 600, "y": 730, "r": 70, "tag": "floor_spill", "desc": "Wet floor / spill" }, { "x": 535, "y": 570, "r": 24, "tag": "nail_polish", "desc": "Nail polish in production" }] }, { "file": "assets/scenes/scene3.png", "title": "Cooling Racks", "hotspots": [{ "x": 1040, "y": 740, "r": 60, "tag": "tray_on_floor", "desc": "Tray on floor" }, { "x": 240, "y": 735, "r": 80, "tag": "pallet_film", "desc": "Pallet with film in area" }, { "x": 360, "y": 380, "r": 70, "tag": "dirty_rack", "desc": "Dirty/moldy rack" }] }, { "file": "assets/scenes/scene4.png", "title": "Labelling Station", "hotspots": [{ "x": 330, "y": 560, "r": 50, "tag": "ink_leak", "desc": "Ink leaking" }, { "x": 470, "y": 740, "r": 95, "tag": "labels_on_floor", "desc": "Labels on floor" }, { "x": 690, "y": 520, "r": 65, "tag": "unlabeled_wip", "desc": "Unlabeled WIP container" }] }, { "file": "assets/scenes/scene5.png", "title": "Line Start", "hotspots": [{ "x": 160, "y": 560, "r": 35, "tag": "knife_left", "desc": "Knife left on line" }, { "x": 360, "y": 560, "r": 45, "tag": "unprotected_product", "desc": "Unprotected product" }, { "x": 520, "y": 560, "r": 45, "tag": "unprotected_product", "desc": "Unprotected product" }, { "x": 760, "y": 440, "r": 120, "tag": "boxes_wrong_place", "desc": "Boxes behind machine" }] }] }
// ======= State =======
let current = 0;
let found = new Set();
let img = new Image();
let tolerance = data.tolerance ?? 28;
let revealDots = [];
let hintTimer = null;
let DEBUG_MODE = false;
let playerName = null;

// ======= API Self-Test =======
btnApiTest.addEventListener("click", async () => {
  apiStatus.textContent = "Testing API...";
  try {
    const j = await fetch(API_URL).then(r => r.json());
    apiStatus.textContent = j.ok ? "API OK: " + (j.msg || "online") : "API error";
  } catch (e) {
    apiStatus.textContent = "API unreachable. Check your Web App URL and permissions.";
  }
});

// ======= Render =======
function loadScene(i) {
  current = (i + data.scenes.length) % data.scenes.length;
  found.clear();
  clearRevealDots();
  sceneTitle.textContent = `${data.scenes[current].title} (Scene ${current + 1}/${data.scenes.length})`;
  img.onload = () => {
    draw();
    totalCount.textContent = data.scenes[current].hotspots.length;
    updateFoundUI();
  };
  img.src = data.scenes[current].file + "?v=" + Date.now();
}

function draw() {
  ctx.clearRect(0, 0, stage.width, stage.height);
  ctx.drawImage(img, 0, 0, stage.width, stage.height);
}

function updateFoundUI() {
  foundCount.textContent = found.size;
  foundList.innerHTML = "";
  const hs = data.scenes[current].hotspots;
  [...found].forEach(index => {
    const item = hs[index];
    const li = document.createElement("li");
    li.textContent = item.desc;
    foundList.appendChild(li);
  });
}

function distance(x1, y1, x2, y2) { const dx = x1 - x2, dy = y1 - y2; return Math.hypot(dx, dy); }

stage.addEventListener("click", (e) => {
  const rect = stage.getBoundingClientRect();
  const scaleX = stage.width / rect.width;
  const scaleY = stage.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  const hs = data.scenes[current].hotspots;
  let matched = false;
  for (let i = 0; i < hs.length; i++) {
    const h = hs[i];
    if (distance(x, y, h.x, h.y) <= (h.r + tolerance)) {
      if (!found.has(i)) {
        found.add(i);
        spawnRevealDot(h.x, h.y, h.r);
        updateFoundUI();
      }
      matched = true;
      break;
    }
  }
  if (!matched && DEBUG_MODE) { debugMark(x, y); }
});

function canvasClientCoords(x, y) {
  const rect = stage.getBoundingClientRect();
  const cx = rect.left + (x / stage.width) * rect.width;
  const cy = rect.top + (y / stage.height) * rect.height;
  return { cx, cy };
}

function spawnRevealDot(x, y, r) {
  const el = document.createElement("div");
  el.className = "reveal-dot";
  const pos = canvasClientCoords(x, y);
  el.style.left = (pos.cx - r) + "px";
  el.style.top = (pos.cy - r) + "px";
  el.style.width = (r * 2) + "px";
  el.style.height = (r * 2) + "px";
  el.style.position = "absolute";
  document.body.appendChild(el);
  revealDots.push(el);
}

function clearRevealDots() {
  revealDots.forEach(el => el.remove());
  revealDots = [];
}

btnPrev.addEventListener("click", () => loadScene(current - 1));
btnNext.addEventListener("click", () => loadScene(current + 1));
btnReset.addEventListener("click", () => loadScene(current));

btnReveal.addEventListener("click", () => {
  clearRevealDots();
  const hs = data.scenes[current].hotspots;
  hs.forEach(h => spawnRevealDot(h.x, h.y, h.r));
});

btnHint.addEventListener("click", () => {
  const hs = data.scenes[current].hotspots;
  const remaining = hs.map((h, i) => ({ h, i })).filter(o => !found.has(o.i));
  const hintEls = [];
  remaining.forEach(o => {
    const r = o.h.r * 1.8;
    const el = document.createElement("div");
    el.className = "hint-ring";
    const pos = canvasClientCoords(o.h.x, o.h.y);
    el.style.left = (pos.cx - r) + "px";
    el.style.top = (pos.cy - r) + "px";
    el.style.width = (r * 2) + "px";
    el.style.height = (r * 2) + "px";
    el.style.position = "absolute";
    document.body.appendChild(el);
    hintEls.push(el);
  });
  requestAnimationFrame(() => {
    hintEls.forEach(el => el.style.opacity = ".85");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hintEls.forEach(el => el.remove()); }, 1200);
  });
});

// ======= Debug (press D) =======
function debugMark(x, y) {
  const r = 30;
  const snippet = `{ "x": ${Math.round(x)}, "y": ${Math.round(y)}, "r": ${r}, "tag": "tag_here", "desc": "desc here" }`;
  console.clear();
  console.log("Copy to scenes data:", snippet);
  if (navigator.clipboard) navigator.clipboard.writeText(snippet).catch(() => { });
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = "rgba(255,0,110,0.95)";
  ctx.lineWidth = 3;
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === 'd') {
    DEBUG_MODE = !DEBUG_MODE;
    alert("Debug mode: " + (DEBUG_MODE ? "ON (click to copy coords)" : "OFF"));
  }
});

// ======= Login & global name lock via Apps Script =======
startGame.addEventListener("click", async () => {
  const raw = playerNameInput.value.trim();
  if (!raw) { alert("Please enter your name."); return; }
  playerName = raw;
  const nameKey = raw.toLowerCase();

  const already = await hasPlayedRemote(nameKey);
  if (already) {
    alert("This name has already completed the training. If this is you and you need another attempt, contact the administrator.");
    return;
  }

  const reserved = await reserveNameRemote(nameKey, { started: true, displayName: playerName });
  if (!reserved) {
    alert("This name was just used. Please choose another identifier or contact admin.");
    return;
  }

  localStorage.setItem("gmp_player", playerName); // UX only
  playerBadge.textContent = "Player: " + playerName;
  loginScreen.style.display = "none";
});

// ======= Finish & Results (current scene) =======
const resultsForScene = () => {
  const total = data.scenes[current].hotspots.length;
  const foundCountNow = found.size;
  const missed = data.scenes[current].hotspots
    .map((h, i) => ({ i, desc: h.desc }))
    .filter(o => !found.has(o.i));
  return { total, foundCountNow, missed };
};

btnFinish.addEventListener("click", async () => {
  const { total, foundCountNow, missed } = resultsForScene();
  scoreLine.textContent = `Scene ${current + 1}: You found ${foundCountNow} of ${total} issues.`;
  if (missed.length) {
    missedWrap.innerHTML = "<b>Items you missed:</b><ul>" + missed.map(m => `<li>${m.desc}</li>`).join("") + "</ul>";
  } else {
    missedWrap.innerHTML = "<b>Great!</b> You found all issues in this scene.";
  }

  resultsScreen.style.display = "flex";
  submitStatus.textContent = "Submitting result...";
  if (playerName) {
    const ok = await completeAttemptRemote({
      name: playerName.toLowerCase(),
      displayName: playerName,
      scene: current + 1,
      score: foundCountNow,
      total: total,
      missed: missed.map(m => m.desc),
      time: new Date().toISOString()
    });
    submitStatus.textContent = ok ? "Result saved." : "Could not submit result.";
  } else {
    submitStatus.textContent = "Result not submitted (no player name).";
  }
});

btnReplay.addEventListener("click", () => {
  resultsScreen.style.display = "none";
});

// ======= Init =======
const existing = localStorage.getItem("gmp_player");
if (existing) {
  playerBadge.textContent = "Player: " + existing;
}

loadScene(0);
