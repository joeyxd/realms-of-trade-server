# Jugar en línea con amigos (tu servidor por SSH)

`npm start` levanta **un solo proceso** que sirve el juego y corre el mundo. Quien abre la URL juega en línea en
la misma isla (hasta `MAX_PLAYERS`, 4 por defecto).

## ¿Tu PC o el servidor?

- **La GPU no importa para el servidor.** El servidor solo corre la simulación (CPU: ~0.16 ms por paso a 60 Hz,
  casi nada). Cada jugador **dibuja el juego con la GPU de su propio equipo**, en su navegador. Hospedar en tu PC
  no le da tu GPU a tu amigo.
- Lo que cambia es la **red**:
  - **Servidor (VPS / «live box»)**, recomendado: siempre encendido, IP pública, sin tocar el router; los dos
    juegan con el ping al servidor. Para probar con un amigo es lo más simple y lo más justo.
  - **Tu PC**: tú tienes ping 0 y tu amigo el ping a tu casa. Necesitas abrir un puerto en el router o un túnel.
    Lo más rápido es un túnel de Cloudflare, que da una URL https al instante (los WebSockets pasan sin
    configurar nada):
    ```bash
    npm start                                       # en tu PC
    cloudflared tunnel --url http://localhost:5173  # imprime https://algo.trycloudflare.com → pásasela
    ```

## En el servidor (Ubuntu / Debian), paso a paso

```bash
# 1. Node 22 y git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs git
# 2. Un usuario para el juego y el código
sudo useradd -r -m -d /opt/marea-negra marea
sudo -u marea git clone https://github.com/joeyxd/realms-of-trade-server.git /opt/marea-negra
cd /opt/marea-negra && sudo -u marea git checkout claude/loving-lovelace-ptbif7 && sudo -u marea npm ci --omit=dev
# 3. Configuración (el secreto firma las partidas guardadas: generarlo una vez y no cambiarlo)
sudo cp deploy/marea-negra.env.example /etc/marea-negra.env && sudo chmod 600 /etc/marea-negra.env
sudo sed -i "s/^SAVE_SECRET=.*/SAVE_SECRET=$(openssl rand -hex 32)/" /etc/marea-negra.env
# 4. Servicio (arranca solo y se reinicia si cae)
sudo cp deploy/marea-negra.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now marea-negra
curl http://127.0.0.1:5173/status        # jugadores, tick, ms por paso
journalctl -u marea-negra -f             # registros
```

Para **entrar**, una de dos:

- **Sin dominio (lo más rápido)**: en `/etc/marea-negra.env` pon `HOST=0.0.0.0`, abre el puerto
  (`sudo ufw allow 5173/tcp`), `sudo systemctl restart marea-negra` y entrad los dos a `http://IP-DEL-SERVIDOR:5173`.
- **Con dominio y HTTPS** (mejor: algunos navegadores limitan páginas http): apunta un registro A a la IP, instala
  Caddy (`sudo apt-get install -y caddy`), copia `deploy/Caddyfile` a `/etc/caddy/Caddyfile` con tu dominio,
  `sudo systemctl reload caddy`, abre 80 y 443 y entrad a `https://tu-dominio`. Pon tu dominio en `ORIGINS`.

**Actualizar** a lo último de la rama: `sudo -u marea bash /opt/marea-negra/deploy/update.sh` (trae, instala,
reinicia y muestra `/status`). Las partidas guardadas viven en el navegador de cada jugador, firmadas con
`SAVE_SECRET`: sobreviven a los reinicios mientras el secreto sea el mismo.

