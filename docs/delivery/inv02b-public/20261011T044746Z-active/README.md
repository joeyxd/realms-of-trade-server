# INV02b — aceptación después de integrar agua dulce

Canario autenticado público del 2026-10-10, 22:47–22:48 America/Mexico_City
(2026-10-11 04:47–04:48 UTC). [Resultado 5/5](acceptance.json) y
[autoridad fija antes/después](authority.ndjson).

Revisión `80e46df8ca4664f93aa59df8350c27cc17589b53`, alpha.44/protocolo 50,
imagen `sha256:b883545f9317c7ba3ed03e7e0ec5d27c62a997b3d0a8c717504980e3f338f353`.
El actualizador normal instaló la entrega paralela de agua dulce después de la
[activación inicial de Carga](../20261011T044137Z-activation/activation.ndjson).
Se repitió la aceptación porque esa entrega cambia host, saneado de inventario y protocolo.

14 archivos de imagen coinciden con Git. Locks del actualizador/contenido durante el
canario; una autoridad Supabase durable, Carga habilitada/lista, cero jugadores,
errores o guardados pendientes antes/después. Timer conservado activo. El estado también
reporta freshwater habilitado/listo; este canario no acepta sus recorridos de gameplay.

Perfil temporal nivel 3: adopción (masa 50), asignación de dos puntos (60), reset (50),
volumen 18 constante. Replay histórico sin rollback, revisión atrasada rechazada con
recibo durable sin bloquear la autoridad, igualdad base/snapshot y reconexión. Los checks
distinguen entrada inicial y reconexión. Cuenta Auth/perfil retirados; cuatro recibos
conservados de esta corrida. El replay reutiliza el recibo original.

La herramienta admite los protocolos revisados 49/50, exige igualdad exacta con la versión
local y pública, y ahora comprueba cada límite de masa y volumen. Comando ejecutado:

```powershell
$env:MN_QA_ALLOW_PUBLIC='1'
node tools/qa-attributes-public.mjs --env-file <entorno-privado> --out <directorio-nuevo> --active
```

La prueba usa comandos reales, no una pantalla de asignación. UI INV02c, sobrepeso/dash,
caída de VPS, teléfono físico y balance siguen fuera del alcance.
