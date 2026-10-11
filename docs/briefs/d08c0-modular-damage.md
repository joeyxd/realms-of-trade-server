# D08c.0 — casco modular, estado operativo y contacto

2026-10-06. El autor pide HP por pieza y destrucción de bloques funcionales, con referencias Cosmoteer y
Space Engineers. Reserva el playtest humano conjunto para después de completar estructura/features.
Este corte implementa la base en la bahía; el puente de autoridad D08c conserva sus dependencias.

## Contrato implementado

- Una instancia tiene ID y HP propios. El plano conserva las piezas destruidas; la lista operativa las
  excluye. La barra de casco suma HP actuales/máximos de flotadores, no crea otra reserva de vida.
- HP máximos reutilizados de `RAFT_PARTS`: cimiento 60, vela 40, caja 15; cada tipo conserva su definición.
  Mientras HP > 0 funciona con su capacidad actual; el deterioro gradual de eficiencia queda pendiente.
- Al llegar a cero, la pieza deja de dibujarse y aportar peso/flotación/vela. Cambiar el centro de masa
  conserva posición y velocidad de puntos fijos del barco; no añade impulso por quitar masa.
- Sin flotadores, `operationalNavalRig` devuelve `rig: null`, `disabled: true`. La bahía detiene pilotaje,
  captura y jettison, mantiene el plano/lastre y muestra el casco inutilizado. Conserva el último rig solo
  como referencia visual; no simula todavía hundimiento o rescate.
- Choque costero por barrido determinista: daño según velocidad entrante perpendicular a la superficie,
  con umbral para roces/maniobras lentas. Contacto parado o presión lenta no drenan HP repetidamente.
  Las constantes experimentales viven en `src/data/navalDamage.js`.
- Círculo conservador del casco y hasta 32 círculos estáticos de costa; máximo cuatro contactos/tick.
  En la bahía hay nueve proxies interiores de las rocas existentes. No son colisión exacta de malla,
  ni incluyen impacto por giro puro. El golpe se aproxima a una casilla flotante viva cercana.
- Impacto/destrucción usan el pool de spray y un sonido procedural acotado. No descargan texturas/audio
  nuevos. Móvil conserva menor emisión; movimiento reducido reduce ráfagas y elimina transición de HP.

IDs del laboratorio se asignan una vez por reset con namespace nuevo y ordinal monotónico. Quitar piezas,
dañarlas o soltar lastre no reasigna IDs. No son identificadores persistentes ni UUID de inventario.
El futuro adaptador de autoridad debe recibir el plano validado y asignar identidad de instancia propia.

## Dirección de diseño y cortes siguientes

La petición del autor es daño modular funcional. Recomendamos que el acomodo ofrezca protección,
redundancia y sacrificios de peso: casco absorbe impactos locales, propulsión/timón/carga son objetivos
distintos. El diseño de vivienda permanece legible aunque su instancia quede averiada. La separación
de plano/estado también aparece en la [explicación del desarrollador de Cosmoteer](https://blog.cosmoteer.net/2016/04/).

| Corte | Comportamiento y dependencia |
|---|---|
| D08c.0 actual | HP/IDs, piezas vivas, pérdida de capacidad, costa y avisos en aislamiento |
| D08c.1–3 | Cuerpo en tick del World, piloto autorizado, ACK/predicción y cubierta móvil; copiar plano sin bienes expuestos primero |
| Soporte estructural | Grafo de conexión al casco: módulos sin soporte se deshabilitan/desprenden; acotar cascadas y conservar plano. No borrar con `sanitizeRaft` |
| Módulos funcionales/combate | Timón, velas/motores y armas según piezas vivas; impactos dirigidos y defensa por distribución. Proyectiles/NPC en D10 |
| Reparación/recuperación | Materiales + misma identidad/slot + retiro de pecio anterior cuando corresponda, con operación durable/idempotente M5 antes de poner bienes reales en riesgo |

Soporte, fragmentos navegables, inundación, blindaje, daño gradual, cajas/botín localizados y reparaciones
no están implementados en este corte. La caja rota no pierde ni duplica mercancía: la bahía solo tiene
lastre sintético separado. Costes, protección del patrimonio, cuotas de recuperación y pérdida real
continúan abiertos en el roadmap; conservar el plano no significa restituir materiales gratis.

## Reutilización FAB revisada

Inventario D08/CANDIDATES más verificación de existencia/bytes el 2026-10-06:

| Fuente | Resultado para este corte |
|---|---|
| `C:\Unreal\MyProject\Content\NiagaraExamples\FX_Weapons\Impacts\NS_Impact_Wood.uasset` · 4.773.771 B | Candidato VFX, no sistema portable de daño. No inspeccionado en ejecución ni exportado. Reservado para una adaptación visual concreta posterior |
| `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes\SM_RepairBench.uasset` · 101.896 B | Prop visual de taller, no reglas de reparación; ya reservado como canario. No hace falta exportarlo para HP/contacto |

Reutilizamos las definiciones HP, renderer/materiales/atlas/caja existentes y pool/audio de la bahía.
El inventario no identificó un sistema naval de daño portable por nombre/ruta. Fuentes Unreal intactas.
No se infiere funcionalidad de los nombres ni se repite el inventario completo.

## Reparto y evidencia

GPT-6 Luna implementó módulos de estructura/cuerpo/contacto y pruebas delimitadas, y revisó integración
en solo lectura. El principal conserva arquitectura, integración de la bahía, revisión visual y aceptación
del código. [Entrega y límites](../delivery/d08c0-modular-damage.md).
