// Noche Eterna — servidor independiente para Render + Neon.
//
// - Escucha en process.env.PORT (Render lo inyecta) en 0.0.0.0.
// - GET /health responde 200 siempre que el proceso vive; incluye el estado
//   de la base (Neon se despierta solo con la primera consulta).
// - POST /actions { action, args } implementa la misma API del juego que la
//   versión de Muse: cuentas, sesiones, personaje, entrenamiento, cacerías,
//   arena, tienda, inventario y recargas simuladas.
// - Todos los datos viven en Postgres (Neon) vía DATABASE_URL. Usa la cadena
//   POOLED (host con "-pooler"). Sin DATABASE_URL el servidor arranca igual
//   (para que /health pase) pero las acciones devuelven un error claro.
// - Al arrancar crea las tablas si no existen (CREATE TABLE IF NOT EXISTS),
//   así no depende de que el esquema se haya corrido a mano en Neon.

import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL || "";

// ---------- Constantes del juego (mismo diseño que la versión de Muse) ----------

const CATALOG = [
  { key: "colmillo_hueso", name: "Colmillo de hueso", type: "arma", desc: "Un colmillo afilado montado como daga. +3 Fuerza", stat: "strength", bonus: 3, currency: "gold", price: 150 },
  { key: "daga_plata", name: "Daga de plata", type: "arma", desc: "Plata pura: terror de los licántropos. +6 Fuerza", stat: "strength", bonus: 6, currency: "gold", price: 400 },
  { key: "espada_nocturna", name: "Espada nocturna", type: "arma", desc: "Forjada en la cripta mayor. +12 Fuerza", stat: "strength", bonus: 12, currency: "gems", price: 50 },
  { key: "garra_obsidiana", name: "Garra de obsidiana", type: "arma", desc: "Obsidiana volcánica de filo imposible. +20 Fuerza", stat: "strength", bonus: 20, currency: "gems", price: 120 },
  { key: "capa_sombra", name: "Capa de sombra", type: "armadura", desc: "Tejida con niebla de cementerio. +3 Defensa", stat: "defense", bonus: 3, currency: "gold", price: 150 },
  { key: "cota_cuero", name: "Cota de cuero curtido", type: "armadura", desc: "Cuero grueso con remaches de hierro. +6 Defensa", stat: "defense", bonus: 6, currency: "gold", price: 400 },
  { key: "armadura_luna", name: "Armadura de luna llena", type: "armadura", desc: "Placas bañadas en luz de luna. +12 Defensa", stat: "defense", bonus: 12, currency: "gems", price: 50 },
  { key: "pocion_sangre", name: "Poción de sangre", type: "pocion", desc: "Restaura 50 de vida al instante.", stat: "hp", bonus: 50, currency: "gold", price: 30 },
  { key: "pocion_mayor", name: "Poción mayor", type: "pocion", desc: "Restaura toda tu vida.", stat: "hp_full", bonus: 0, currency: "gems", price: 15 },
  { key: "elixir_energia", name: "Elixir de energía", type: "pocion", desc: "Restaura 5 de energía para seguir cazando.", stat: "energy", bonus: 5, currency: "gold", price: 40 },
];

const PACKS = [
  { key: "pack_chico", name: "Puñado de gemas", gems: 100, priceMxn: 20 },
  { key: "pack_mediano", name: "Cofre de gemas", gems: 300, priceMxn: 50 },
  { key: "pack_grande", name: "Tesoro de la cripta", gems: 700, priceMxn: 100 },
];

const RIVALS = [
  { key: "r1", name: "Nyx la Silenciosa", faction: "vampiro", level: 2, strength: 12, defense: 11, agility: 14, stamina: 11 },
  { key: "r2", name: "Garranegra", faction: "lobo", level: 3, strength: 16, defense: 12, agility: 12, stamina: 14 },
  { key: "r3", name: "Conde Miroslav", faction: "vampiro", level: 4, strength: 18, defense: 16, agility: 13, stamina: 16 },
  { key: "r4", name: "Ulf el Desterrado", faction: "lobo", level: 5, strength: 21, defense: 17, agility: 16, stamina: 19 },
  { key: "r5", name: "Serafina Sangrepálida", faction: "vampiro", level: 7, strength: 26, defense: 22, agility: 20, stamina: 22 },
  { key: "r6", name: "Madre Manada", faction: "lobo", level: 9, strength: 31, defense: 26, agility: 23, stamina: 28 },
];

