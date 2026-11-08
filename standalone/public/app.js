// Cliente web de Noche Eterna (versión independiente para Render).
// Habla con el servidor por POST /actions { action, args }, igual que la
// versión de Muse. El token de sesión vive en localStorage; TODO el progreso
// (personaje, oro, gemas, inventario) vive en Postgres (Neon), en el servidor.

const TOKEN_KEY = "noche-eterna-token";
const STAT_LABELS = { strength: "Fuerza", defense: "Defensa", agility: "Agilidad", stamina: "Resistencia" };

let token = "";
try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch { /* sin storage */ }
let state = null;
let tab = "guarida";
let authMode = "register";
let faction = "vampiro";
let confirmPack = null;
let confirmReset = false;

const app = document.getElementById("app");
const toastEl = document.getElementById("toast");
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4200);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
async function call(action, args = {}) {
  const res = await fetch("./actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, args }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
async function act(action, args) {
  try {
    const res = await call(action, args);
    if (res.state) state = res.state;
    if (res.message) toast(res.message);
    render();
    return res;
  } catch (e) { toast(`Error: ${e.message}`); }
}
async function refresh() {
  try { state = await call("getState", { sessionToken: token }); }
  catch (e) { app.innerHTML = `<div class="wrap"><p>No se pudo cargar el juego.</p><p class="dim">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reintentar</button></div>`; return; }
  render();
}
function bar(label, value, max, color) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return `<div><div class="bar-row"><span>${label}</span><span style="color:var(--text);font-weight:700">${value}/${max}</span></div><div class="track"><div class="fill" style="width:${pct}%;background:${color}"></div></div></div>`;
}

function render() {
  if (!state) return;
  if (!state.isLoggedIn) return renderAuth();
  if (!state.hasCharacter) return renderCreate();
  return renderGame();
}

function renderAuth() {
  app.innerHTML = `
  <main class="wrap">
    <div class="hero"><img src="./assets/guarida.webp" alt="Valle nocturno con castillo y luna llena" /><div class="shade"></div>
      <div class="title"><h1>NOCHE ETERNA</h1><p class="sub">Vampiros contra Hombres Lobo. Elige bando y caza.</p></div></div>
    <div class="tabs2" role="tablist" aria-label="Entrar o crear cuenta">
      <button role="tab" aria-selected="${authMode === "register"}" data-auth="register">Crear cuenta</button>
      <button role="tab" aria-selected="${authMode === "login"}" data-auth="login">Iniciar sesión</button>
    </div>
    <label for="email">Correo electrónico</label>
    <input id="email" type="email" autocomplete="email" placeholder="tucorreo@ejemplo.com" />
    <label for="password">Contraseña</label>
    <input id="password" type="password" autocomplete="${authMode === "register" ? "new-password" : "current-password"}" placeholder="${authMode === "register" ? "Mínimo 6 caracteres" : "Tu contraseña"}" />
    <button class="btn" id="auth-btn">${authMode === "register" ? "CREAR CUENTA" : "ENTRAR"}</button>
    <p class="note">🛡️ Tu personaje, oro, gemas e inventario se guardan <strong>en el servidor, ligados a tu cuenta</strong> — no en el celular. Si cambias de teléfono, solo inicia sesión y sigues donde ibas.</p>
  </main>`;
  document.querySelectorAll("[data-auth]").forEach((b) => b.addEventListener("click", () => { authMode = b.dataset.auth; render(); }));
  document.getElementById("auth-btn").addEventListener("click", async () => {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const res = await act(authMode === "register" ? "register" : "login", { email, password });
    if (res && res.ok && res.sessionToken) {
      token = res.sessionToken;
      try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ok */ }
      state = res.state;
      render();
    }
  });
}

