# StreetGuessr

Juego en el navegador: se ilumina una calle sobre un mapa satélite y hay que elegir su nombre entre 4 opciones. Se ven los nombres de las calles vecinas, pero no el de la calle que hay que adivinar.

- Portada con una ronda de prueba sobre calles reales, buscador de ciudades y top de jugadores en directo.
- Inicio de sesión con Google o con correo y contraseña (el correo se verifica antes de crear el jugador).
- Pantalla de inicio con tu **avatar pixel art** en grande: elige ubicación y juega.
- Avatar pixel art de 48×48 por capas (piel, cara, pelo, ropa, pantalón, zapatos, sombrero, complementos, fondo y **mascota**)
  con 73 objetos: gratis, con **monedas** (1 por acierto), por **logros** o **exclusivos** con dinero real (Stripe).
- Durante la partida tu personaje **camina por la calle** que hay que adivinar, siempre al mismo tamaño en pantalla.
- Más de 3.000 municipios de España (todos los que tienen al menos 40 calles jugables), con los datos ya descargados en `data/`.
- **Reto diario**: 5 calles famosas de España (Gran Vía, La Rambla, Calle Larios…), las mismas para todo el mundo, con ranking del día y racha.
- **Amigos**: añadir por nombre de jugador, solicitudes y retos a un 1 vs 1 amistoso.
- **Modo 1 vs 1** competitivo: 7 calles iguales para los dos y gana quien las acierte antes. Rival en tu ciudad, en cualquier ciudad o la CPU; emparejamiento por ELO.
- Ranking por ciudad (mejor partida), mundial (puntos totales) y 1 vs 1 (ELO).
- Controles: `1`–`4` responder, `Enter` siguiente ronda, `C` centrar la calle.

## Estructura

```
public/                lo que se publica como web
  index.html           portada y pantallas del juego
  assets/              logo, favicon e iconos
  css/                 app.css (juego), landing.css (portada), home.css (inicio, avatar, tienda y 1 vs 1)
  js/app.js            flujo: portada → login → verificación → nombre → inicio → partida
  js/catalog.js        ← catálogo de objetos, precios y logros (fuente única)
  js/rounds.js         calles jugables y rondas (lo comparten el navegador y el servidor 1 vs 1)
  js/game.js           mapa (Leaflet), partida clásica y 1 vs 1, personajes andando por la calle
  js/versus.js         modo 1 vs 1: búsqueda, salas privadas, rival CPU, partida y resultado
  js/daily.js          reto diario · js/famous.js: lista de calles famosas y el reto de cada día
  js/friends.js        amigos, solicitudes y retos
  js/avatar.js         avatar pixel art (48×48, por capas, con sombreado y contorno automáticos)
  js/home.js, editor.js, shop.js, store.js, landing.js, auth.js, cities.js, profile.js, ranking.js
  js/config.js         ← configuración de tu proyecto de Firebase
  data/                municipios y calles (código INE)
server/                Worker de Cloudflare
  worker.js            rutas /api/checkout, /api/stripe-webhook y /api/arena
  arena.js             servidor del 1 vs 1 (Durable Object): cola, emparejamiento, arbitraje y ELO
firestore.rules        reglas de seguridad (validan partidas, monedas y objetos)
tools/build_data.py    genera public/data a partir de OpenStreetMap
tools/gen_rules.mjs    copia el catálogo a firestore.rules
tests/                 reglas, pagos, servidor 1 vs 1 y partidas completas en Chromium
```

## Reto diario

- Cada día (a medianoche, hora de España) salen 5 calles famosas de 5 ciudades distintas, iguales para todos: se eligen con una semilla a partir de la fecha ([public/js/famous.js](public/js/famous.js)).
- La calle se ve sobre el satélite **sin los nombres de las calles vecinas** (delatarían la ciudad); las 4 opciones son calles famosas de ciudades distintas.
- 100 puntos por acierto y hasta 100 más por rapidez. Una sola partida al día; salir a mitad cuenta como terminado.
- Ranking del día, racha de días seguidos y resultado para compartir (🟩🟥🟩).
- Para añadir calles famosas, amplía `LIST` en `famous.js` con el nombre exacto que tiene en `public/data/m/<INE>.json` (`tests/daily.test.js` comprueba que existen).

## Amigos y salas privadas

