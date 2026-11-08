# Noche Eterna

Juego web tipo BiteFight: vampiros contra hombres lobo. Cuentas con login,
personaje, entrenamiento, trabajo en el cementerio, cacerías, arena PvP,
tienda con oro y gemas, y recargas simuladas.

El progreso se guarda en el servidor, ligado a la cuenta — no en el celular:
si el jugador cambia de teléfono, inicia sesión y recupera todo.

## Arquitectura

- **App:** Node.js, en la carpeta `standalone/` (eso es lo que corre Render).
- **Base de datos:** Postgres en Neon, conectado con la variable de entorno
  `DATABASE_URL` (usa siempre la cadena **pooled**, host con `-pooler`).
- **Salud:** `GET /health` para el chequeo de Render.

## Despliegue rápido (Render + Neon)

1. Crea el proyecto en Neon y copia tu cadena de conexión **pooled**
   (botón **Connect**, con *Connection pooling* activado).
2. En Render: **New → Blueprint** y elige este repo. El `render.yaml` de la
   raíz ya trae todo: rootDir `standalone`, build `npm install`,
   start `npm start`, health check `/health`.
3. En el panel de Render (**Environment**) pega tu `DATABASE_URL`.
   **Nunca** la pongas en el repo ni en un archivo que se suba.
4. Deploy. Al terminar abre la URL pública y prueba `/health`:
   debe responder con el estado de la base en `ok`.

La guía completa, paso a paso y con los errores comunes, está en
`DEPLOY-RENDER-NEON.md`.

## Correr en local

    cd standalone
    cp .env.example .env   # pega tu DATABASE_URL pooled de Neon en .env
    npm install
    npm start
    # abre http://localhost:3000  y  http://localhost:3000/health

## Estructura del repo

- `standalone/server.js` — servidor propio y API del juego (`POST /actions`)
- `standalone/public/` — cliente web (se instala como app desde el navegador)
- `standalone/schema.sql` — esquema Postgres (el servidor también lo aplica
  solo al arrancar, con `CREATE TABLE IF NOT EXISTS`)
- `render.yaml` — blueprint de Render
- `.gitignore` — deja fuera `.env`, bases locales y `node_modules`
- `DEPLOY-RENDER-NEON.md` — guía de despliegue paso a paso

## Notas

- Render gratis se duerme tras ~15 min sin visitas y Neon se pausa tras
  ~5 min; la primera visita después tarda un poco más. Es normal y los
  datos no se borran.
- El Postgres gratis de Render caduca; por eso la base vive en Neon.
- Las recargas de gemas son **simuladas** por ahora (sin cobro real).
  Mercado Pago se conecta después.
