# Servidor de la Taula · Cançoner de Taverna

Pequeño servidor en tiempo real (Cloudflare Worker + Durable Objects). Cada sala es un Durable Object:
los móviles se conectan por WebSocket y cuando uno envía una canción, todos los de la sala la reciben.
No guarda datos personales: solo la última canción enviada (número, nombre opcional y hora).

## Qué hay aquí
- `src/index.js` · Worker y clase `Room`.
- `src/logic.js` · validaciones puras (sala, mensajes, origen).
- `test/` · pruebas (`npm test`, solo necesita Node 20+).
- `dev/local-server.mjs` · servidor de pruebas local (NO es el de producción).
- `wrangler.toml` · configuración. **`ALLOWED_ORIGINS`** debe contener la URL de tu GitHub Pages.

## Publicarlo (una sola vez, gratis)
Necesitas una cuenta gratuita en https://dash.cloudflare.com (no pide tarjeta para el plan Free).

### Opción A · desde tu ordenador (la más segura)
```bash
cd taula-server
npm install
npx wrangler login
npx wrangler deploy
```
Al terminar, wrangler muestra una dirección tipo `https://cancioner-taula.TU-USUARIO.workers.dev`.

### Opción B · conectando el repositorio de GitHub
En Cloudflare → *Workers & Pages* → *Create* → *Import a repository*, elige el repo y pon
**Root directory = `taula-server`**. Cada `git push` lo redespliega. (Si tu cuenta no ofrece esta opción, usa la A.)

## Conectar la web
1. Abre `index.html` y busca `const TAULA_SERVER_URL = "";`
2. Cámbialo por `const TAULA_SERVER_URL = "wss://cancioner-taula.TU-USUARIO.workers.dev";` (con `wss://`).
3. Sube `index.html` a GitHub. Listo.

Para invitar a alguien: botón **Taula → Copiar enlace**. Quien abra ese enlace entra directo a la sala.

## Comprobar que funciona
Abre `https://cancioner-taula.TU-USUARIO.workers.dev/health` → debe decir «Taula en marxa».

## Privacidad y límites
- El código de sala funciona como contraseña compartida: usa uno difícil de adivinar para la sala real.
- Máx. 80 conexiones por sala, un envío por dispositivo cada 0,8 s, mensajes de máx. 512 bytes.
- Solo acepta conexiones desde los orígenes de `ALLOWED_ORIGINS`. Para probar en local:
  `ALLOWED_ORIGINS="*" node dev/local-server.mjs 8787` y abre `http://localhost:8787/`.
- Plan gratuito de Cloudflare: 100.000 peticiones/día; el servidor usa la API de hibernación de WebSocket para
  gastar lo mínimo. Para un grupo de cantantes sobra con mucho margen.
