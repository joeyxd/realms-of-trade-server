# W02a — cuenta y wallet con prueba de control

Fecha: 2026-10-07. **Backend implementado, integrado por opción explícita y verificado localmente.
Sin wallet de navegador, RPC/testnet, contratos, mint, pagos ni despliegue.**
[Brief/contrato](../briefs/w02a-wallet-link.md), [plan Web3](../../PLAN-WEB3.md),
[evidencia y hashes](w02a-wallet-link-evidence.json).

## Resultado

Una cuenta autenticada solicita un reto, lo firma con una clave EVM y vincula la dirección.
El servidor obtiene la cuenta mediante Supabase `getUser`; el body no elige la identidad.
El mensaje SIWE fija cuenta, origin, URI, red, nonce, fecha y caducidad. Se acepta el mensaje exacto
persistido y la firma ERC-191 cuya dirección recuperada coincide con la solicitada.

El reto dura cinco minutos por defecto (configurable entre 30 y 600 segundos), se guarda antes de
publicarlo y permite un intento autorizado. Firma/mensaje incorrectos consumen ese intento; otra
cuenta no puede consumirlo. Completar escribe vínculo y recibo juntos. La base de datos comprueba
de nuevo la caducidad después de adquirir los locks, usando su reloj.

Cada cuenta tiene un vínculo y cada `(chainId,address)` una cuenta, sin overwrite ni revinculación.
La firma prueba control de clave; no comprueba tokens, saldo, código en red ni propiedad/uso de equipo
o parcelas. No autoriza compras. ERC-1271, unlink/rebind y sesión de juego por firma siguen pendientes.
La implementación sigue el alcance EOA de [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361), usando
`createSiweMessage` y recuperación de firma de viem `2.57.3`, fijado en package/lock.

## Integración y recuperación

`createGameServer({walletLink: service, resolvePlayer})` monta las rutas antes del fallback estático:

| Ruta | Entrada / salida | Autoridad |
|---|---|---|
| POST `/web3/wallet/challenge` | `{address,chainId}` → reto exacto | Bearer validado y Origin configurado exacto |
| POST `/web3/wallet/verify` | `{challengeId,message,signature}` → vínculo o rechazo fijo | Misma cuenta; consume intento válido de DTO |
| GET `/web3/wallet/link` | `{ok:true,link}`; link puede ser null | Bearer validado; Origin distinto/cross-site rechazados |

GET puede omitir Origin, como fetch del mismo sitio; no usa cookies para autenticar. Respuestas
no-store, sin wildcard CORS. JSON máximo 4096 bytes, lectura máxima cinco segundos, esperas de
auth/backend a doce segundos y RPC a diez con AbortSignal. Errores privados no se publican.
Origin/red vienen del operador, no de Host/Forwarded ni del mensaje cliente.

Tras perder issue, solicitar la misma dirección/red devuelve el reto pendiente exacto. Tras perder
complete, consultar el vínculo recupera el resultado. Repetir firma devuelve `used`, sin volver a
escribir. Timeout no demuestra rollback; no hay reintentos automáticos.

`server/migrations/web3/002_wallet_link.sql` es opcional y funciona sin W01/SQL del juego. Tablas
privadas, cuatro RPCs solo service_role y locks challenge → cuenta → dirección; mutadores requieren
read committed. DML/TRUNCATE directo denegado. Índices únicos protegen nonce, pending/cuenta,
vínculo/cuenta y vínculo/red/dirección. Reapply conserva datos/permisos W01. No guarda bearer, firmas o claves.

`walletContract.mjs`, `walletStore.mjs`, `walletLink.mjs` y `walletHttp.mjs` separan DTO, persistencia,
verificación y HTTP. Memory es **no durable**, solo desarrollo/pruebas. Supabase requiere cliente service
separado del Auth público existente. `npm start` sigue sin montar la opción. Sin cambios a host,
perfiles, inventarios, escrituras, WS ni protocolo.

## Evidencia local

**29/29 nuevas**, cero failed/cancelled/skipped/todo:

```powershell
node --test tests/web3-wallet-link.test.mjs tests/web3-wallet-http.test.mjs tests/web3-wallet-sql.test.mjs tests/web3-wallet-integration.test.mjs
```

Firma EOA real de clave pública de prueba; mensaje/dominio/URI/red/cuenta alterados, firma incorrecta,
replay, cuenta cruzada, caducidad y overwrite rechazados. HTTP real y `getUser` simulado; guest/anon,
spoof, UTF-8 inválido, tamaño/métodos/content-type y errores fijos. Timeouts RPC/HTTP/body y peer abort
comprobados; una request RPC sin repetición automática tras timeout.

Supabase SDK/PGlite local aplica migración/roles reales del motor de prueba. Respuestas issue/complete
perdidas tras escribir se recuperan; reapertura de app/almacenamiento conserva vínculo y rechazo de replay.
Perfil existente conserva data/versión; activo W01 conserva dueño/versión/contenido. Rollback no separa
vínculo/recibo. Reapply conserva SELECT de W01. PGlite serializa sus solicitudes concurrentes.

**61/61 de regresión seleccionada**:

```powershell
node --test tests/web3-asset-registry.test.mjs tests/web3-asset-registry-sql.test.mjs tests/web3-asset-registry-process.test.mjs tests/web3-asset-registry-boundary.test.mjs tests/web3-equipment-content.test.mjs tests/items.test.mjs tests/accounts-server.test.mjs tests/account-auth.test.mjs
```

Total: **90/90**, Node `v24.14.0`; no es toda la suite del checkout. Revisión independiente seguida de
verificación del principal. Inventario Unreal/FAB contrastado: este contrato no necesita arte.

## Límites y siguiente corte

No es prueba Supabase live, extensión de wallet, dispositivo ni contención multiconexión PostgreSQL.
Docker instalado sin daemon activo; no se inició infraestructura. Reapertura es una instancia nueva
de app/PGlite en el mismo proceso de prueba, no failover entre hosts. No hay red elegida.
El deadline HTTP no cancela operaciones arbitrarias del resolver/service; el resolver de entorno
existente acota su fetch Auth y el adaptador RPC envía AbortSignal. Una respuesta incierta exige consulta.

W02 permanece parcial: UX de wallet/testnet, adaptador RPC, ERC-1271 y verificación remota pendientes.
W03/W04 requieren además custodia/uso/proyección y reglas de pérdida/escritura. Vincular no activa
mercado ni modifica automáticamente activos actuales de jugadores. Sin SQL live, publicación ni deploy.
