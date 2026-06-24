// Stitch-out simulator: advances a play head through the compiled plan so the
// user can watch stitch order, thread changes, jumps and trims happen in time.

export class Simulator {
  constructor(onChange) {
    this.onChange = onChange;
    this.index = 0;        // number of plan entries "sewn"
    this.total = 0;
    this.playing = false;
    this.engaged = false;  // false = show full design; true = show up to `index`
    this.speed = 100;      // slider position (1..200); see _loop for the curve
    this._acc = 0;
    this._raf = null;
    this._last = 0;
  }

  setPlan(plan) {
    this.total = plan ? plan.length : 0;
    if (this.index > this.total) this.index = this.total;
    this.engaged = false; // a freshly compiled design shows in full
    this._emit();
  }

  seek(i) {
    this.engaged = true;
    this.index = Math.max(0, Math.min(this.total, Math.round(i)));
    this._emit();
  }

  toStart() { this.pause(); this.engaged = true; this.seek(0); }
  toEnd() { this.pause(); this.seek(this.total); }

  play() {
    if (this.total === 0) return;
    this.engaged = true;
    if (this.index >= this.total) this.index = 0;
    this.playing = true;
    this._last = performance.now();
    this._loop();
    this._emit();
  }

  pause() {
    this.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._emit();
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  _loop() {
    if (!this.playing) return;
    const now = performance.now();
    const dt = (now - this._last) / 1000;
    this._last = now;
    // Speed slider (1..200) maps EXPONENTIALLY to stitches/sec so equal slider
    // movements give an equal *relative* change everywhere — no jump from
    // crawling to racing. 1 → ~10 spm-ish, mid → a few hundred, 200 → ~6000.
    const t = (this.speed - 1) / 199;
    const perSec = 10 * Math.pow(600, Math.max(0, Math.min(1, t)));
    this._acc += perSec * dt;
    const step = Math.floor(this._acc);
    if (step >= 1) {
      this._acc -= step;
      this.index = Math.min(this.total, this.index + step);
      this._emit();
    }
    if (this.index >= this.total) { this.pause(); return; }
    this._raf = requestAnimationFrame(() => this._loop());
  }

  _emit() { if (this.onChange) this.onChange(this); }
}
