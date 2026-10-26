# GM03b2 — revisiones guardadas, activación y rollback

Fecha: 2026-10-10. Continúa GM03b1 por autorización del autor; contrato previo al código.

Online registra la revisión preparada exacta, conserva sus bytes y permite activar una revisión guardada
o volver a la base. La activación exige mundo sin jugadores ni entradas pendientes, almacén M5 sano y
sin operaciones en vuelo. Nunca expulsa personajes ni restaura inventarios, economía o progreso.
Las pestañas que miran el título/editor deben recargar para entrar con la revisión nueva.

## Diseño del corte

- Una sola autoridad GameHost. Proyección cosmética y círculos estáticos sobre la base intacta; reconstruir
  también el índice espacial. Recursos, anclas, terreno y RNG conservan su base. Cliente instala la misma
  proyección visual y de movimiento antes de HELLO; revisión/generación exactas verificadas antes de perfil/spawn.
  La respuesta incluye los arrays base exactos enlazados por hashes. El cliente comprueba estructura y
  diferencias numéricas <=1e-6 frente a su generador, verifica los hashes y adopta esos arrays antes de
  proyectar: Node/Chrome pueden diferir unos ULPs en funciones trigonométricas. Sin redondear hashes o IDs.
- Registro de contenido independiente del gameplay Supabase, en volumen durable del VPS. Artefactos y bytes
  por SHA-256, append-only, sin GC automático. Puntero y recibo de activación se escriben juntos mediante
  rename atómico y fsync. CAS de generación e ID de operación: respuesta perdida admite reintento exacto.
  El borrador privado no se sobrescribe al registrar, activar o volver atrás.
- Exclusión Linux flock compartida entre activación y actualizador. El proceso hijo mantiene el lock;
  cerrar/crashear el proceso libera la exclusión sin leases que expiran mientras un writer sigue vivo.
  La activación bloquea admisión y pausa pump/guardado periódico durante la verificación y commit.
- Al arrancar se verifica la revisión durable antes de escuchar. Dependencias y runtime exactos: cambiar
  código que modifica la huella exige volver a la base antes del despliegue. El actualizador rechaza una
  imagen incompatible antes de parar la autoridad. No hay migración silenciosa de contenido histórico.
  Esta restricción inicial se muestra en Online; una migración explícita de revisiones vendrá después.
- Antes de activar/rollback se revisan rutas protegidas y obstáculos nuevos respecto al mapa actual,
  checkpoints, barcos/viajes guardados y objetos persistentes del suelo. Lecturas acotadas y completas;
  ausencia/error/límite de datos impide activar. No se reubican poses ni bienes silenciosamente.
- Catálogo candidato no se vuelve arte aceptado al registrar: activación solo usa assets integrados listos.
  No edita terreno, recursos, NPCs ni edificios funcionales. No publica originales 2K/4K.

## Reutilización y aceptación

Reutiliza BaseDecorationLayer, factory de modelos, compilador GM03b1 y `prop:storage-crate`, candidato
Unreal/FAB ya integrado ([D06](../research/unreal-assets/D06-REUSE.md)). Sin arte ni fuentes nuevas.

Aceptar con pruebas de hash/retención/reinicio, CAS/replay/concurrencia y exclusión; admisión vieja rechazada
antes de perfil/spawn; host y dos clientes con el mismo documento/colliders; mapa visible/caminable;
rechazo ocupado/posiciones/rutas; rollback y fallo de commit conservan datos M5. Navegador ES/EN,
capturas inspeccionadas y publicación por el actualizador existente. El canario público restaura el
puntero anterior y conserva el borrador; evidencia separa código desplegado y mapa realmente activo.
