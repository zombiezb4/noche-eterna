# Noche Eterna en producción: Render (app) + Neon (Postgres)

Arquitectura: la app corre en **Render** y la base de datos **Postgres vive en Neon**.
Se unen por la variable de entorno `DATABASE_URL`. El login (correo + contraseña)
liga cada personaje a su cuenta en el servidor: si el jugador cambia de celular,
inicia sesión y recupera todo.

## La adaptación (hecha el 2026-11-08)

Lo que se despliega en Render es la carpeta **`standalone/`**, una versión
independiente del juego que no necesita Muse para correr:

- `standalone/server.js` — servidor Node propio. Arranque: `npm start`.
  Escucha en `0.0.0.0:$PORT` (Render inyecta `PORT`).
- `GET /health` — ruta de salud que Render revisa. Responde
  `{ status: "ok", service: "noche-eterna", db: "ok" }`. El estado de la base
  va en el cuerpo y no tumba el chequeo (Neon tarda en despertar).
- `POST /actions` — la API del juego (cuentas, sesiones, personaje,
  entrenamiento, cacerías, arena, tienda, inventario, recargas simuladas),
  con la misma forma que la versión de Muse.
- `standalone/public/` — el cliente web (se instala como app desde el navegador).
- **Datos:** todo se lee y escribe en Postgres vía `DATABASE_URL`. No hay base
  local: si Render reinicia, el progreso sigue en Neon.
- Al arrancar, el servidor aplica `CREATE TABLE IF NOT EXISTS` del esquema,
  así que las tablas se crean aunque no se haya corrido el SQL a mano.
- `.gitignore` en la raíz deja fuera `.env`, `app.db`, `node_modules/` y las
  salidas de build: tu cadena de Neon nunca entra a GitHub.

Fue probado en local contra un Postgres real: registro, login, creación de
personaje, trabajo en el cementerio y —clave— tras reiniciar el servidor el
personaje y su oro seguían ahí, porque viven en la base.

> La versión dentro de Muse sigue existiendo y jugándose igual; su progreso
> vive en el servidor de Muse. La versión `standalone/` es la que se publica;
> cada una guarda en su propia base.

## Paso 0 — Probar en tu máquina (opcional pero recomendado)

```bash
cd standalone
cp .env.example .env   # pega tu DATABASE_URL pooled de Neon en .env
npm install
npm start
# http://localhost:3000  y  http://localhost:3000/health
```

## Paso 1 — La base en Neon (ya hecho por Randy)

El proyecto y las 6 tablas (`users`, `sessions`, `characters`, `inventory`,
`battle_log`, `recharges`) ya están creados. Solo necesitas la cadena de
conexión **pooled**: botón **Connect** en Neon, con **Connection pooling**
activado (el host trae `-pooler`). Formato:
`postgresql://usuario:••••@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require`

**No pegues esa cadena en chats ni en GitHub.** Va directo en Render (paso 3).
Usa siempre la pooled: Render reinicia seguido y la conexión directa agota
las conexiones.

## Paso 2 — Subir el código a GitHub (paquete preparado el 2026-11-08)

El paquete para GitHub ya está armado y revisado en la carpeta
`github-package/` del proyecto (y listado archivo por archivo en la pestaña
**Servidor** del juego). Contiene SOLO esto — es lo que va en el repo:

- Raíz: `README.md`, `render.yaml`, `.gitignore`, `.env.example`,
  `DEPLOY-RENDER-NEON.md`
- `standalone/` completa: `server.js`, `package.json`, `package-lock.json`,
  `schema.sql`, `.env.example`, `README.md` y `public/` (con `assets/`)

Se verificó que el paquete no trae ninguna cadena real de Neon, ningún `.env`,
ninguna base local (`app.db`) y ningún `node_modules`. NO subas el proyecto
entero de Muse: las carpetas `client/`, `server/` y `drizzle/` son internas
de la versión de Muse y no se despliegan.

Formas de subirlo:

- **github.com (web):** crea el repo `noche-eterna` vacío (sin README ni
  .gitignore, el paquete ya los trae), sube los 5 archivos de raíz con
  *uploading an existing file* y después la carpeta `standalone/`.
- **git:** dentro de la carpeta del paquete, `git init`, `git add .`,
  `git commit`, agrega tu repo como `origin` y `git push -u origin main`.
  Antes del push, `git status` no debe mostrar ningún `.env` (solo
  `.env.example`).

## Paso 3 — Crear el servicio en Render

1. En Render: **New → Blueprint** y elige tu repo (usa el `render.yaml`
   incluido: rootDir `standalone`, build `npm install`, start `npm start`,
   health check `/health`).
   O **New → Web Service** con esos mismos valores a mano.
2. En **Environment** agrega:
   - `DATABASE_URL` = la cadena pooled de Neon del paso 1.
   - `SESSION_SECRET` = un texto largo y secreto (el blueprint lo genera solo).
3. Deploy. Al terminar, Render te da la URL pública del juego.

## Paso 4 — Probar

Abre la URL de Render, crea una cuenta, crea tu personaje, cierra sesión,
entra desde otro navegador o celular con la misma cuenta: tu personaje, oro,
gemas e inventario deben estar ahí. Eso confirma que el guardado vive en
Neon, no en el dispositivo.

## Lo que hay que saber de los planes gratis

- **Render gratis se duerme** a los ~15 min sin visitas; la primera visita
  después tarda en despertar.
- **Neon se pausa** a los ~5 min sin actividad y despierta solo con la
  siguiente consulta (los datos no se borran).
- El Postgres gratis **de Render** sí caduca; por eso la base vive en Neon.
- Cuando conectes Mercado Pago de verdad, las recargas dejarán de ser
  simuladas; las gemas ya quedan registradas por cuenta en la tabla
  `recharges`.