const HUNTS = [
  { key: "aldea", name: "Aldea dormida", desc: "Presas fáciles entre granjas y establos.", energy: 1, minPower: 0, goldMin: 25, goldMax: 55, xp: 12, enemy: "Campesino armado / perro guardián" },
  { key: "cementerio", name: "Cementerio viejo", desc: "Ghouls y saqueadores entre las tumbas.", energy: 2, minPower: 20, goldMin: 55, goldMax: 110, xp: 26, enemy: "Ghoul hambriento" },
  { key: "bosque", name: "Bosque de los ahorcados", desc: "Cazadores rivales patrullan la espesura.", energy: 3, minPower: 45, goldMin: 110, goldMax: 200, xp: 48, enemy: "Cazador de monstruos" },
  { key: "cripta", name: "Cripta ancestral", desc: "Lo que duerme ahí abajo no quiere despertar.", energy: 4, minPower: 80, goldMin: 200, goldMax: 380, xp: 90, enemy: "Guardián ancestral" },
];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), token TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS characters (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), name TEXT NOT NULL, faction TEXT NOT NULL CHECK (faction IN ('vampiro','lobo')), level INTEGER NOT NULL DEFAULT 1, xp INTEGER NOT NULL DEFAULT 0, gold INTEGER NOT NULL DEFAULT 250, gems INTEGER NOT NULL DEFAULT 10, hp INTEGER NOT NULL DEFAULT 100, max_hp INTEGER NOT NULL DEFAULT 100, energy INTEGER NOT NULL DEFAULT 10, max_energy INTEGER NOT NULL DEFAULT 10, strength INTEGER NOT NULL DEFAULT 10, defense INTEGER NOT NULL DEFAULT 10, agility INTEGER NOT NULL DEFAULT 10, stamina INTEGER NOT NULL DEFAULT 10, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, hunts INTEGER NOT NULL DEFAULT 0, last_regen_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS inventory (id SERIAL PRIMARY KEY, character_id INTEGER NOT NULL REFERENCES characters(id), item_key TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1, equipped INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS battle_log (id SERIAL PRIMARY KEY, character_id INTEGER NOT NULL REFERENCES characters(id), kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, result TEXT NOT NULL, gold_delta INTEGER NOT NULL DEFAULT 0, xp_delta INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS recharges (id SERIAL PRIMARY KEY, character_id INTEGER NOT NULL REFERENCES characters(id), pack_key TEXT NOT NULL, gems INTEGER NOT NULL, price_mxn INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_characters_user ON characters (user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_character ON inventory (character_id);
CREATE INDEX IF NOT EXISTS idx_battle_log_character ON battle_log (character_id);
CREATE INDEX IF NOT EXISTS idx_recharges_character ON recharges (character_id);
`;

// ---------- Base de datos (Postgres / Neon) ----------

let pool = null;
let dbError = DATABASE_URL ? null : "Falta la variable DATABASE_URL (cadena pooled de Neon).";

async function initDb() {
  if (!DATABASE_URL) return;
  try {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes("neon.tech") || DATABASE_URL.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });
    await pool.query(SCHEMA_SQL);
    dbError = null;
    console.log("[noche-eterna] Conectado a Postgres (Neon) y esquema verificado.");
  } catch (e) {
    dbError = `Error conectando a Postgres: ${e && e.message ? e.message : String(e)}`;
    console.error("[noche-eterna]", dbError);
  }
}

async function q(sql, params = []) {
  if (!pool) throw new Error(dbError || "Base de datos no disponible.");
  const res = await pool.query(sql, params);
  return res.rows;
}
async function q1(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] ?? null;
}

// ---------- Utilidades del juego ----------

function hashPassword(password) {
  return createHash("sha256").update(`noche-eterna::${password}`).digest("hex");
}
function newToken() {
  return `${randomUUID()}${randomUUID()}`.replace(/-/g, "");
}
const SESSION_MS = 90 * 24 * 60 * 60 * 1000;

function powerOf(c, bonusStr = 0, bonusDef = 0) {
  return c.strength + bonusStr + c.defense + bonusDef + c.agility + c.stamina;
}
function equipBonuses(inv) {
  let str = 0, def = 0;
  for (const row of inv) {
    if (!row.equipped) continue;
    const item = CATALOG.find((i) => i.key === row.item_key);
    if (!item) continue;
    if (item.stat === "strength") str += item.bonus;
    if (item.stat === "defense") def += item.bonus;
  }
  return { str, def };
}
function xpForNext(level) { return level * 100; }

async function createSession(userId) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_MS);
  await q("INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)", [userId, token, expires]);
  return token;
}
async function userFromToken(token) {
  if (!token) return null;
  const session = await q1("SELECT * FROM sessions WHERE token = $1", [token]);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await q("DELETE FROM sessions WHERE id = $1", [session.id]);
    return null;
  }
  return q1("SELECT * FROM users WHERE id = $1", [session.user_id]);
}
async function claimLegacyCharacter(userId) {
  const mine = await q1("SELECT * FROM characters WHERE user_id = $1", [userId]);
  if (mine) return;
  const legacy = await q1("SELECT * FROM characters WHERE user_id IS NULL ORDER BY id LIMIT 1", []);
  if (legacy) await q("UPDATE characters SET user_id = $1 WHERE id = $2", [userId, legacy.id]);
}
async function loadChar(userId) {
  return q1("SELECT * FROM characters WHERE user_id = $1 ORDER BY id LIMIT 1", [userId]);
}
async function applyRegen(c) {
  const now = new Date();
  const minutes = Math.floor((now.getTime() - new Date(c.last_regen_at).getTime()) / 60000);
  if (minutes <= 0) return c;
  const energy = Math.min(c.max_energy, c.energy + minutes);
  const hp = Math.min(c.max_hp, c.hp + minutes * 3);
  await q("UPDATE characters SET energy = $1, hp = $2, last_regen_at = $3 WHERE id = $4", [energy, hp, now, c.id]);
  return { ...c, energy, hp, last_regen_at: now };
}
async function gainXp(c, xpGain) {
  let { xp, level, max_hp, max_energy, hp, energy } = c;
  xp += xpGain;
  let leveled = false;
  while (xp >= xpForNext(level)) {
    xp -= xpForNext(level);
    level += 1;
    max_hp += 10;
    if (level % 3 === 0) max_energy += 1;
    leveled = true;
  }
  if (leveled) { hp = max_hp; energy = max_energy; }
  await q("UPDATE characters SET xp = $1, level = $2, max_hp = $3, max_energy = $4, hp = $5, energy = $6 WHERE id = $7", [xp, level, max_hp, max_energy, hp, energy, c.id]);
  return { xp, level, maxHp: max_hp, maxEnergy: max_energy, hp, energy, leveled };
}
async function log(characterId, kind, title, detail, result, goldDelta, xpDelta) {
  await q("INSERT INTO battle_log (character_id, kind, title, detail, result, gold_delta, xp_delta) VALUES ($1,$2,$3,$4,$5,$6,$7)", [characterId, kind, title, detail, result, goldDelta, xpDelta]);
}

// ---------- Estado (misma forma que devuelve la versión de Muse) ----------

async function buildState(user) {
  const catalog = CATALOG.map((i) => ({ ...i }));
  const packs = PACKS.map((p) => ({ ...p }));
  const hunts = HUNTS.map((h) => ({ ...h }));
  const rivals = RIVALS.map((r) => ({ key: r.key, name: r.name, faction: r.faction, level: r.level, power: powerOf(r) }));
  const publicUser = user ? { id: user.id, email: user.email } : null;
  if (!user) return { isLoggedIn: false, user: null, hasCharacter: false, character: null, catalog, packs, hunts, rivals, inventory: [], log: [], recharges: [], trainCosts: {} };
  const raw = await loadChar(user.id);
  if (!raw) return { isLoggedIn: true, user: publicUser, hasCharacter: false, character: null, catalog, packs, hunts, rivals, inventory: [], log: [], recharges: [], trainCosts: {} };
  const c = await applyRegen(raw);
  const inv = await q("SELECT * FROM inventory WHERE character_id = $1", [c.id]);
  const bonus = equipBonuses(inv);
  const logs = await q("SELECT * FROM battle_log WHERE character_id = $1 ORDER BY id DESC LIMIT 20", [c.id]);
  const recs = await q("SELECT * FROM recharges WHERE character_id = $1 ORDER BY id DESC LIMIT 10", [c.id]);
  const trainCosts = { strength: 40 + c.strength * 12, defense: 40 + c.defense * 12, agility: 40 + c.agility * 12, stamina: 40 + c.stamina * 12 };
  return {
    isLoggedIn: true, user: publicUser, hasCharacter: true,
    character: {
      id: c.id, name: c.name, faction: c.faction, level: c.level, xp: c.xp, xpNext: xpForNext(c.level),
      gold: c.gold, gems: c.gems, hp: c.hp, maxHp: c.max_hp, energy: c.energy, maxEnergy: c.max_energy,
      strength: c.strength, defense: c.defense, agility: c.agility, stamina: c.stamina,
      power: powerOf(c, bonus.str, bonus.def), wins: c.wins, losses: c.losses, hunts: c.hunts,
    },
    catalog, packs, hunts, rivals,
    inventory: inv.map((i) => ({ id: i.id, itemKey: i.item_key, qty: i.qty, equipped: i.equipped === 1 })),
    log: logs.map((l) => ({ id: l.id, kind: l.kind, title: l.title, detail: l.detail, result: l.result, goldDelta: l.gold_delta, xpDelta: l.xp_delta, createdAt: new Date(l.created_at).toISOString() })),
    recharges: recs.map((r) => ({ id: r.id, packKey: r.pack_key, gems: r.gems, priceMxn: r.price_mxn, createdAt: new Date(r.created_at).toISOString() })),
    trainCosts,
  };
}

async function charFor(token) {
  const user = await userFromToken(token);
  if (!user) return { error: { ok: false, message: "Tu sesión expiró. Inicia sesión de nuevo.", state: await buildState(null) } };
  const raw = await loadChar(user.id);
  if (!raw) return { error: { ok: false, message: "Primero crea tu personaje.", state: await buildState(user) } };
  return { user, char: raw };
}

// ---------- Acciones ----------

const Actions = {
  async getState(args) {
    const user = await userFromToken(args.sessionToken || "");
    return buildState(user);
  },

  async register(args) {
    const email = String(args.email || "").trim().toLowerCase();
    const password = String(args.password || "");
    if (!email.includes("@") || password.length < 6) return { ok: false, message: "Correo inválido o contraseña menor a 6 caracteres.", sessionToken: null, state: await buildState(null) };
    const existing = await q1("SELECT * FROM users WHERE email = $1", [email]);
    if (existing) return { ok: false, message: "Ese correo ya tiene cuenta. Inicia sesión.", sessionToken: null, state: await buildState(null) };
    await q("INSERT INTO users (email, password_hash) VALUES ($1, $2)", [email, hashPassword(password)]);
    const user = await q1("SELECT * FROM users WHERE email = $1", [email]);
    await claimLegacyCharacter(user.id);
    const token = await createSession(user.id);
    return { ok: true, message: `Cuenta creada para ${email}. Tu progreso queda guardado en el servidor.`, sessionToken: token, state: await buildState(user) };
  },

  async login(args) {
    const email = String(args.email || "").trim().toLowerCase();
    const password = String(args.password || "");
    const user = await q1("SELECT * FROM users WHERE email = $1", [email]);
    if (!user) return { ok: false, message: "No hay cuenta con ese correo. Crea una primero.", sessionToken: null, state: await buildState(null) };
    if (hashPassword(password) !== user.password_hash) return { ok: false, message: "Contraseña incorrecta.", sessionToken: null, state: await buildState(null) };
    await claimLegacyCharacter(user.id);
    const token = await createSession(user.id);
    return { ok: true, message: `Bienvenido de nuevo, ${email}.`, sessionToken: token, state: await buildState(user) };
  },

  async logout(args) {
    await q("DELETE FROM sessions WHERE token = $1", [args.sessionToken || ""]);
    return { ok: true, message: "Sesión cerrada. Tu progreso sigue guardado en tu cuenta." };
  },

  async createCharacter(args) {
    const user = await userFromToken(args.sessionToken || "");
    if (!user) return { ok: false, message: "Inicia sesión primero.", state: await buildState(null) };
    if (await loadChar(user.id)) return { ok: false, message: "Ya tienes un personaje creado.", state: await buildState(user) };
    const name = String(args.name || "").trim().slice(0, 24);
    const faction = args.faction === "lobo" ? "lobo" : "vampiro";
    if (name.length < 2) return { ok: false, message: "El nombre necesita al menos 2 caracteres.", state: await buildState(user) };
    const base = faction === "vampiro" ? { strength: 11, defense: 10, agility: 12, stamina: 9 } : { strength: 12, defense: 11, agility: 9, stamina: 12 };
    await q("INSERT INTO characters (user_id, name, faction, strength, defense, agility, stamina, gold, gems, hp, max_hp, energy, max_energy) VALUES ($1,$2,$3,$4,$5,$6,$7,250,10,100,100,10,10)",
      [user.id, name, faction, base.strength, base.defense, base.agility, base.stamina]);
    const c = await loadChar(user.id);
    if (c) await log(c.id, "inicio", "Nace una leyenda", `${c.name} juró lealtad a los ${faction === "vampiro" ? "Vampiros" : "Hombres Lobo"}. Recibió 250 de oro y 10 gemas de bienvenida.`, "inicio", 0, 0);
    return { ok: true, message: `¡Bienvenido a la noche, ${name}!`, state: await buildState(user) };
  },

  async train(args) {
    const got = await charFor(args.sessionToken || "");
    if (got.error) return got.error;
    const c = await applyRegen(got.char);
    const stat = ["strength", "defense", "agility", "stamina"].includes(args.stat) ? args.stat : "strength";
    const cost = 40 + c[stat] * 12;
    if (c.gold < cost) return { ok: false, message: `Te faltan ${cost - c.gold} de oro. Trabaja en el cementerio o caza para ganar más.`, state: await buildState(got.user) };
    if (c.energy < 1) return { ok: false, message: "Sin energía no puedes entrenar. Espera a que se regenere o usa un elixir.", state: await buildState(got.user) };
    const patch = { gold: c.gold - cost, energy: c.energy - 1, [stat]: c[stat] + 1 };
    if (stat === "stamina") { patch.max_hp = c.max_hp + 5; patch.hp = c.hp + 5; }
    await q(`UPDATE characters SET gold = $1, energy = $2, ${stat} = $3, max_hp = $4, hp = $5 WHERE id = $6`,
      [patch.gold, patch.energy, patch[stat], patch.max_hp ?? c.max_hp, patch.hp ?? c.hp, c.id]);
    const labels = { strength: "Fuerza", defense: "Defensa", agility: "Agilidad", stamina: "Resistencia" };
    await log(c.id, "entrenamiento", `Entrenamiento de ${labels[stat]}`, `${labels[stat]} subió a ${c[stat] + 1}. Costo: ${cost} de oro.`, "mejora", -cost, 0);
    return { ok: true, message: `${labels[stat]} +1. ¡Se siente el poder!`, state: await buildState(got.user) };
  },

  async workCemetery(args) {
    const got = await charFor(args.sessionToken || "");
    if (got.error) return got.error;
    const c = await applyRegen(got.char);
    if (c.energy < 2) return { ok: false, message: "Necesitas 2 de energía para un turno en el cementerio.", state: await buildState(got.user) };
    const earned = 45 + Math.floor(Math.random() * 40) + c.level * 5;
    await q("UPDATE characters SET gold = $1, energy = $2 WHERE id = $3", [c.gold + earned, c.energy - 2, c.id]);
    const after = await loadChar(got.user.id);
    if (after) await gainXp(after, 5);
    await log(c.id, "trabajo", "Turno en el cementerio", `Cavaste tumbas toda la noche y te pagaron ${earned} de oro.`, "oro", earned, 5);
    return { ok: true, message: `Turno terminado: +${earned} de oro.`, state: await buildState(got.user) };
  },

  async hunt(args) {
    const got = await charFor(args.sessionToken || "");
    if (got.error) return got.error;
    const c = await applyRegen(got.char);
    const hunt = HUNTS.find((h) => h.key === args.huntKey);
    if (!hunt) return { ok: false, message: "Esa cacería no existe.", state: await buildState(got.user) };
    if (c.energy < hunt.energy) return { ok: false, message: `Esa cacería pide ${hunt.energy} de energía y tienes ${c.energy}.`, state: await buildState(got.user) };
    if (c.hp <= 10) return { ok: false, message: "Estás demasiado herido. Cúrate con una poción o espera a regenerar vida.", state: await buildState(got.user) };
    const inv = await q("SELECT * FROM inventory WHERE character_id = $1", [c.id]);
    const bonus = equipBonuses(inv);
    const myPower = powerOf(c, bonus.str, bonus.def) + Math.random() * 14;
    const winChance = Math.min(0.92, Math.max(0.25, 0.55 + (myPower - hunt.minPower - 30) / 120));
    if (Math.random() < winChance) {
      const gold = hunt.goldMin + Math.floor(Math.random() * (hunt.goldMax - hunt.goldMin + 1));
      await q("UPDATE characters SET gold = $1, energy = $2, hunts = $3, hp = $4 WHERE id = $5", [c.gold + gold, c.energy - hunt.energy, c.hunts + 1, Math.max(1, c.hp - Math.floor(Math.random() * 8)), c.id]);
      const after = await loadChar(got.user.id);
      const lvl = after ? await gainXp(after, hunt.xp) : null;
      await log(c.id, "caza", `Cacería: ${hunt.name}`, `Venciste a: ${hunt.enemy}. Botín: ${gold} de oro y ${hunt.xp} XP.${lvl && lvl.leveled ? " ¡Subiste de nivel!" : ""}`, "victoria", gold, hunt.xp);
      return { ok: true, message: `¡Cacería exitosa! +${gold} oro, +${hunt.xp} XP.${lvl && lvl.leveled ? " ¡Nivel " + lvl.level + "!" : ""}`, state: await buildState(got.user) };
    }
    const dmg = 12 + Math.floor(Math.random() * 18);
    await q("UPDATE characters SET energy = $1, hp = $2, hunts = $3 WHERE id = $4", [c.energy - hunt.energy, Math.max(1, c.hp - dmg), c.hunts + 1, c.id]);
    await log(c.id, "caza", `Cacería: ${hunt.name}`, `${hunt.enemy} te superó. Perdiste ${dmg} de vida y escapaste sin botín.`, "derrota", 0, 0);
    return { ok: true, message: `Derrota contra ${hunt.enemy}: -${dmg} de vida. Entrena o equipa algo mejor.`, state: await buildState(got.user) };
  },

  async fightRival(args) {
    const got = await charFor(args.sessionToken || "");
    if (got.error) return got.error;
    const c = await applyRegen(got.char);
    const rival = RIVALS.find((r) => r.key === args.rivalKey);
    if (!rival) return { ok: false, message: "Ese rival no existe.", state: await buildState(got.user) };
    if (c.energy < 2) return { ok: false, message: "Necesitas 2 de energía para pelear.", state: await buildState(got.user) };
    if (c.hp <= 10) return { ok: false, message: "Estás demasiado herido para pelear. Cúrate primero.", state: await buildState(got.user) };
    const inv = await q("SELECT * FROM inventory WHERE character_id = $1", [c.id]);
    const bonus = equipBonuses(inv);
    let myHp = c.hp, rivalHp = 60 + rival.stamina * 4;
    const rounds = [];
    for (let round = 1; round <= 6 && myHp > 0 && rivalHp > 0; round++) {
      const myDmg = Math.max(2, Math.round((c.strength + bonus.str) * (0.7 + Math.random() * 0.6) - rival.defense * 0.35));
      if (Math.random() * 100 < rival.agility * 0.8) rounds.push(`Asalto ${round}: ${rival.name} esquiva tu ataque.`);
      else { rivalHp -= myDmg; rounds.push(`Asalto ${round}: golpeas por ${myDmg}.`); }
      if (rivalHp <= 0) break;
      const hisDmg = Math.max(2, Math.round(rival.strength * (0.7 + Math.random() * 0.6) - (c.defense + bonus.def) * 0.35));
      if (Math.random() * 100 < c.agility * 0.8) rounds.push("Esquivas el contraataque.");
      else { myHp -= hisDmg; rounds.push(`${rival.name} responde por ${hisDmg}.`); }
    }
    if (rivalHp <= 0 && myHp > 0) {
      const gold = 30 + rival.level * 18 + Math.floor(Math.random() * 30);
      const xp = 15 + rival.level * 8;
      await q("UPDATE characters SET gold = $1, energy = $2, hp = $3, wins = $4 WHERE id = $5", [c.gold + gold, c.energy - 2, Math.max(1, myHp), c.wins + 1, c.id]);
      const after = await loadChar(got.user.id);
      const lvl = after ? await gainXp(after, xp) : null;
      await log(c.id, "pvp", `Duelo vs ${rival.name}`, `${rounds.slice(0, 4).join(" ")} Botín: ${gold} oro, ${xp} XP.${lvl && lvl.leveled ? " ¡Subiste de nivel!" : ""}`, "victoria", gold, xp);
      return { ok: true, message: `¡Venciste a ${rival.name}! +${gold} oro, +${xp} XP.`, state: await buildState(got.user) };
    }
    await q("UPDATE characters SET energy = $1, hp = $2, losses = $3 WHERE id = $4", [c.energy - 2, Math.max(1, myHp), c.losses + 1, c.id]);
    await log(c.id, "pvp", `Duelo vs ${rival.name}`, `${rounds.slice(0, 4).join(" ")} ${rival.name} se quedó con la victoria.`, "derrota", 0, 0);
    return { ok: true, message: `${rival.name} te venció. Te quedan ${Math.max(1, myHp)} de vida.`, state: await buildState(got.user) };
  },

  async buyItem(args) {
    const got = await charFor(args.sessionToken || "");
    if (got.error) return got.error;
    const c = await applyRegen(got.char);
    const item = CATALOG.find((i) => i.key === args.itemKey);
    if (!item) return { ok: false, message: "Ese objeto no existe.", state: await buildState(got.user) };
    if (item.currency === "gold" && c.gold < item.price) return { ok: false, message: `Te faltan ${item.price - c.gold} de oro para ${item.name}.`, state: await buildState(got.user) };
    if (item.currency === "gems" && c.gems < item.price) return { ok: false, message: `Te faltan ${item.price - c.gems} gemas. Recarga en la pestaña Recargar.`, state: await buildState(got.user) };
    const invPre = await q("SELECT * FROM inventory WHERE character_id = $1", [c.id]);
    const existingPre = invPre.find((i) => i.item_key === item.key);
    if (existingPre && item.type !== "pocion") return { ok: false, message: `Ya tienes ${item.name}. Equípalo desde tu Guarida.`, state: await buildState(got.user) };
    if (item.currency === "gold") await q("UPDATE characters SET gold = $1 WHERE id = $2", [c.gold - item.price, c.id]);
    else await q("UPDATE characters SET gems = $1 WHERE id = $2", [c.gems - item.price, c.id]);
    if (existingPre && item.type === "pocion") await q("UPDATE inventory SET qty = $1 WHERE id = $2", [existingPre.qty + 1, existingPre.id]);
    else if (!existingPre) await q("INSERT INTO inventory (character_id, item_key, qty, equipped) VALUES ($1,$2,1,0)", [c.id, item.key]);
    await log(c.id, "tienda", `Compra: ${item.name}`, `Pagaste ${item.price} ${item.currency === "gold" ? "de oro" : "gemas"}.`, "compra", item.currency === "gold" ? -item.price : 0, 0);
    return { ok: true, message: `Compraste ${item.name}.`, state: await buildState(got.user) };
  },

  async equipItem(args) {
    const got = await charFor(args.sessionToken || "");
    if (got.error) return got.error;
    const inv = await q("SELECT * FROM inventory WHERE character_id = $1", [got.char.id]);
    const row = inv.find((i) => i.id === Number(args.inventoryId));
    if (!row) return { ok: false, message: "Ese objeto no está en tu inventario.", state: await buildState(got.user) };
    const item = CATALOG.find((i) => i.key === row.item_key);
    if (!item || item.type === "pocion") return { ok: false, message: "Las pociones se usan, no se equipan.", state: await buildState(got.user) };
    if (row.equipped === 1) {
      await q("UPDATE inventory SET equipped = 0 WHERE id = $1", [row.id]);
      return { ok: true, message: `Desequipaste ${item.name}.`, state: await buildState(got.user) };
    }
    for (const other of inv) {
      const oi = CATALOG.find((i) => i.key === other.item_key);
      if (other.equipped === 1 && oi && oi.type === item.type) await q("UPDATE inventory SET equipped = 0 WHERE id = $1", [other.id]);
    }
    await q("UPDATE inventory SET equipped = 1 WHERE id = $1", [row.id]);
    return { ok: true, message: `Equipaste ${item.name}. Tu poder subió.`, state: await buildState(got.user) };
  },

  async useItem(args) {
    const got = await charFor(args.sessionToken || "");
    if (got.error) return got.error;
    const c = await applyRegen(got.char);
    const inv = await q("SELECT * FROM inventory WHERE character_id = $1", [c.id]);
    const row = inv.find((i) => i.id === Number(args.inventoryId));
    if (!row || row.qty <= 0) return { ok: false, message: "No te queda de esa poción.", state: await buildState(got.user) };
    const item = CATALOG.find((i) => i.key === row.item_key);
    if (!item || item.type !== "pocion") return { ok: false, message: "Eso no se puede usar así.", state: await buildState(got.user) };
    let msg = "";
    if (item.stat === "hp") { await q("UPDATE characters SET hp = $1 WHERE id = $2", [Math.min(c.max_hp, c.hp + item.bonus), c.id]); msg = `+${item.bonus} de vida.`; }
    else if (item.stat === "hp_full") { await q("UPDATE characters SET hp = $1 WHERE id = $2", [c.max_hp, c.id]); msg = "Vida restaurada por completo."; }
    else if (item.stat === "energy") { await q("UPDATE characters SET energy = $1 WHERE id = $2", [Math.min(c.max_energy, c.energy + item.bonus), c.id]); msg = `+${item.bonus} de energía.`; }
    if (row.qty <= 1) await q("DELETE FROM inventory WHERE id = $1", [row.id]);
    else await q("UPDATE inventory SET qty = $1 WHERE id = $2", [row.qty - 1, row.id]);
    return { ok: true, message: `Usaste ${item.name}: ${msg}`, state: await buildState(got.user) };
  },

  async recharge(args) {
    const got = await charFor(args.sessionToken || "");
    if (got.error) return got.error;
    const pack = PACKS.find((p) => p.key === args.packKey);
    if (!pack) return { ok: false, message: "Ese paquete no existe.", state: await buildState(got.user) };
    await q("UPDATE characters SET gems = $1 WHERE id = $2", [got.char.gems + pack.gems, got.char.id]);
    await q("INSERT INTO recharges (character_id, pack_key, gems, price_mxn) VALUES ($1,$2,$3,$4)", [got.char.id, pack.key, pack.gems, pack.priceMxn]);
    await log(got.char.id, "recarga", `Recarga simulada: ${pack.name}`, `Se acreditaron ${pack.gems} gemas por $${pack.priceMxn} MXN (simulado, sin cobro real).`, "recarga", 0, 0);
    return { ok: true, message: `Recarga simulada lista: +${pack.gems} gemas. En la versión real aquí se abriría Mercado Pago.`, state: await buildState(got.user) };
  },

  async resetCharacter(args) {
    const got = await charFor(args.sessionToken || "");
    if (got.error) return got.error;
    await q("DELETE FROM inventory WHERE character_id = $1", [got.char.id]);
    await q("DELETE FROM battle_log WHERE character_id = $1", [got.char.id]);
    await q("DELETE FROM recharges WHERE character_id = $1", [got.char.id]);
    await q("DELETE FROM characters WHERE id = $1", [got.char.id]);
    return { ok: true, message: "Personaje eliminado. Tu cuenta sigue activa para crear otro.", state: await buildState(got.user) };
  },
};

// ---------- HTTP: /health, /actions y archivos estáticos ----------

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml" };

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; if (data.length > 1_000_000) req.destroy(); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function dbStatus() {
  if (!pool) return DATABASE_URL ? "error" : "sin_configurar";
  try { await pool.query("SELECT 1"); return "ok"; } catch { return "error"; }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/health") {
      // Render exige 200 aquí para marcar el servicio como vivo. La base puede
      // tardar en despertar (Neon se pausa); por eso el estado de la base va en
      // el cuerpo y NO tumba el health check.
      sendJson(res, 200, { status: "ok", service: "noche-eterna", db: await dbStatus(), time: new Date().toISOString() });
      return;
    }
    if (url.pathname === "/actions" && req.method === "POST") {
      const raw = await readBody(req);
      let payload;
      try { payload = JSON.parse(raw || "{}"); } catch { sendJson(res, 400, { error: "JSON inválido" }); return; }
      const fn = Actions[payload.action];
      if (!fn) { sendJson(res, 404, { error: `Acción desconocida: ${payload.action}` }); return; }
      if (!pool) { sendJson(res, 503, { error: dbError || "Base de datos no disponible. Revisa DATABASE_URL en Render." }); return; }
      try {
        const result = await fn(payload.args || {});
        sendJson(res, 200, result);
      } catch (e) {
        console.error("[noche-eterna] acción", payload.action, e);
        sendJson(res, 500, { error: "Error interno del servidor" });
      }
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      let path = decodeURIComponent(url.pathname);
      if (path === "/") path = "/index.html";
      const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
      const filePath = join(__dirname, "public", safe);
      try {
        const data = await readFile(filePath);
        res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
        res.end(req.method === "HEAD" ? undefined : data);
      } catch {
        // SPA: cualquier ruta desconocida devuelve el index.
        try {
          const index = await readFile(join(__dirname, "public", "index.html"));
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(index);
        } catch { sendJson(res, 404, { error: "No encontrado" }); }
      }
      return;
    }
    sendJson(res, 405, { error: "Método no permitido" });
  } catch (e) {
    console.error("[noche-eterna]", e);
    sendJson(res, 500, { error: "Error interno del servidor" });
  }
});

await initDb();
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[noche-eterna] Escuchando en puerto ${PORT} — health en /health`);
  if (!DATABASE_URL) console.warn("[noche-eterna] OJO: falta DATABASE_URL; /health responde pero el juego no guardará datos hasta configurarla en Render.");
});
