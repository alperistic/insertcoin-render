// Runs in the page before any of its own scripts (record.mjs addInitScript),
// with window.__SLOW_K__ set just before it. Slows every clock the page can
// read by that factor, so the whole fight plays K times as fast as normal:
// timers, performance.now, Date, requestAnimationFrame's timestamp and the
// Web Animations the stage moves with (Element.animate).
//
// Why: a GitHub runner has no GPU and paints the stage at 2x in software at
// only ~18-27 frames a second, so every drawing that stands for one or two
// frames (17 or 34 ms) was gone before it was painted. At a quarter of the
// speed the page paints every one of them; the recording's timestamps are then
// squeezed back by K (frames.mjs pageTime) and the video runs at normal speed.
//
// window.__realNow keeps the real clock for the recorder's own marks.
(() => {
  const K = Number(window.__SLOW_K__) > 0 ? Number(window.__SLOW_K__) : 1;
  const realPerf = performance.now.bind(performance);
  const realDateNow = Date.now.bind(Date);
  const p0 = realPerf();
  const d0 = realDateNow();
  window.__realNow = () => performance.timeOrigin + realPerf();
  window.__slowStart = window.__realNow();
  if (K === 1) return;

  const slow = (real, base) => base + (real - base) * K;
  performance.now = () => slow(realPerf(), p0);
  Date.now = () => Math.round(slow(realDateNow(), d0));
  const RealDate = Date;
  window.Date = new Proxy(RealDate, {
    construct: (target, args) => (args.length ? new target(...args) : new target(Date.now())),
    apply: () => new RealDate(Date.now()).toString(),
  });

  const setTimeoutReal = window.setTimeout.bind(window);
  const setIntervalReal = window.setInterval.bind(window);
  window.setTimeout = (fn, ms, ...rest) => setTimeoutReal(fn, (Number(ms) || 0) / K, ...rest);
  window.setInterval = (fn, ms, ...rest) => setIntervalReal(fn, (Number(ms) || 0) / K, ...rest);

  const rafReal = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => rafReal((t) => cb(slow(t, p0)));

  // The stage's moves are Element.animate() with durations in ms. Stretching
  // them here rather than with CDP Animation.setPlaybackRate: that one also
  // stopped the fighters' idle breathing (tested 14.10.2026).
  const animateReal = Element.prototype.animate;
  const stretch = (o) => {
    if (typeof o === "number") return o / K;
    if (!o || typeof o !== "object") return o;
    const c = { ...o };
    for (const key of ["duration", "delay", "endDelay"]) if (typeof c[key] === "number") c[key] = c[key] / K;
    return c;
  };
  Element.prototype.animate = function (frames, opts) {
    return animateReal.call(this, frames, stretch(opts));
  };
})();