## Variables

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` / `HOST` | 5173 / 0.0.0.0 | Dónde escucha (`127.0.0.1` detrás de Caddy) |
| `MAX_PLAYERS` | 4 | Jugadores a la vez |
| `BOTS` | 3 | Bots en la isla (se apartan cuando entran jugadores) |
| `SAVE_SECRET` | aleatorio (aviso) | Firma las partidas guardadas |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | sin configurar | Adaptador durable; ambos juntos, clave de servicio privada |
| `SUPABASE_PUBLIC_KEY` | sin configurar | Activa cuentas; solo publishable o JWT anon, publicado en `/auth/config` |
| `ORIGINS` | (cualquiera) | Lista de orígenes permitidos para el socket del juego |
| `DEV` | 0 | `1` habilita F4 y el teletransporte de `?debug`: **nunca** en un servidor público |
| `LAG_MS` / `JITTER_MS` | 0 | Latencia artificial para pruebas |

## Cuentas y almacenamiento (M5 P1–P2)

El entrypoint carga el `.env` local de la raíz del repo si existe; las variables del proceso tienen prioridad.
Ese archivo y `.env.*` están ignorados por Git. Los nombres de este servidor son `SUPABASE_URL`,
`SUPABASE_PUBLIC_KEY` y `SUPABASE_SERVICE_KEY`; no utiliza el prefijo `NEXT_PUBLIC_` de Next.js.

P1 ya incluye `server/store.mjs` (memoria/Supabase) y `server/migrations/001_store.sql`, probados localmente.
`npm start` selecciona memoria sin `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`; exige ambas si se configura una.
El par anterior sin `SUPABASE_PUBLIC_KEY` selecciona solo almacenamiento y deja cuentas desactivadas de forma
intencional. Añadir la clave pública activa el login del título y la verificación de `hello.token` con Auth.
Configuraciones parciales y claves públicas de tipo secret/service_role se rechazan al arrancar. Las cuentas
usan perfiles del servidor; un token inválido nunca entra como invitado. El Worker conserva sus partidas locales.

Antes de activar un proyecto real:

1. Aplicar `server/migrations/001_store.sql` y luego `002_accounts.sql` en ese proyecto. No se ejecutan automáticamente.
2. Configurar Auth con correo/contraseña y la URL real del juego para los correos de confirmación. Google/Discord
   y recuperación de contraseña aún no tienen UI propia. Mantener HTTPS y configurar `ORIGINS` para esa URL.
3. Conservar `SAVE_SECRET` original para importar partidas anteriores. La opción de importación es voluntaria y
   solo sirve antes de crear el primer personaje de la cuenta; una cuenta existente siempre prevalece, sin mezcla.
   Se exige firma válida e identidad `pirateId`. Partidas antiguas sin identidad se rechazan explícitamente.
4. Comprobar en el servicio real login, confirmación, perfil tras reiniciar, rechazo de acceso RLS/RPC con clave
   pública, duplicados y fallo del proveedor. `/status.storage.accounts` indica activación, no acredita esas pruebas.

La importación registra una identidad legacy única en la misma transacción que crea el perfil. Todas las versiones
firmadas de ese pirata quedan retiradas del flujo invitado del servidor con cuentas activas. La reserva de invitados
y cuentas cubre un solo proceso: no ejecutar varios hosts hasta implementar leases P5. El JSON de economía y el
ledger de perlas todavía no están conectados a persistencia; P3/P4/P6 siguen pendientes.

Las migraciones ya se aplicaron al proyecto local configurado por el autor. Un canario aislado comprobó
confirmación Auth, login por contraseña, permisos y perfil tras reiniciar; entrega de correo y despliegue
siguen pendientes. El registro/reenvío solicitan `emailRedirectTo` con el HTTP base del juego: añadir esa URL
en Auth → URL Configuration (desarrollo: `http://localhost:5173/`; producción: la URL HTTPS del juego).
El selector cambia nombre/aspecto de esta partida; todavía no sincroniza esos ajustes entre dispositivos.
Evidencia: [D07c UI y canario real](delivery/d07c-comic-account.md). Contrato previo y límites:
[D07a almacenamiento](delivery/d07a-store.md), [D07b cuentas](delivery/d07b-accounts.md).

Para el mundo persistente de M5 (personajes,
inventario, perlas únicas, economía, barcos), la propuesta es **Supabase**: Postgres con Auth (cuentas), Realtime
para chat y presencia (en lugar de Redis) y almacenamiento. El combate sigue en nuestros procesos Node. Solo el
servidor escribe en las tablas del juego, con la clave de servicio; el cliente solo lee lo público (reglas RLS).
Cuando haga falta un gateway y servidores por zona, irán en un repo o en una carpeta `services/` de este. Ver
`DESIGN.md` §16 y `docs/HANDOFF.md`.
