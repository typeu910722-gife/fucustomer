// The UI font (Huninn) comes in two files with disjoint unicode-ranges (scripts/font-subset.py): the menu file is
// preloaded, the game file is fetched by the browser only when one of its characters is shown. Canvas text (3D labels)
// doesn't trigger that, and HTML game screens would flash the fallback font, so the game is warmed up with this.
const FAMILY = 'Huninn';

/** Starts loading every Huninn file that isn't loaded yet; resolves when all have loaded (or failed). */
export function loadUiFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  const loads: Promise<unknown>[] = [];
  document.fonts.forEach(f => { if (f.family.replace(/["']/g, '') === FAMILY) loads.push(f.status === 'loaded' ? Promise.resolve() : f.load().catch(() => undefined)); });
  return Promise.all(loads).then(() => undefined);
}