- **Amigos**: se añaden por nombre de jugador; el otro acepta o rechaza. En la lista se ve su nivel, ELO y récord.
- **Retar a un amigo** crea una sala privada y le llega el reto dentro del juego (con aviso en el botón Amigos).
- **Sala con un amigo** (en el 1 vs 1) da un código de 5 letras y un enlace `…/?sala=CÓDIGO` para enviar por WhatsApp o donde sea; también se puede escribir el código en «Unirse». Si quien abre el enlace no ha entrado aún, se le pide iniciar sesión y entra a la sala después.
- Las partidas de sala son **amistosas**: no cambian el ELO (si no, se podría subir jugando con un amigo que se deje ganar). Las salas caducan a los 30 minutos.

## Modo 1 vs 1

- Dos variantes: **calles de una ciudad** (la que elijas, o al azar) y **calles famosas** (7 calles famosas de 7 ciudades distintas, sin nombres de calles vecinas; el mapa cambia de ciudad en cada calle). Solo se emparejan jugadores que buscan la misma variante; las salas usan la variante de quien las crea.
- Las 7 calles las elige el servidor y son las mismas para los dos. No hay vidas: gana quien acierte las 7 primero (o quien vaya por delante si pasan 5 minutos). Fallar bloquea 3 segundos.
- En el mapa se ven los dos personajes con su nombre: quien acierta pasa a la siguiente calle y el otro se queda en la suya.
- **Emparejamiento** (en [server/arena.js](server/arena.js)): busca un ELO parecido (±100, y la ventana se abre 50 por segundo); a los 8 s acepta a cualquiera. «Rival en tu ciudad» solo empareja en esa ciudad; «Rival aleatorio» empareja con quien sea y juega en su ciudad (o en una ciudad grande al azar). Si no hay nadie compatible en 20 s, o nadie conectado en 5 s, juegas contra la CPU.
- **CPU**: su velocidad depende de tu ELO y no cambia tu ELO (si no, se podría subir a base de jugar contra la máquina).
- **ELO**: empieza en 1000, K = 32. Lo calcula y lo guarda el servidor en Firestore (`elo`, `compWins`, `compLosses`, `compPlayed` y `matches/{id}`); las reglas no dejan que el navegador lo toque.
- Si te desconectas puedes volver a la partida durante 15 s; después pierdes por abandono.
- Funciona con el Worker de Cloudflare (`npm run dev:cf` en local, `npm run deploy` en producción). Sin él, «buscar rival» pasa a jugar contra la CPU.
- Todo va en un único Durable Object, incluido en el plan gratuito de Cloudflare. Para miles de partidas a la vez habría que repartirlo por regiones.

## Objetos del avatar

Todo está en [public/js/catalog.js](public/js/catalog.js). Para añadir un objeto: añádelo a `ITEMS`, dibújalo en [public/js/avatar.js](public/js/avatar.js) y ejecuta `npm run rules` para copiar precios y logros a `firestore.rules` (los tests fallan si se te olvida).

En `avatar.js` cada objeto se dibuja con formas planas (`g.r`, `g.s` en espejo, `g.shape` por filas) y detalles (`g.d`). El sombreado de 5 tonos y el contorno se calculan solos, así que un objeto nuevo queda con el mismo estilo que los demás. Las mascotas son lo más caro: de 2.500 a 5.000 monedas, una por logro (50.000 puntos) y dos exclusivas (4,99 € y 9,99 €).

| Tipo      | Cómo se consigue                                  | Quién lo comprueba                         |
|-----------|---------------------------------------------------|--------------------------------------------|
| `free`    | lo tiene todo el mundo                            | —                                          |
| `coins`   | se compra con monedas (1 moneda por acierto)      | reglas de Firestore: se descuenta el precio exacto |
| `ach`     | al llegar a una cifra (partidas, récord, puntos)  | reglas de Firestore, con las cifras ya validadas |
| `premium` | con dinero real                                   | solo lo entrega el servidor tras el pago de Stripe |

También se venden packs de monedas (`PACKS`). Las reglas impiden ponerse objetos que no tienes.

## Puesta en marcha de Firebase (una vez)

1. Proyecto en <https://console.firebase.google.com> (el plan gratuito Spark es suficiente).
2. **Authentication → Sign-in method**: activa **Google** y **Correo electrónico/contraseña**.
3. **Authentication → Settings → Authorized domains**: añade el dominio donde publiques el juego. `localhost` ya viene incluido.
4. **Firestore Database → Crear base de datos** en modo producción.
5. Copia la configuración de la app web en [public/js/config.js](public/js/config.js) (ya está la de `streetguessr-8a719`).
6. Sube las reglas y los índices:
   ```
   npm install
   npx firebase login
   npm run deploy:rules
   ```

