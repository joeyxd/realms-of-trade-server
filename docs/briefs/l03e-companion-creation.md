# L03e — crear un compañero vinculado a la cuenta

2026-10-11. Siguiente corte tras corregir la disponibilidad pública. Antes de conectar un
controlador local hace falta una identidad durable que pertenezca a la cuenta del jugador.

## Recorrido y límites

Desde Mis compañeros se abre Crear compañero: nombre, oficio, personalidad, hasta tres
rasgos y aspecto del catálogo actual; también puede sortear la ficha y revisarla antes
de confirmar. Para el primer piloto se permite uno por cuenta y mundo. El servidor deriva
propietario y mundo de la sesión admitida, genera el UUID del personaje y guarda ficha,
personalidad/objetivos SQL025 y detención SQL027 en una única transacción SQL034.
Reintentar la misma creación devuelve el mismo personaje; otra ficha nunca lo reemplaza.

La ficha creada se recupera al reconectar o reiniciar el host y permite leer los documentos
guardados. Crear no ocupa una plaza, no crea inventario, no conecta un modelo y no concede
acciones. Aparece como preparado y detenido. La conexión sigue pendiente del emparejamiento
revocable: el controlador de la PC abrirá WSS saliente y usará su modelo loopback; el VPS no
recibe URLs locales, credenciales ni acceso al disco del jugador en este corte.

SQL034 añade solo identidad y creación atómica dentro del store M5 existente; no introduce
otro escritor del perfil ni cambia recibos de economía. Instalación/readiness deben verificarse
antes de anunciar creación pública habilitada. Sin SQL listo, el wizard explica disponibilidad.
La ficha permanece privada: otro dueño, invitados y controladores no pueden consultarla.

## Reutilización

Se reutilizan ROLE_TEMPLATES, PERSONALITY_PRESETS, TRAIT_OPTIONS, los documentos y aspectos
de companionTemplates y el panel ingame. No se necesita arte nuevo ni candidatos Unreal/FAB;
se conserva el catálogo del personaje actual y no se accede a esas fuentes.

## Aceptación

- SQL real local: ACL/RLS/readiness, transacción indivisible, retry, conflictos, límites,
  separación de dueños/mundos, reinicio de disco y rechazo de entradas inválidas.
- Transporte real: principal admitido, respuestas privadas, cuenta desconectada/cambiada,
  timeout incierto y recuperación sin duplicar; el personaje no obtiene grant ni perfil.
- Navegador ES/EN escritorio/portrait/landscape: sortear, editar, confirmar, volver, recargar,
  leer documentos y recuperar la misma identidad; inspeccionar capturas.
- Publicar código revisado, verificar SQL/readiness y revisión/imagen/entrada autenticada.
  Registro local o push no equivalen a activación pública. Emparejamiento e inferencia pública
  conservan su próximo corte y aceptación propia.