function renderCreate() {
  app.innerHTML = `
  <main class="wrap">
    <div class="hero"><img src="./assets/guarida.webp" alt="Valle nocturno con castillo y luna llena" /><div class="shade"></div>
      <div class="title"><h1>NOCHE ETERNA</h1><p class="sub">Crea tu personaje</p></div></div>
    <p class="note" style="text-align:left">Cuenta: <strong>${esc(state.user.email)}</strong> · <button class="danger" id="logout">Cerrar sesión</button></p>
    <label for="name">Nombre de tu personaje</label>
    <input id="name" maxlength="24" placeholder="Ej. Drácula Jr., Luna Feroz…" />
    <label>Tu bando</label>
    <div class="factions" role="radiogroup" aria-label="Elige tu bando">
      <button class="faction vamp" data-faction="vampiro" aria-pressed="${faction === "vampiro"}"><img src="./assets/vampiro.webp" alt="Señor vampiro en su cripta" /><div><p style="color:#e5484d">VAMPIROS</p><small>+Agilidad y Fuerza. Señores de la cripta.</small></div></button>
      <button class="faction lobo" data-faction="lobo" aria-pressed="${faction === "lobo"}"><img src="./assets/hombre-lobo.webp" alt="Hombre lobo bajo la luna llena" /><div><p style="color:#7fb3d5">HOMBRES LOBO</p><small>+Resistencia y Defensa. La manada no perdona.</small></div></button>
    </div>
    <button class="btn" id="create-btn">ENTRAR A LA NOCHE</button>
    <p class="note">Empiezas con 250 de oro y 10 gemas de bienvenida. El personaje queda guardado en el servidor bajo tu cuenta.</p>
  </main>`;
  document.querySelectorAll("[data-faction]").forEach((b) => b.addEventListener("click", () => { faction = b.dataset.faction; renderCreate(); document.getElementById("name").value = window.__pendingName || ""; }));
  document.getElementById("name").addEventListener("input", (e) => { window.__pendingName = e.target.value; });
  document.getElementById("logout").addEventListener("click", logout);
  document.getElementById("create-btn").addEventListener("click", () => {
    const name = document.getElementById("name").value.trim();
    if (name.length < 2) return toast("El nombre necesita al menos 2 caracteres.");
    act("createCharacter", { sessionToken: token, name, faction });
  });
}

async function logout() {
  try { await call("logout", { sessionToken: token }); } catch { /* igual se cierra local */ }
  token = "";
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ok */ }
  tab = "guarida";
  toast("Sesión cerrada. Tu progreso sigue guardado en tu cuenta, en el servidor.");
  refresh();
}

function renderGame() {
  const c = state.character;
  const portrait = c.faction === "vampiro" ? "./assets/vampiro.webp" : "./assets/hombre-lobo.webp";
  let main = "";
  if (tab === "guarida") main = viewGuarida(c, portrait);
  else if (tab === "cazar") main = viewCazar();
  else if (tab === "arena") main = viewArena(c);
  else if (tab === "tienda") main = viewTienda();
  else if (tab === "gemas") main = viewGemas(c);
  app.innerHTML = `
  <header class="bar"><div class="bar-in">
    <img src="${portrait}" alt="" />
    <div class="grow"><p><strong>${esc(c.name)}</strong> <span class="dim small">Nv. ${c.level}</span></p>
    <p class="dim small">${c.faction === "vampiro" ? "🧛 Vampiro" : "🐺 Hombre Lobo"} · Poder ${c.power}</p></div>
    <div><p style="margin:0" class="gold"><strong>🪙 ${c.gold}</strong></p><p style="margin:0" class="gemc"><strong>💎 ${c.gems}</strong></p></div>
  </div>
  <div class="bars">${bar("❤️ Vida", c.hp, c.maxHp, "#c1121f")}${bar("⚡ Energía", c.energy, c.maxEnergy, "#d4a017")}</div></header>
  <main class="wrap">${main}</main>
  <nav class="tabs" aria-label="Secciones del juego"><div class="in">
    ${[["guarida", "🏰", "Guarida"], ["cazar", "🌕", "Cazar"], ["arena", "⚔️", "Arena"], ["tienda", "🛒", "Tienda"], ["gemas", "💎", "Gemas"]].map(([k, i, l]) => `<button data-tab="${k}" aria-current="${tab === k ? "page" : "false"}"><span>${i}</span>${l}</button>`).join("")}
  </div></nav>`;
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; render(); }));
  bindGame();
}