## Pagos con Stripe

Los pagos los gestiona un Worker de Cloudflare ([server/worker.js](server/worker.js)) que vive en el mismo dominio que el juego:

- `POST /api/checkout` comprueba tu sesión de Firebase y crea un pago de Stripe Checkout con el precio del catálogo.
- `POST /api/stripe-webhook` recibe la confirmación de Stripe (firma verificada) y entrega el objeto o las monedas en Firestore, una sola vez por pago.

Configuración (primero en **modo de prueba** de Stripe):

1. Cuenta en <https://dashboard.stripe.com>. En **Developers → API keys** copia la *Secret key* (`sk_test_…`).
2. En Firebase: **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada** (descarga un JSON).
3. Guarda los secretos en Cloudflare (nunca en el código):
   ```
   npx wrangler login
   npx wrangler secret put STRIPE_SECRET_KEY          # sk_test_…
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT   # pega el JSON entero
   ```
4. Publica (ver abajo) y en Stripe ve a **Developers → Webhooks → Add endpoint**:
   URL `https://TU-DOMINIO/api/stripe-webhook`, eventos `checkout.session.completed` y `checkout.session.async_payment_succeeded`.
   Copia el *Signing secret* y guárdalo:
   ```
   npx wrangler secret put STRIPE_WEBHOOK_SECRET      # whsec_…
   ```
5. Prueba una compra con la tarjeta `4242 4242 4242 4242` (cualquier fecha futura y CVC).
6. Cuando todo funcione, repite con las claves *live* de Stripe.

## Ejecutar en local

```
npm start                          # solo la web: http://localhost:5173 (sin pagos ni 1 vs 1 online)
npm run dev:cf                     # web + servidor (pagos y 1 vs 1): http://localhost:8787
```

Para `npm run dev:cf` copia `.dev.vars.example` como `.dev.vars` (no se sube a git). Tal cual usa los emuladores; para el proyecto real pon `FIREBASE_SERVICE_ACCOUNT` y las claves de Stripe. Para recibir webhooks en local usa la CLI de Stripe: `stripe listen --forward-to localhost:8787/api/stripe-webhook` (te da el `whsec_` de pruebas).

Sin tocar el proyecto real, con los emuladores de Firebase (necesitan Java 11+):

```
npm run emulators                  # en otra terminal
# y abre http://localhost:5173/?emulador
```

## Publicar en Cloudflare (gratis)

```
npx wrangler login
npm run deploy                     # publica la web y el Worker → https://streetguessr.TU-SUBDOMINIO.workers.dev
```

Solo se publica la carpeta `public/`; el Worker (`server/`) va aparte. También puedes conectarlo a GitHub en **Workers & Pages → Create → Import a repository** con el comando de despliegue `npx wrangler deploy`. Añade el dominio final a *Authorized domains* de Firebase.

## Datos de calles

Los datos salen de OpenStreetMap (© colaboradores de OpenStreetMap, licencia ODbL). Para regenerarlos:

```
pip install osmium shapely
curl -LO https://download.geofabrik.de/europe/spain-latest.osm.pbf
curl -LO https://download.geofabrik.de/africa/canary-islands-latest.osm.pbf
python tools/build_data.py spain-latest.osm.pbf canary-islands-latest.osm.pbf   # escribe en public/data
```

Tarda unos 6 minutos. Cada calle se asigna al municipio (`admin_level=8` con código INE) donde cae su punto medio. Los ids de municipio son códigos INE, así que los rankings se conservan al regenerar.

## Tests

```
npx playwright install chromium    # la primera vez
npm test
```

Comprueba que `firestore.rules` está al día con el catálogo, arranca los emuladores y ejecuta los tests de reglas (incluidos intentos de trampa con puntos, monedas y objetos), los del servidor de pagos (con Stripe simulado), los del servidor 1 vs 1 (con reloj simulado) y una partida completa en Chromium. El 1 vs 1 entre dos navegadores (`tests/versus.test.js`) se ejecuta si además está en marcha `npm run dev:cf`; si no, se salta.

## Sobre las trampas

La partida se juega en el navegador, así que alguien con conocimientos podría enviar resultados inventados. Las reglas de Firestore lo limitan: la puntuación tiene que cuadrar con los aciertos, las monedas ganadas son exactamente los aciertos, los totales son la suma exacta y entre partidas tiene que pasar al menos 1 s por ronda. Lo que se paga con dinero real nunca depende del navegador: solo lo entrega el servidor tras confirmar el pago con Stripe.
