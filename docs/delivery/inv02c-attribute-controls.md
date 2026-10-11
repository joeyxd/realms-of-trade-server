# AREA03 INV02c — Carga desde la ficha ES/EN

[Contrato](../briefs/inv02c-attribute-controls.md). Implementado localmente en alpha.46/protocolo 52;
publicación y aceptación pública pendientes en este checkpoint. Usa SQL029 ya instalado, sin SQL nuevo.

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

Comando: `node --test --test-concurrency=1 tests/attribute-client.test.mjs tests/attribute-operation.test.mjs tests/attribute-authority.test.mjs tests/attribute-profile.test.mjs tests/attribute-controls.test.mjs tests/attribute-operations-sql.test.mjs tests/freshwater-sql.test.mjs tests/workshop-ui.test.mjs tests/ground-workshop-compatibility.test.mjs`.
Los conteos de entregas anteriores se solapan. La prueba móvil es emulada, sin afirmación de rendimiento físico.

## Siguiente corte

INV02d: conectar el sobrepeso calculado a caminar/correr/dash y a la información de la mochila,
con reglas idénticas en simulación autoritativa y predicción, sin borrar carga ni bloquear la recuperación.
El balance de fuerza/mochilas, party, flotabilidad y supervivencia conservan sus cortes propios.