function viewGuarida(c, portrait) {
  const itemByKey = (k) => state.catalog.find((i) => i.key === k);
  return `
  <div class="hero"><img src="${portrait}" alt="" style="height:250px;object-position:center 32%" /><div class="shade"></div>
    <div class="title" style="text-align:left;left:16px"><h2 style="margin:0">${esc(c.name)}</h2><p class="sub" style="text-align:left">Nivel ${c.level} · ${c.xp}/${c.xpNext} XP para el siguiente nivel</p></div></div>
  <div style="margin-top:8px">${bar("Experiencia", c.xp, c.xpNext, "#7fb3d5")}</div>
  <h3>Atributos — entrena con oro</h3>
  <div class="grid2">${["strength", "defense", "agility", "stamina"].map((s) => `
    <div class="card stat" style="margin-top:0"><p class="dim small" style="margin:0">${STAT_LABELS[s]}</p><p class="num" style="margin:0">${c[s]}</p>
    <button data-train="${s}">Entrenar · 🪙${state.trainCosts[s]} · ⚡1</button></div>`).join("")}</div>
  <p class="dim small">Victorias PvP: ${c.wins} · Derrotas: ${c.losses} · Cacerías: ${c.hunts}. La vida se regenera +3/min y la energía +1/min.</p>
  <h3>Trabajo</h3>
  <button class="card" style="width:100%;text-align:left;color:var(--text)" data-work><p style="margin:0"><strong>⚰️ Turno en el cementerio</strong></p><p class="dim small" style="margin:4px 0 0">Cava tumbas toda la noche: ganas oro y 5 XP. Cuesta ⚡2.</p></button>
  <h3>Tu mochila</h3>
  ${state.inventory.length === 0 ? `<p class="dim">Vacía. Pásate por la Tienda a por tu primera arma.</p>` : state.inventory.map((row) => {
    const item = itemByKey(row.itemKey); if (!item) return "";
    return `<div class="card row"><div class="grow"><p style="margin:0"><strong>${esc(item.name)}</strong> ${row.qty > 1 ? `<span class="dim">×${row.qty}</span>` : ""} ${row.equipped ? `<span class="eq">EQUIPADO</span>` : ""}</p><p class="dim small" style="margin:2px 0 0">${esc(item.desc)}</p></div>
    ${item.type === "pocion" ? `<button class="btn small" data-use="${row.id}">Usar</button>` : `<button class="btn small ghost" data-equip="${row.id}">${row.equipped ? "Quitar" : "Equipar"}</button>`}</div>`;
  }).join("")}
  <h3>Tu cuenta 🔐</h3>
  <div class="card"><p style="margin:0">Sesión iniciada como <strong>${esc(state.user.email)}</strong></p>
  <p class="dim" style="font-size:14px">Tu progreso se guarda en el servidor (Neon) bajo esta cuenta. Entra desde otro celular con el mismo correo y contraseña y recuperas tu personaje tal cual.</p>
  <button class="btn small ghost" id="logout2">Cerrar sesión</button></div>
  <h3>Registro de la noche</h3>
  ${state.log.length === 0 ? `<p class="dim">Todavía no pasa nada… sal a cazar.</p>` : state.log.map((l) => `
    <article class="card"><p style="margin:0;font-size:14px"><strong>${esc(l.title)}</strong> ${l.goldDelta !== 0 ? `<span class="${l.goldDelta > 0 ? "gold" : ""}" style="${l.goldDelta < 0 ? "color:#f87171" : ""}">${l.goldDelta > 0 ? "+" + l.goldDelta : l.goldDelta} 🪙</span>` : ""} ${l.xpDelta > 0 ? `<span style="color:var(--moon)">+${l.xpDelta} XP</span>` : ""}</p>
    <p class="dim small" style="margin:2px 0 0">${esc(l.detail)}</p><p class="dim" style="font-size:11px;margin:4px 0 0">${new Date(l.createdAt).toLocaleString("es-MX")}</p></article>`).join("")}
  <div style="margin-top:32px;border-top:1px solid var(--border);padding-top:16px">
    ${confirmReset ? `<div class="card" style="border-color:#7f1d1d"><p style="margin:0;font-size:14px">¿Seguro? Se borra ${esc(c.name)}, su inventario, su oro y sus gemas. Tu cuenta se conserva.</p>
      <button class="btn small" id="reset-yes">Sí, borrar</button> <button class="btn small ghost" id="reset-no">Cancelar</button></div>`
    : `<button class="danger" id="reset-ask">Borrar personaje y empezar de cero</button>`}
  </div>`;
}

