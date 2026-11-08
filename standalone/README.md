# Noche Eterna — versión independiente (Render + Neon)

Esta carpeta ES la app que se publica. No depende de Muse para correr:

- `server.js` — servidor Node propio: arranque con `npm start`, escucha en
  `$PORT`, ruta de salud `GET /health`, API del juego en `POST /actions` y
  archivos estáticos desde `public/`.
- `public/` — el cliente web del juego (se instala como app desde el navegador).
- `schema.sql` — el esquema Postgres de Neon. El servidor además lo aplica solo
  al arrancar (`CREATE TABLE IF NOT EXISTS`), así que funciona aunque no lo
  hayas corrido a mano.
- Datos: **todo** se guarda en Postgres (Neon) usando `DATABASE_URL`.
  No hay base local: si Render reinicia, el progreso sigue en Neon.

## Correr en tu máquina

```bash
cd standalone
cp .env.example .env   # pega tu DATABASE_URL pooled de Neon en .env
npm install
npm start
# abre http://localhost:3000  y prueba http://localhost:3000/health
```

## Publicar en Render

Usa el `render.yaml` de la raíz del repo (Blueprint) o crea un Web Service con:

- Root Directory: `standalone`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- Environment: `DATABASE_URL` = cadena **pooled** de Neon (con `-pooler`)

La guía completa paso a paso está en `../DEPLOY-RENDER-NEON.md`.
