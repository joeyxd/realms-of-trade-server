# AREA03 INV02c — Carga en la ficha del personaje

Sigue a [INV02b](inv02b-durable-attributes.md). El corte monta controles ES/EN en la pestaña
«Atributos» existente, accesible con C o desde la mochila. Reutiliza el mismo recibo M5/SQL029;
no necesita otra migración ni introduce un guardado cliente.

La ficha muestra puntos ganados, disponibles e invertidos, peso actual, volumen, carga cómoda
y techo. La adopción es una acción explícita para personajes anteriores, también en nivel uno.
Los personajes con mochila del taller conservan mochila/objetos; el pack anterior de volumen
10 adopta la mochila básica de 18. El peso base adoptado es 50; cada punto añade 4 al cómodo y
5 al máximo. Se asigna un punto por acción y la única reasignación gratuita pide confirmación.
Su bloqueo explica si faltan puntos, ya fue usada o es necesario descargar hasta 50.

Cada solicitud conserva un opId y payload inmutables. La ficha espera ACK privado y perfil
confirmado; un timeout no equivale a fallo. Reintentar después de cinco segundos conserva la
misma solicitud. Cerrar/cambiar de pestaña no cancela una operación. La reconexión carga el
perfil del servidor y descarta el estado de interfaz de la sesión anterior. Un recibo histórico
no instala un perfil antiguo. El cliente nunca altera puntos/capacidades desde el ACK.
Un éxito sin indicador de durabilidad no se da por confirmado; el host de desarrollo en memoria
identifica el cambio como válido solo para esa sesión, sin afirmar persistencia tras reiniciar.

El WELCOME privado anuncia disponibilidad solo para el humano autenticado admitido con
el flag y mundo listos. Solo, invitados e instalaciones apagadas permiten consulta sin botones
activos. Protocolo 52/alpha.46 requiere recargar peers; no cambia el DTO de perfil. La frontera
de agentes gestionados conserva su permiso/control y comandos admitidos actuales; habilitar una
acción nueva para la mente requiere su propio corte, no autorizar CMD crudo desde esta ficha.

La integración conserva SQL030: el candidato de Carga admite el campo opcional de cubeta
estricto, cuenta su peso/volumen y conserva exactamente recipiente/agua. Campos presentes
inválidos o barriles en la mochila se rechazan. Se comprueban host, recibos, cliente y controles.

Reutilización: revisión acotada de [D06-REUSE](../research/unreal-assets/D06-REUSE.md) y la ficha,
mochila y estilos de panel existentes. No requiere modelos/texturas/iconos nuevos; los widgets
UMG de inventario no son portables al navegador. Fuentes Unreal intactas.

Aceptación: controles reales con ratón/toque emulado en escritorio, vertical y horizontal ES/EN;
estados pendiente, confirmado y rechazado; orden perfil/ACK, retry exacto, reset y legado;
canario de navegador autenticado en la única autoridad pública, cuenta desechable y recibos
conservados. La evidencia distingue fixtures locales, pruebas de contrato y operación pública.
Lentitud/dash por sobrepeso, supervivencia, party y flotabilidad quedan en cortes posteriores.
