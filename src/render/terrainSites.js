// Keep cosmetic placement decisions stable while allowing their rendered roots to follow new terrain.
export function preserveTerrainSites(map, build, options) {
  const source = map?.terrainSource || map;
  const result = build(source, options);
  if (source === map || typeof source?.heightAt !== 'function' || typeof map?.heightAt !== 'function') return result;

  const project = (value) => {
    if (Array.isArray(value)) return value.map(project);
    if (!value || typeof value !== 'object') return value;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const copy = { ...value };
    if (Number.isFinite(value.x) && Number.isFinite(value.z) && Number.isFinite(value.y)) {
      copy.y = value.y + map.heightAt(value.x, value.z) - source.heightAt(value.x, value.z);
    }
    if (value.original && Array.isArray(source.props) && Array.isArray(map.props)) {
      const index = source.props.indexOf(value.original);
      if (index >= 0 && index < map.props.length) copy.original = map.props[index];
    }
    for (const key of Object.keys(copy)) {
      if (key === 'original' && copy.original !== value.original) continue;
      copy[key] = project(copy[key]);
    }
    return copy;
  };
  return project(result);
}
