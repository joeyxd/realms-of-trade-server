# Alfa continuo en el VPS — 2026-10-09

Desplegado y verificado en **https://marea.62.171.136.148.sslip.io**. La dirección provisional tiene HTTPS válido y WebSocket público. No depende de que el PC permanezca encendido. El dominio definitivo queda por elegir/configurar; cambiar el origen afecta a los slots de invitados en el navegador.

## Versión y autoridad

- Runtime exacto: `5fa9658b5f2265bd1ea8c58b3e59722fcbe4603d`, `0.6.0-alpha.16`, protocolo 32.
- Imagen activa: `sha256:47fde459d5d2f9a43663f2f34b57c33d17ba7caf3b595903f64d2f6ba5ca1bb4`, tag `marea-negra:alpha-5fa9658`.
- Proyecto Compose: `marea-negra-alpha`; un contenedor para `WORLD_ID=marea-negra`. Supabase existente, sin wipe ni migraciones nuevas.
- Archivado desde Git: SHA256 `3f854879c111750b44181be2201bb8175ef472da0da68eefe19155419d17a3b3`. Se excluyeron cambios dirty de otros agentes.
- Node 22 con imagen base fijada por digest; usuario `node`, filesystem de solo lectura, límite de 1 CPU/1 GiB, sin swap adicional, 128 procesos, heap 640 MiB, cierre de 90 s y reinicio `unless-stopped`.
- Traefik/Coolify existentes, router propio y sin puerto de juego público en el host. Credenciales allowlisted en `/etc/marea-negra/alpha.env`, modo 0600. Se preservó `SAVE_SECRET`; Web3 sigue apagado.

No ejecutar simultáneamente el lanzador del PC u otro host con este mundo/cuentas. Las reservas M5 siguen siendo de un proceso. Este despliegue no añade una segunda autoridad de perfiles ni monta el harness comunitario A1a.

## Verificación real

| Comprobación | Resultado |
|---|---|
| HTTPS, redirección HTTP y salud pública | TLS válido, 301 a HTTPS, `/health` 200 |
| Cuatro clientes WSS desde el equipo operador | 4 admitidos, 6.888 comandos, 2.449 snapshots posteriores al welcome, chat 4/4, cero errores/desconexiones inesperadas |
| Muestreo de 30 s | `stepMs` mediana 2,525 ms; p95 de muestras 3,271 ms; máximo 3,436 ms |
| Recursos del contenedor durante la sonda | CPU media 26,09 % de un núcleo, máximo 46,29 %; memoria 57,31–64,52 MiB |
| Cuenta temporal real | Confirmación sin enviar correo, login con clave pública y token verificado por el servidor |
| Permisos | RPC de perfil denegada al cliente autenticado; archivos privados 404 |
| Gameplay normal, sin DEV ni inyección de inventario | Recoger tronco y piedra, procesar madera y fabricar hacha de piedra; perfil guardado v6 |
| Reinicio real del contenedor | Cierre código 0, sin OOM; checkpoint económico v385 restaurado; misma cuenta recuperó hacha y mochila |
| Chrome sobre la URL pública | Invitado conectado, minimapa y mapa grande abiertos, sin errores JS ni requests fallidos |
| Limpieza | Solo perfil/usuario Auth temporales eliminados; contenedor de medición aislado eliminado |

El muestreo usa el `stepMs` suavizado que publica el host; su p95 no es un percentil de todos los ticks. Esta evidencia permite arrancar el alfa de cuatro jugadores. No acredita miles de jugadores, resistencia prolongada, móviles físicos ni todos los casos de recuperación.

## Persistencia y límites

Los perfiles de cuenta usan el `ProfileSessions` de M5 y Supabase CAS. El canario acredita el flujo de materiales/hacha y un reinicio ordenado. La economía conserva snapshots cada 60 s y al cerrar; guardado de perfil y economía no forman una transacción general, y una caída abrupta puede perder cambios recientes. Invitados conservan su slot firmado en su navegador, ligado al origen.

El agotamiento/cooldown de recursos y actores vivos se reinicializan con el proceso. El arranque normal no monta aún el lifecycle durable de perlas, muerte ni botín de suelo. Los proyectos de pueblos y aportes A1a siguen aislados; su integración debe pasar por la autoridad M5. La prueba de confirmación de cuenta por API no acredita que los correos de registro redirijan a esta URL provisional: eso depende del allowlist de Supabase Auth.

El siguiente trabajo mecánico debe reutilizar esta partida y coordinar persistencia con el dueño M5, según [la frontera de autoridad](../briefs/a1-m5-authority-boundary.md). El despliegue por sí solo no activa esas integraciones pendientes.

## Evidencia y operación

[Runbook de instalación, actualización y rollback](../DEPLOY-VPS.md). La actualización prepara una release nueva y detiene ordenadamente la autoridad anterior antes de arrancar la siguiente; no usar blue/green con este mundo.

Evidencia sin credenciales: [despliegue](vps-alpha/deployment.json), [capacidad](vps-alpha/capacity.json), [recursos](vps-alpha/resources.json), [persistencia de cuenta](vps-alpha/persistence.json), [reinicio](vps-alpha/restart.json), [navegador](vps-alpha/browser.json) y [captura del mapa público](vps-alpha/public-map.png).