function viewCazar() {
  return `<h2>Cacerías</h2><p class="dim" style="font-size:14px">Sal de noche, vence a la presa y vuelve con oro y XP.</p>
  ${state.hunts.map((h) => `<article class="card"><div class="row"><div class="grow"><h3 style="margin:0">${esc(h.name)}</h3><p class="dim" style="font-size:14px;margin:2px 0">${esc(h.desc)}</p>
  <p class="dim small" style="margin:0">Presa: ${esc(h.enemy)} · Botín: 🪙${h.goldMin}–${h.goldMax} · +${h.xp} XP · Poder sugerido ${h.minPower}+</p></div><strong class="gold">⚡${h.energy}</strong></div>
  <button class="btn" data-hunt="${h.key}">Salir a cazar</button></article>`).join("")}`;
}

function viewArena(c) {
  const ranking = [...state.rivals.map((r) => ({ ...r, me: false })), { name: c.name, faction: c.faction, level: c.level, power: c.power, me: true }].sort((a, b) => b.power - a.power || b.level - a.level);
  return `<h2>Arena PvP</h2><p class="dim" style="font-size:14px">Combate por asaltos: tu Agilidad esquiva y tu Defensa aguanta. Cuesta ⚡2.</p>
  ${state.rivals.map((r) => `<article class="card row"><img src="${r.faction === "vampiro" ? "./assets/vampiro.webp" : "./assets/hombre-lobo.webp"}" alt="" style="width:56px;height:56px;border-radius:8px;object-fit:cover;object-position:top" />
  <div class="grow"><p style="margin:0"><strong>${esc(r.name)}</strong></p><p class="dim small" style="margin:0">${r.faction === "vampiro" ? "Vampiro" : "Hombre Lobo"} · Nv. ${r.level} · Poder ${r.power}</p></div>
  <button class="btn small" data-fight="${r.key}">Pelear</button></article>`).join("")}
  <h3>Ranking de la noche</h3>
  <ol class="rank">${ranking.map((r, i) => `<li class="${r.me ? "me" : ""}"><strong class="gold" style="width:28px">${i + 1}.</strong><span class="grow"><strong style="font-size:14px">${esc(r.name)}</strong> ${r.me ? `<span class="gold small">(tú)</span>` : ""}</span><span class="dim small">${r.faction === "vampiro" ? "🧛" : "🐺"} Nv. ${r.level}</span><strong>⚔️ ${r.power}</strong></li>`).join("")}</ol>
  <p class="dim small">Los rivales son personajes del juego (NPC).</p>`;
}

function viewTienda() {
  return `<h2>Tienda nocturna</h2><p class="dim" style="font-size:14px">Lo de oro se gana jugando. Lo de gemas 💎 es premium y se consigue recargando.</p>
  ${[["arma", "⚔️ Armas"], ["armadura", "🛡️ Armaduras"], ["pocion", "🧪 Pociones"]].map(([type, label]) => `
  <h3>${label}</h3>${state.catalog.filter((i) => i.type === type).map((item) => {
    const owned = state.inventory.find((inv) => inv.itemKey === item.key);
    return `<article class="card row"><div class="grow"><p style="margin:0"><strong>${esc(item.name)}</strong> ${item.currency === "gems" ? `<span class="tag">PREMIUM</span>` : ""}</p>
    <p class="dim small" style="margin:2px 0 0">${esc(item.desc)}${owned && item.type === "pocion" ? ` · Tienes ×${owned.qty}` : owned ? " · Ya es tuyo" : ""}</p></div>
    <button class="btn small ${item.currency === "gems" ? "gem" : "gold"}" data-buy="${item.key}" ${owned && item.type !== "pocion" ? "disabled" : ""}>${owned && item.type !== "pocion" ? "Tuyo ✓" : `${item.currency === "gems" ? "💎" : "🪙"} ${item.price}`}</button></article>`;
  }).join("")}`).join("")}`;
}

