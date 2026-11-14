// The names on the cut when the job does not give them (--match, --page or a
// batch line without TITLE_A/TITLE_B): read off the recorded page instead of
// writing FIGHTER A into the HUD.
//
// Sides are certain, not guessed: the page's HUD carries data-fr="fname-a"
// for manifest.a (the challenger, drawn left) and "fname-b" for manifest.b
// (components/fight/FightReplay.tsx in the insertcoin repo); src/record.mjs
// reads them in that order into meta.hud. The end card lists the same two in
// the same order (EcFighter side a, then b), a second source when the HUD was
// not read (PORTRAIT=a). Upper-case, like the claim job's titles.

const FALLBACK = { a: "FIGHTER A", b: "FIGHTER B" };

/**
 * @param {{ a?: string | null, b?: string | null } | undefined} given the job's or env's titles
 * @param {{ hud?: { name?: string }[], endcard?: { cols?: { name?: string }[] } | null }} rec meta of the recording
 * @returns {{ title: { a: string, b: string }, from: "given" | "page hud" | "page end card" | "fallback", warn?: string }}
 */
export function resolveTitle(given, rec) {
  const a = given?.a?.trim();
  const b = given?.b?.trim();
  if (a && b) return { title: { a, b }, from: "given" };
  const pair = (list) => {
    const names = (list ?? []).map((x) => String(x?.name ?? "").trim());
    return names.length === 2 && names.every(Boolean) ? names.map((n) => n.toUpperCase()) : null;
  };
  for (const [from, names] of [["page hud", pair(rec?.hud)], ["page end card", pair(rec?.endcard?.cols)]]) {
    if (names) return { title: { a: a || names[0], b: b || names[1] }, from };
  }
  return {
    title: { a: a || FALLBACK.a, b: b || FALLBACK.b },
    from: "fallback",
    warn: "no TITLE_A/TITLE_B and no names readable on the page: the cut says FIGHTER A / FIGHTER B",
  };
}
