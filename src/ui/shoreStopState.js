// Client presentation rules for ordinary dry landings beside a shore market.
export function shoreStopAvailable(voyage) {
  return !!(voyage?.active === true && voyage.phase === 'shore'
    && voyage.shoreService === true && voyage.recovery !== true);
}

export function shoreVoyageActive(voyage) {
  return !!(voyage?.active === true && voyage.phase === 'shore');
}

export function shoreStopNotice(locale = 'es') {
  return String(locale).toLowerCase().startsWith('en')
    ? 'Your hold stays locked during this shore stop. Reboard and return to your home dock to transfer cargo.'
    : 'La bodega permanece bloqueada durante esta parada en tierra. Vuelve a embarcar y regresa al muelle de origen para transferir carga.';
}

export function shoreBarrelNotice(locale = 'es') {
  return String(locale).toLowerCase().startsWith('en')
    ? 'Barrel transfers are unavailable during this shore stop. Pack recipes, water, food, and drink remain available.'
    : 'No puedes transferir agua al barril durante esta parada. Siguen disponibles las recetas, el agua de mochila, la comida y la bebida.';
}
