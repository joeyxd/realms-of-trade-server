# GM03b2 — activar y recuperar el mundo compartido

Fecha: 2026-10-10. Estado: implementación local; aceptación y despliegue en curso.
[Contrato](../../briefs/gm03b2-content-activation.md).

Online permite guardar la revisión preparada exacta, elegir una revisión guardada o el mapa base,
revisar la selección y activarla cuando no hay personajes ni entradas/guardados pendientes.
Los clientes nuevos cargan los modelos y círculos publicados antes de entrar. Una pestaña antigua
recibe el aviso de recargar; el editor abierto conserva su diseño y permite terminar el trámite HTTP.

El registro vive en `/opt/marea-negra/content`, separado del estado económico M5 de Supabase.
Retiene documentos y bytes por hash; puntero y recibo se guardan juntos con CAS, rename y fsync.
Un reintento usa el mismo ID de operación incluso después de perder la respuesta o reiniciar.
Rollback cambia contenido; nunca restaura perfiles, inventarios, relojes o progreso.

GameHost pausa admisión/simulación/guardado durante la transición y exige almacenamiento sano,
sin personajes, joins u operaciones pendientes. Verifica corredores protegidos, checkpoints,
viajes/barcos guardados, atraques y objetos persistentes del suelo. El mapa conserva recursos y terreno;
solo reemplaza decoración y colisiones estáticas, incluido su índice espacial.

Los navegadores reciben la base exacta enlazada por los hashes de la revisión. Primero comparan su
generación local, permitiendo únicamente ruido numérico de hasta `1e-6`; después verifican los hashes
y adoptan los arrays exactos del servidor. La aceptación detectó diferencias Node/Chrome de hasta
`1.4210854715202004e-14` en 43 números: rechazar hashes locales exactos impedía abrir un cliente nuevo.
No se redondean documentos, assets ni hashes. Los cambios estructurales o mayores siguen rechazados.

La exclusión Linux `flock` se comparte con el actualizador. Este verifica la imagen candidata sin red
y con volumen en solo lectura antes de detener la autoridad. Código incompatible con una revisión
activa impide actualizar: activar base primero. Los modelos candidatos de arte pueden prepararse y
guardarse, pero no activarse. Reutiliza `prop:storage-crate` integrado; fuentes y originales intactos.

Límites: 100 revisiones, 1 GiB de blobs, 4096 recibos; sin borrado automático. Escaneo de hasta 4096
perfiles y filas por clase de objeto; error o límite impide activar. Corredores conservadores, sin
garantizar conectividad completa de toda la isla. Sin terreno, superficies caminables nuevas ni
edificios funcionales. La migración de revisiones entre runtimes queda pendiente.

La prueba local usa autenticación y almacenamiento de gameplay simulados, etiquetados en evidencia.
La prueba pública utiliza la autoridad y Supabase existentes; restaura el puntero anterior y el borrador
por CAS, conserva los recibos y la revisión canaria. Pendiente anexar sus resultados finales.
