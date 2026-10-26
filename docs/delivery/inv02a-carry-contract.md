# AREA03 INV02a — contrato de Carga preparado

2026-10-10. [Reglas, límites y siguiente integración](../briefs/inv02a-durable-carry.md).

Implementado: lectura estricta de atributos y cálculo puro para invertir puntos de nivel en Carga
y devolverlos una sola vez. Conserva volumen y mercancías; valida revisión, presupuesto, peso,
forma del comando y compatibilidad de la capacidad anterior. El éxito cambia únicamente atributos,
masa máxima del pack y revisión de comercio en una copia del perfil.

El código está **sin montar**: ningún host, UI, protocolo, carga de perfiles ni escritura lo importa.
La capacidad y el movimiento públicos siguen con sus reglas actuales. No hay hambre/sed, SQL nuevo
ni ACK durable de atributos en esta entrega.

Validación focal: **11/11** con `node --test tests/attribute-plan.test.mjs`.
Selección conjunta **21/21**, incluidos carry, baseline del taller y timing de Tala; conteo solapado.
Revisión independiente de contrato y aceptación por el principal, sin bloqueos pendientes.
No se atribuyen al módulo replay de almacenamiento, reinicio, Supabase ni aceptación de gameplay.

Continúa con la operación M5 correlacionada y la adopción explícita de perfiles, preservando el
baseline exacto de los beneficiarios offline de Tala. Después UI ES/EN y movimiento compartido.
