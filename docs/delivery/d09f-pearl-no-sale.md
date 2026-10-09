# D09f-2b.38 — perlas encontradas, venta a NPC retirada

Base b9d13d465bf24de0a221709be99c00fc7dcf57de, 2026-10-09.
[Contrato](../briefs/m5-pearl-no-sale.md) y [dirección marina aceptada](../briefs/m48-sea-salvage-direction.md).

## Resultado local

El intento antiguo de vender una perla devuelve notForSale, incluso junto a Tía Perla, sin quitarla,
retornarla a playa o pagar oro. Mantiene export/ruta legacy para una denegación explícita; conserva
el preflight de reservas actual. No inicia un request de storage ni cambia recibos históricos.

Se elimina PEARL.value y la salida de precio del diagnóstico de balance pasa a npcTrade:false.
Panel: sin botón/instrucciones de venta; solo envía tragar/dejar/entregar, con tragar bloqueado
mientras haya una dentro. Denegación en español; evento histórico sell no produce monedas,
ganancia ni mensaje falso de dejar en el suelo. Vendor de objetos/pociones sigue disponible.

La propuesta del autor queda guardada en M4.8/M5 y su brief: pistas en el mar, colocación de balsa,
recuperación corta con tensión, materiales/tesoros frecuentes y perlas raras; después pesca manual
y buceo. Todavía no implementa el salvamento ni fija probabilidades, costes o dificultad.

## Evidencia

**345/345** seleccionadas en **16 archivos**, sin fail/cancelled/skipped/todo, Node v24.14.0,
concurrencia 2, 54.466,6055 ms de test runner. Incluye **14 casos nuevos**, no se suman al total.
Checkout compartido con **647 archivos runtime/tests/manifiestos/herramientas fingerprint SHA256
UTF-8 normalizado a LF estables durante ejecución**; no se presenta como archivo Git aislado.
Los mismos 647 fingerprints coinciden con el índice preparado exclusivamente para este corte;
ediciones paralelas posteriores quedan fuera. Log/proof completos en shots/review/m5-pearl-no-sale;
[resumen/hashes](d09f-pearl-no-sale-evidence.json).

Nuevas pruebas: cuatro tipos, vendor/lejos/combate, bag/swallowed/UID desconocido, replay/falta
de perfil, identidad/contenido de holdings/drop/ledger existentes, ECS/RNG/allocator/dirty.
CMD real de LocalServer con dos clientes: denegación privada al emisor, perfil/payload de guardado
sin cambios. Ese adapter local usa payload serializado; no se afirma un nuevo canario Auth/HMAC/DB.
Rewards: mensaje actual, evento sell sin sonido/float/toast y feedback give/leave conservado.

Regresión de circulación/poder/muerte, comandos/tick, staging swallow/leave/pickup/return, request
gestionado y vendor ordinario. Cuatro casos SDK/SQL de pickup/return sobre PGlite con SQL001–013
existentes; son regresión local, no Supabase live ni restart real del host.

Chrome **2/2** fixtures de panel, escritorio 1280×1000 y móvil emulado 390×844; módulos reales
CharPanel/pearlHtml/Rewards, CSS/Three/GSAP locales. Seis capturas inspeccionadas, incluidos footers
móviles; textos/acciones visibles con scroll, sin desborde horizontal, cero errores runtime y requests
externos. Click/touch emite swallow/leave/give; botón antiguo y slot ligado no envían venta/otra swallow.
El primer pase del fixture omitía me:true en Rewards y falló una aserción de toast; se corrigió el fixture,
sin cambiar runtime por ese diagnóstico. Ambos pases posteriores completos fueron satisfactorios.
No es recorrido del juego completo ni aceptación física/FPS móvil.

GPT-6 Luna hizo inventario/revisión y escribió el archivo nuevo de pruebas; el principal leyó los
candidatos y cambios, ejecutó la cohorte y el navegador e inspeccionó todas las capturas.
Unreal read-only: BP_InventoryComponent 24.878.603 B, BP_VendorMain 482.913 y VendorItems 7.737.
Referencias Blueprint sin necesidad de export: se reutilizan denegación/helper/panel existentes,
sin arte nuevo ni modificación de fuentes Unreal. Trabajo paralelo fuera del corte preservado.

## Lo que sigue

Componer lifecycle de pickup/return y startup con el dueño de tick y sus gates. Creación de UIDs
gestionados, dominio/reloj, política offline/crash, autoridad/leases, afinidad y finalizador siguen abiertos.
El salvamento marino necesita un corte propio; la red pasiva no genera perlas.

Sin SQL nueva, env/secrets, Supabase real, protocolo, activación del lifecycle, push o despliegue.
M5 P4/P6 siguen parciales. La venta/oro durable anunciada en .37 queda retirada por decisión del autor.
