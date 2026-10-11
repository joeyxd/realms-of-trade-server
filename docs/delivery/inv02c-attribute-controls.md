# AREA03 INV02c — Carga desde la ficha ES/EN

[Contrato](../briefs/inv02c-attribute-controls.md). Implementado, publicado y comprobado en navegador
público en alpha.46/protocolo 52. Usa SQL029 ya instalado, sin SQL nuevo.

La pestaña «Atributos» permite adoptar Carga, asignar un punto y confirmar la única reasignación
gratuita. Muestra puntos, peso y volumen, límite cómodo y máximo; explica los bloqueos por peso,
puntos o reset usado. La adopción conserva objetos/mochila y los packs legacy tienen conversión explícita.
Los cambios esperan recibo privado y perfil canónico; retry conserva el payload/opId. El WELCOME
solo habilita acciones para el humano autenticado admitido con la función activa y el mundo sano.
Invitados/solo pueden consultar. Se conserva la frontera de permisos de agentes gestionados.

La integración admite la cubeta estricta de SQL030 en el candidato de atributos y conserva su agua,
peso y volumen al adoptar/asignar/resetear. El perfil no se modifica desde el ACK. Un host de desarrollo
en memoria muestra confirmación de sesión; la interfaz no lo presenta como guardado durable.

## Evidencia local

- [Pruebas focalizadas](inv02c-tests.txt): **67/67**, nueve archivos, controles/cliente, host,
  plan/perfil, SQL029/030, taller y composición con journal común. Incluye cubeta y agua conservadas,
  perfiles legacy, ACK fuera de orden, retry exacto, no-op/denegación, reset y permisos WELCOME.
- [Navegador fixture](inv02c-ui/20261011T050621Z/evidence.json): **24 casos, 10 comprobaciones de
  escenario, 18 capturas**, ES/EN, desktop 1280×720, portrait 390×844 y landscape 844×390, ratón/toque
  emulado. Capturas inspeccionadas; botones de al menos 44 px y scroll del panel. Importa CharPanel/
  AttributeControls/plan reales, pero reemplaza perfiles en un fixture y no acredita host ni almacenamiento público.
- `git diff --check` y sintaxis de entradas/herramientas sin errores. La revisión final añadió una
  distinción textual para recibos no durables, verificada en las 67 pruebas; no cambia el flujo visual durable.
- [Integración concurrente](inv02c-integration.txt): **32/32**, host/cliente de atributos, host de agua
  y ciclo de perlas de suelo. Merge `1d701a4` conserva los cambios de terreno, suelo y Brisa de upstream
  `404013f`; la única superposición de runtime fue `server/host.mjs`, revisada antes de las pruebas.

Comando: `node --test --test-concurrency=1 tests/attribute-client.test.mjs tests/attribute-operation.test.mjs tests/attribute-authority.test.mjs tests/attribute-profile.test.mjs tests/attribute-controls.test.mjs tests/attribute-operations-sql.test.mjs tests/freshwater-sql.test.mjs tests/workshop-ui.test.mjs tests/ground-workshop-compatibility.test.mjs`.
Los conteos de entregas anteriores se solapan. La prueba móvil es emulada, sin afirmación de rendimiento físico.

## Publicación y aceptación pública

Código `843cde8`, integración `1d701a4` y runtime aceptado **`2a51c8d90c8ffcd75f81c749d82f5ec8e1cdae4e`**.
El actualizador normal de la rama `claude/loving-lovelace-ptbif7`, PR #1, instaló alpha.46 el 11 de octubre
de 2026 a las 05:22:55 UTC. [Validación de imagen](inv02c-updater.json): **127/127** sin red;
imagen `sha256:87934ad36f3b603d5554663ffc6767a4cb5d66d5dce79b801d82281bf38f45d6`.
Se conservan SQL/secretos/activaciones y la única autoridad del VPS; sin reinicio forzado ni réplica.

[Navegador autenticado](inv02c-public/20261011T052326Z-browser/acceptance.json): **6/6**, cero errores
de página, cinco capturas. Login normal y pestaña C/Atributos real; adopción 22→50, asignación 50→55,
confirmación/cancelación del reset y reset 55→50. Cada acción confirmada se comparó contra perfil y
recibo SQL. Recarga, nuevo ingreso y reapertura desde mochila conservaron `attr:{v:1,carga:0,re:1}`,
volumen 18, tres tablas y cubeta con tres unidades de agua (masa total 13, volumen 11).
Cuenta Auth/perfil desechables retirados; **tres recibos inmutables conservados**. No acredita reinicio
de proceso, SIGKILL ni todo el circuito de recolección de agua; sus pruebas previas conservan su alcance.

[Autoridad fija antes/después](inv02c-public/20261011T052326Z-browser/authority.ndjson): locks del
actualizador y contenido, revisión/imagen exactas y **21 hashes de la imagen iguales a Git**. Supabase
durable, atributos/agua enabled/ready, cero jugadores/sockets/errores/guardados pendientes al cerrar,
timer activo. Capturas públicas desktop ES y portrait EN confirmación/reconexión inspeccionadas;
portrait público es viewport redimensionado, el toque emulado se verifica en el fixture local.

## Siguiente corte

INV02d: conectar el sobrepeso calculado a caminar/correr/dash y a la información de la mochila,
con reglas idénticas en simulación autoritativa y predicción, sin borrar carga ni bloquear la recuperación.
Reglas ya aprobadas en `PLAN-PROGRESSION.md` §15.7 del checkout IDE compartido: hasta el cómodo
normal; por encima del cómodo y hasta su 125 %, velocidad al 70 % y sin dash; por encima, al 40 %,
sin recoger/comprar más. Nunca inmoviliza. Cómodo 40 + 4/punto y techo 50 + 5/punto. No son propuestas
nuevas ni efectos implementados por INV02c. Compartir el cálculo en `stepMover` y preservar el modelo
de natación; verificar replay del predictor y estados ES/EN en `packInventory`.
El balance de fuerza/mochilas, party, flotabilidad y supervivencia conservan sus cortes propios.