function viewGemas(c) {
  return `<h2>Recargar gemas 💎</h2><p class="dim" style="font-size:14px">Las gemas compran el equipo premium. <strong style="color:var(--text)">Prototipo:</strong> la recarga es simulada, no se cobra nada. En la versión real este botón abriría Mercado Pago.</p>
  ${state.packs.map((p) => `<article class="card" style="border-color:rgba(168,85,247,.4)"><div class="row"><div class="grow"><p style="margin:0;font-size:18px"><strong>${esc(p.name)}</strong></p><p class="gemc" style="margin:0"><strong>💎 ${p.gems} gemas</strong></p></div><p style="font-size:24px;margin:0"><strong>$${p.priceMxn}</strong> <span class="dim small">MXN</span></p></div>
  ${confirmPack === p.key ? `<div class="card" style="background:rgba(0,0,0,.4)"><p style="margin:0;font-size:14px">Simular pago de $${p.priceMxn} MXN por ${p.gems} gemas (sin cobro real).</p>
    <button class="btn small gem" data-pack-yes="${p.key}">Confirmar recarga</button> <button class="btn small ghost" data-pack-no>Cancelar</button></div>`
  : `<button class="btn gem" data-pack="${p.key}">Recargar (simulado)</button>`}</article>`).join("")}
  <h3>Historial de recargas</h3>
  ${state.recharges.length === 0 ? `<p class="dim">Aún no recargas. Tu saldo actual: 💎 ${c.gems}.</p>` : state.recharges.map((r) => `<div class="card row" style="padding:10px 14px"><span>💎 +${r.gems} gemas</span><span class="dim small">$${r.priceMxn} MXN · ${new Date(r.createdAt).toLocaleString("es-MX")}</span></div>`).join("")}
  <p class="dim small" style="margin-top:20px">Las gemas y objetos son virtuales y se quedan dentro del juego; no se pueden retirar como dinero.</p>`;
}

function bindGame() {
  const on = (sel, ev, fn) => document.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, () => fn(el)));
  on("[data-train]", "click", (el) => act("train", { sessionToken: token, stat: el.dataset.train }));
  on("[data-work]", "click", () => act("workCemetery", { sessionToken: token }));
  on("[data-use]", "click", (el) => act("useItem", { sessionToken: token, inventoryId: Number(el.dataset.use) }));
  on("[data-equip]", "click", (el) => act("equipItem", { sessionToken: token, inventoryId: Number(el.dataset.equip) }));
  on("[data-hunt]", "click", (el) => act("hunt", { sessionToken: token, huntKey: el.dataset.hunt }));
  on("[data-fight]", "click", (el) => act("fightRival", { sessionToken: token, rivalKey: el.dataset.fight }));
  on("[data-buy]", "click", (el) => act("buyItem", { sessionToken: token, itemKey: el.dataset.buy }));
  on("[data-pack]", "click", (el) => { confirmPack = el.dataset.pack; render(); });
  on("[data-pack-no]", "click", () => { confirmPack = null; render(); });
  on("[data-pack-yes]", "click", (el) => { confirmPack = null; act("recharge", { sessionToken: token, packKey: el.dataset.packYes }); });
  const lo = document.getElementById("logout2"); if (lo) lo.addEventListener("click", logout);
  const ra = document.getElementById("reset-ask"); if (ra) ra.addEventListener("click", () => { confirmReset = true; render(); });
  const rn = document.getElementById("reset-no"); if (rn) rn.addEventListener("click", () => { confirmReset = false; render(); });
  const ry = document.getElementById("reset-yes"); if (ry) ry.addEventListener("click", () => { confirmReset = false; act("resetCharacter", { sessionToken: token }); });
}

refresh();
