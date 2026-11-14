// --batch <file>: several fights in one run, e.g. a whole bracket week.
//
// One fight per line: a match id or a page URL, then optionally the two
// titles, separated by " | ". Blank lines and lines starting with # are
// skipped. ENDCARD_LINE and the other switches come from the env, as for one
// fight.
//
//   # bracket week 1
//   7fb30586-bf0a-401b-9cfb-90ce8749ee11 | CORDINARE | ATEL
//   http://localhost:3000/preview/exhibition/cursor-devin?stage=on | CURSOR | DEVIN

/**
 * @returns {{ line: number, matchId?: string, url?: string, slug: string, title?: { a: string, b: string } }[]}
 */
export function parseBatch(text) {
  const jobs = [];
  const seen = new Set();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const [target, a, b, ...rest] = line.split("|").map((s) => s.trim());
    if (rest.length || (a && !b) || (!a && b !== undefined)) throw new Error(`batch line ${i + 1}: "<id or url> | TITLE_A | TITLE_B" (got "${line}")`);
    const job = { line: i + 1 };
    if (/^https?:\/\//.test(target)) {
      const u = new URL(target);
      job.url = u.href;
      job.slug = u.pathname.split("/").filter(Boolean).pop() || u.hostname;
    } else if (/^[A-Za-z0-9_-]+$/.test(target)) {
      job.matchId = target;
      job.slug = target;
    } else {
      throw new Error(`batch line ${i + 1}: "${target}" is neither a match id nor an http(s) URL`);
    }
    if (seen.has(job.slug)) throw new Error(`batch line ${i + 1}: ${job.slug} twice; both would write out/${job.slug}`);
    seen.add(job.slug);
    if (a) job.title = { a, b };
    jobs.push(job);
  });
  if (!jobs.length) throw new Error("batch: no fights in the file");
  return jobs;
}

/** One line per fight for the end of a run. */
export function batchSummary(results) {
  const ok = results.filter((r) => r.ok).length;
  const rows = results.map((r) => `  ${r.ok ? "ok    " : "FAILED"} ${r.slug}  ${r.ok ? `${r.seconds.toFixed(0)} s render` : r.error}`);
  return [`batch: ${ok}/${results.length} rendered`, ...rows].join("\n");
}
