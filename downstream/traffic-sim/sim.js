// Ring-road traffic model: human drivers vs FSD (automated) drivers.
// Pure logic, no DOM, so it runs in the browser and in node tests.
//
// Both driver types use the Intelligent Driver Model (IDM, Treiber 2000).
// Humans: perceive the car ahead ~0.7 s late, add random throttle noise,
//         and follow closely (short time gap). That is enough to grow
//         "phantom" stop-and-go waves out of nothing (Sugiyama 2008).
// FSD:    react almost instantly, no noise, read the speeds of several
//         cars ahead (sensors / V2V), and cap their speed at the smoothed
//         speed of traffic ahead, so they coast into slowdowns instead of
//         racing up to them. The gap they leave absorbs the wave.

(function (root) {
  const CAR_LEN = 4.5;

  const HUMAN = { v0: 16, a: 1.3, b: 2.0, T: 1.0, s0: 2.0, delay: 0.7, noise: 0.6 };
  const FSD = { v0: 16, a: 0.9, b: 1.6, T: 1.0, s0: 2.5, delay: 0.1, noise: 0, look: 4, smoothWin: 70 };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function idm(p, v, s, dv) {
    const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.a * p.b)));
    return p.a * (1 - Math.pow(v / p.v0, 4) - Math.pow(sStar / Math.max(s, 0.1), 2));
  }

  class Ring {
    // fsdMask: array of booleans (true = FSD car), length n
    constructor({ length = 600, n = 34, fsdMask = null, seed = 1, dt = 0.05 } = {}) {
      this.L = length; this.n = n; this.dt = dt; this.t = 0;
      this.rand = mulberry32(seed);
      this.x = new Float64Array(n); this.v = new Float64Array(n);
      this.acc = new Float64Array(n); this.noise = new Float64Array(n);
      this.fsd = fsdMask ? fsdMask.slice() : new Array(n).fill(false);
      for (let i = 0; i < n; i++) {
        // near-uniform start with tiny jitter: no jam is put in by hand
        this.x[i] = (i * length) / n + (this.rand() - 0.5) * 0.5;
        this.v[i] = 4;
      }
      this.hist = []; // ring buffer of past {x,v} for perception delay
      this.histMax = Math.ceil(1.5 / dt) + 2;
      this.stops = 0; this.stopped = new Uint8Array(n);
      this.brakeQ = [];
    }
    leader(i) { return (i + 1) % this.n; }
    gap(xs, i, j) { let d = xs[j] - xs[i]; if (d <= 0) d += this.L; return d - CAR_LEN; }
    snapshot(delay) {
      const k = Math.min(this.hist.length - 1, Math.round(delay / this.dt));
      if (k <= 0) return { x: this.x, v: this.v };
      return this.hist[this.hist.length - 1 - k];
    }
    tapBrakes(i, seconds = 2.5) { this.brakeQ.push({ i, until: this.t + seconds }); }
    step() {
      const { n, dt } = this;
      this.hist.push({ x: Float64Array.from(this.x), v: Float64Array.from(this.v) });
      if (this.hist.length > this.histMax) this.hist.shift();
      for (let i = 0; i < n; i++) {
        const f = this.fsd[i];
        const p = f ? FSD : HUMAN;
        const snap = this.snapshot(p.delay);
        const j = this.leader(i);
        const s = this.gap(snap.x, i, j);
        const v = this.v[i];
        let a;
        if (!f) {
          a = idm(p, v, s, v - snap.v[j]);
          // throttle noise: slow random wander, like a human foot
          this.noise[i] += (-this.noise[i] * 0.5 + p.noise * (this.rand() * 2 - 1) * 2) * dt;
          a += this.noise[i];
        } else {
          // multi-anticipation: weighted closing speed over several leaders
          let dvW = 0, wSum = 0, k = j;
          for (let m = 0; m < p.look; m++) {
            const w = 1 / (m + 1);
            dvW += w * (v - snap.v[k]); wSum += w; k = this.leader(k);
          }
          // smoothed speed of everything within smoothWin metres ahead
          let vs = 0, cnt = 0; k = j;
          while (cnt < n - 1) {
            let d = snap.x[k] - snap.x[i]; if (d <= 0) d += this.L;
            if (d > p.smoothWin) break;
            vs += snap.v[k]; cnt++; k = this.leader(k);
          }
          const vAhead = cnt ? vs / cnt : p.v0;
          const pLocal = Object.assign({}, p, { v0: Math.max(3, Math.min(p.v0, vAhead + 2.0)) });
          a = idm(pLocal, v, s, dvW / wSum);
          // safety layer: if the direct leader is braking hard, react to it
          const aSafe = idm(p, v, s, v - snap.v[j]);
          if (aSafe < -2) a = Math.min(a, aSafe);
        }
        for (const bq of this.brakeQ) if (bq.i === i && this.t < bq.until) a = Math.min(a, -3);
        this.acc[i] = Math.max(-9, Math.min(p.a * 1.5, a));
      }
      for (let i = 0; i < n; i++) {
        let nv = Math.max(0, this.v[i] + this.acc[i] * dt);
        this.x[i] += (this.v[i] + nv) * 0.5 * dt;
        this.v[i] = nv;
      }
      for (let i = 0; i < n; i++) {
        if (this.x[i] >= this.L) this.x[i] -= this.L;
      }
      // hard no-overlap guard
      for (let i = 0; i < n; i++) {
        const j = this.leader(i);
        if (this.gap(this.x, i, j) < 0.3) {
          let nx = this.x[j] - CAR_LEN - 0.3; if (nx < 0) nx += this.L;
          this.x[i] = nx; this.v[i] = Math.min(this.v[i], this.v[j]);
        }
      }
      for (let i = 0; i < n; i++) {
        const isStop = this.v[i] < 0.5;
        if (isStop && !this.stopped[i]) this.stops++;
        this.stopped[i] = isStop ? 1 : (this.v[i] > 2 ? 0 : this.stopped[i]);
      }
      this.brakeQ = this.brakeQ.filter((b) => this.t < b.until);
      this.t += dt;
    }
    stats() {
      let m = 0; for (let i = 0; i < this.n; i++) m += this.v[i]; m /= this.n;
      let s2 = 0; for (let i = 0; i < this.n; i++) s2 += (this.v[i] - m) ** 2;
      let mn = Infinity; for (let i = 0; i < this.n; i++) mn = Math.min(mn, this.v[i]);
      return { mean: m, sd: Math.sqrt(s2 / this.n), min: mn, flow: m * this.n / this.L * 3600 };
    }
  }

  function spreadMask(n, count) {
    const m = new Array(n).fill(false);
    for (let k = 0; k < count; k++) m[Math.floor((k * n) / count)] = true;
    return m;
  }

  const api = { Ring, spreadMask, HUMAN, FSD, CAR_LEN };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TrafficSim = api;
})(typeof window !== "undefined" ? window : globalThis);
