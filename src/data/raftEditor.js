// The first construction pass is deliberately limited to pieces already useful on the starter raft.
export const EDITOR_PARTS = Object.freeze([
  'foundation', 'floor', 'pillar', 'wall', 'railing', 'stairs', 'crate',
]);

export const EDITOR_RADIUS = 8;

export const EDITOR_REASONS = Object.freeze({
  command: 'Solicitud de edición inválida.',
  owner: 'Esa balsa no es tuya.',
  raft: 'La balsa no está disponible en Aldea.',
  far: 'Acércate a tu balsa o a su pasarela.',
  busy: 'Detente antes de editar.',
  dead: 'No puedes editar mientras estás fuera de combate.',
  revision: 'El plano cambió; se ha actualizado al estado vigente.',
  duplicate: 'Ese identificador de operación ya fue usado.',
  piece: 'Esa pieza no está disponible en el editor.',
  level: 'Nivel o dirección inválidos.',
  unknown: 'Pieza desconocida.',
  size: 'La balsa alcanzó su tamaño máximo.',
  adjacent: 'El cimiento debe tocar la balsa.',
  overlap: 'Ese espacio ya está ocupado.',
  support: 'La pieza necesita soporte.',
  deck: 'Coloca la pieza sobre una cubierta.',
  edge: 'La pieza debe estar junto a una cubierta.',
  needed: 'Esa pieza sostiene otra parte de la balsa.',
  goods: 'No tienes suficientes materiales.',
  room: 'No cabe todo en la bodega y la mochila.',
  saveSize: 'La partida supera el límite de guardado; reduce el plano o el inventario.',
  market: 'La mercancía no está disponible en Aldea.',
  gold: 'No tienes oro suficiente.',
  stock: 'Aldea no tiene esa cantidad disponible.',
  calm: 'Espera un momento antes de comerciar.',
  occupied: 'La edición cambiaría el apoyo o bloquearía a alguien.',
  layout: 'La balsa no cabe aquí o bloquearía el muelle u otra balsa.',
  revisionLimit: 'No se puede aumentar más la revisión del plano.',
});
