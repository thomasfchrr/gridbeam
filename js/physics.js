/*
 * physics.js — electromagnetic engine of the simulator.
 *
 * Everything is analytical (no full-wave solver):
 *   1. Rectangular patch: transmission-line / cavity model (Balanis, ch. 14)
 *   2. Planar array      : array factor with complex weights
 *   3. Multi-beam        : superposition of each beam's weight set
 *   4. Near field        : coherent sum of each element's spherical wave
 *
 * Conventions: array in the z = 0 plane, radiating towards z > 0.
 *   u = sinθ·cosφ, v = sinθ·sinφ. The patch length L lies along x (E-plane = xz).
 *   Array positions are expressed in wavelengths λ0.
 */
(function (root) {
  'use strict';

  const C0 = 299792458;        // speed of light (m/s)
  const ETA0 = 376.730313668;  // free-space impedance (Ω)
  const TWO_PI = 2 * Math.PI;

  const sinc = (x) => (Math.abs(x) < 1e-8 ? 1 : Math.sin(x) / x);

  /** Bessel function J0 by integration (spectral convergence, periodic integrand). */
  function besselJ0(x) {
    const n = 48;
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.cos(x * Math.sin((Math.PI * (i + 0.5)) / n));
    return s / n;
  }

  /* ------------------------------------------------------------------ */
  /* 1. Rectangular patch                                                */
  /* ------------------------------------------------------------------ */

  /** Effective permittivity of a microstrip line of width W on a substrate (er, h). */
  function epsEff(er, h, W) {
    return (er + 1) / 2 + (er - 1) / 2 / Math.sqrt(1 + (12 * h) / W);
  }

  /** Length extension due to fringing fields (Hammerstad). */
  function deltaL(eeff, h, W) {
    return (0.412 * h * ((eeff + 0.3) * (W / h + 0.264))) / ((eeff - 0.258) * (W / h + 0.8));
  }

  /** Dimensions (m) of a patch resonant at f (Hz) on a substrate (er, h in m). */
  function designPatch(f, er, h) {
    const W = (C0 / (2 * f)) * Math.sqrt(2 / (er + 1));
    const ee = epsEff(er, h, W);
    const L = C0 / (2 * f * Math.sqrt(ee)) - 2 * deltaL(ee, h, W);
    return { W, L: Math.max(L, W * 0.05) };
  }

  /** Self conductance G1 and mutual conductance G12 of the two radiating slots. */
  function slotConductances(k0, W, L) {
    const n = 200;
    const X = (k0 * W) / 2;
    let g1 = 0, g12 = 0;
    for (let i = 0; i < n; i++) {
      const th = (Math.PI * (i + 0.5)) / n;
      const c = Math.cos(th), s = Math.sin(th);
      const a = Math.abs(c) < 1e-9 ? X : Math.sin(X * c) / c;
      const t = a * a * s * s * s;
      g1 += t;
      g12 += t * besselJ0(k0 * L * s);
    }
    const k = Math.PI / n / (120 * Math.PI * Math.PI);
    return { G1: g1 * k, G12: g12 * k };
  }

  /**
   * Full analysis of a patch.
   * @param p {f, er, h, W, L (SI), inset (fraction of L, 0..0.5), z0 (Ω)}
   */
  function analyzePatch(p) {
    const { f, er, h, W, L, inset, z0 } = p;
    const lam0 = C0 / f;
    const ee = epsEff(er, h, W);
    const dL = deltaL(ee, h, W);
    const Leff = L + 2 * dL;
    const fr = C0 / (2 * Leff * Math.sqrt(ee));           // resonant frequency (TM010)
    const { G1, G12 } = slotConductances(TWO_PI * fr / C0, W, L);
    const Redge = 1 / (2 * (G1 + G12));                   // resistance at the radiating edge
    const cosI = Math.cos(Math.PI * inset);
    const Rin = Math.max(Redge * cosI * cosI, 0.01);      // inset feed at y0 = inset·L
    // Fractional bandwidth (VSWR < 2) and the matching quality factor
    const BW = Math.max(3.77 * ((er - 1) / (er * er)) * (W / L) * (h / lam0), 0.002);
    const Q = 1 / (BW * Math.SQRT2);
    const out = { W, L, lam0, eeff: ee, dL, Leff, fr, G1, G12, Redge, Rin, BW, Q, z0, inset };
    const z = zinAt(out, f);
    const g = gammaOf(z, z0);
    out.Zin = z;
    out.gamma = g.mag;
    out.s11dB = 20 * Math.log10(Math.max(g.mag, 1e-6));
    out.vswr = g.mag >= 0.9999 ? Infinity : (1 + g.mag) / (1 - g.mag);
    out.mismatch = 1 - g.mag * g.mag;                     // mismatch efficiency
    // Ideal inset for Rin = Z0
    out.insetMatch = Redge > z0 ? Math.acos(Math.sqrt(z0 / Redge)) / Math.PI : 0;
    return out;
  }

  /** Input impedance (parallel RLC circuit around resonance). */
  function zinAt(patch, f) {
    const x = patch.Q * (f / patch.fr - patch.fr / f);
    const d = 1 + x * x;
    return { re: patch.Rin / d, im: (-patch.Rin * x) / d };
  }

  function gammaOf(z, z0) {
    const nr = z.re - z0, ni = z.im, dr = z.re + z0, di = z.im;
    const d = dr * dr + di * di;
    const re = (nr * dr + ni * di) / d, im = (ni * dr - nr * di) / d;
    return { re, im, mag: Math.hypot(re, im) };
  }

  /**
   * Amplitude pattern of a patch (2 slots, infinite ground plane).
   * |E|² = sinc²(kW·v/2) · cos²(kLeff·u/2) · (1 − v²)
   */
  function patchElement(Wlam, LeffLam) {
    const a = Math.PI * Wlam, b = Math.PI * LeffLam;
    return (u, v) => sinc(a * v) * Math.cos(b * u) * Math.sqrt(Math.max(0, 1 - v * v));
  }
  const isotropicElement = () => 1;

  /* ------------------------------------------------------------------ */
  /* 2. Weights                                                          */
  /* ------------------------------------------------------------------ */

  function chebT(m, x) {
    if (Math.abs(x) <= 1) return Math.cos(m * Math.acos(x));
    const c = Math.cosh(m * Math.acosh(Math.abs(x)));
    return x < 0 && m % 2 ? -c : c;
  }

  /** 1D amplitude taper (normalised, max = 1). sll: target sidelobe level in dB (Chebyshev). */
  function taper(type, N, sll) {
    const w = new Float64Array(N).fill(1);
    if (N < 2 || type === 'uniform') return w;
    const c = (N - 1) / 2;
    for (let n = 0; n < N; n++) {
      if (type === 'cosine') w[n] = Math.sin((Math.PI * (n + 0.5)) / N);
      else if (type === 'hamming') w[n] = 0.54 - 0.46 * Math.cos((TWO_PI * n) / (N - 1));
      else if (type === 'chebyshev') {
        const x0 = Math.cosh(Math.acosh(Math.pow(10, sll / 20)) / (N - 1));
        let s = 0;
        for (let k = 0; k < N; k++) {
          s += chebT(N - 1, x0 * Math.cos((Math.PI * k) / N)) * Math.cos((TWO_PI * k * (n - c)) / N);
        }
        w[n] = s;
      }
    }
    let mx = 0;
    for (let n = 0; n < N; n++) mx = Math.max(mx, Math.abs(w[n]));
    for (let n = 0; n < N; n++) w[n] /= mx;
    return w;
  }

  /**
   * Complex array weights for a set of beams.
   *   w_mn = t_m·t_n · Σ_b A_b · exp(−j·2π·(x_m·u_b + y_n·v_b))
   * @param c {nx, ny, dx, dy (λ), beams:[{theta, phi (°), amp (dB)}], taper, sll, bits}
   */
  function buildWeights(c) {
    const { nx, ny, dx, dy } = c;
    const xs = new Float64Array(nx), ys = new Float64Array(ny);
    for (let m = 0; m < nx; m++) xs[m] = (m - (nx - 1) / 2) * dx;
    for (let n = 0; n < ny; n++) ys[n] = (n - (ny - 1) / 2) * dy;
    const tx = taper(c.taper, nx, c.sll), ty = taper(c.taper, ny, c.sll);
    const wr = new Float64Array(nx * ny), wi = new Float64Array(nx * ny);
    for (const b of c.beams) {
      const th = (b.theta * Math.PI) / 180, ph = (b.phi * Math.PI) / 180;
      const ub = Math.sin(th) * Math.cos(ph), vb = Math.sin(th) * Math.sin(ph);
      const a = Math.pow(10, b.amp / 20);
      for (let m = 0; m < nx; m++) {
        for (let n = 0; n < ny; n++) {
          const psi = -TWO_PI * (xs[m] * ub + ys[n] * vb);
          const t = a * tx[m] * ty[n];
          wr[m * ny + n] += t * Math.cos(psi);
          wi[m * ny + n] += t * Math.sin(psi);
        }
      }
    }
    // Phase quantisation (digital phase shifters with `bits` bits) then normalisation
    const step = c.bits > 0 ? TWO_PI / (1 << c.bits) : 0;
    const amp = new Float64Array(nx * ny), phase = new Float64Array(nx * ny);
    let mx = 1e-12;
    for (let i = 0; i < amp.length; i++) {
      amp[i] = Math.hypot(wr[i], wi[i]);
      phase[i] = Math.atan2(wi[i], wr[i]);
      if (step) phase[i] = Math.round(phase[i] / step) * step;
      mx = Math.max(mx, amp[i]);
    }
    for (let i = 0; i < amp.length; i++) {
      amp[i] /= mx;
      wr[i] = amp[i] * Math.cos(phase[i]);
      wi[i] = amp[i] * Math.sin(phase[i]);
    }
    return { nx, ny, dx, dy, xs, ys, wr, wi, amp, phase };
  }

  /* ------------------------------------------------------------------ */
  /* 3. Far field                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Returns f(u, v) → radiated power density |AF·g|² (not normalised).
   * The double sum is factorised: Σ_m e^{jk·x_m·u} · (Σ_n w_mn · e^{jk·y_n·v}).
   */
  function makeEvaluator(w, elem) {
    const { nx, ny, xs, ys, wr, wi } = w;
    const cy = new Float64Array(ny), sy = new Float64Array(ny);
    return function (u, v) {
      for (let n = 0; n < ny; n++) {
        const a = TWO_PI * ys[n] * v;
        cy[n] = Math.cos(a); sy[n] = Math.sin(a);
      }
      let re = 0, im = 0;
      for (let m = 0; m < nx; m++) {
        let sr = 0, si = 0;
        const o = m * ny;
        for (let n = 0; n < ny; n++) {
          sr += wr[o + n] * cy[n] - wi[o + n] * sy[n];
          si += wr[o + n] * sy[n] + wi[o + n] * cy[n];
        }
        const a = TWO_PI * xs[m] * u, c = Math.cos(a), s = Math.sin(a);
        re += sr * c - si * s;
        im += sr * s + si * c;
      }
      const g = elem(u, v);
      return (re * re + im * im) * g * g;
    };
  }

  /**
   * Samples the half-space z > 0 on a (θ, φ) grid and integrates the directivity.
   * @returns {nt, np, P (Float32Array nt×np), pmax, integral}
   */
  function sampleHemisphere(evalP, nt, np) {
    const P = new Float32Array(nt * np);
    const dT = Math.PI / 2 / (nt - 1), dP = TWO_PI / np;
    let pmax = 0, integral = 0;
    for (let i = 0; i < nt; i++) {
      const th = i * dT, st = Math.sin(th);
      let ring = 0;
      for (let j = 0; j < np; j++) {
        const ph = j * dP;
        const p = evalP(st * Math.cos(ph), st * Math.sin(ph));
        P[i * np + j] = p;
        ring += p;
        if (p > pmax) pmax = p;
      }
      integral += (i === 0 || i === nt - 1 ? 0.5 : 1) * ring * st * dT * dP;
    }
    return { nt, np, P, pmax, integral };
  }

  /** True if a grating lobe enters visible space for the beam (ub, vb). */
  function hasGratingLobe(ub, vb, dx, dy, nx, ny) {
    for (let p = -3; p <= 3; p++) {
      for (let q = -3; q <= 3; q++) {
        if (!p && !q) continue;
        if ((p && nx < 2) || (q && ny < 2)) continue;
        const u = ub + p / dx, v = vb + q / dy;
        if (u * u + v * v <= 1) return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* 4. Near field (vertical cut)                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Field phasor in the vertical plane at azimuth phi0, sum of spherical waves:
   *   F(P) = Σ w_mn · g(direction) · exp(−j·2π·r) / r     (r in λ)
   * @param o {phi0 (rad), half (λ), zmax (λ), cols, rows}
   */
  function computeNearField(w, elem, o) {
    const { nx, ny, xs, ys, wr, wi } = w;
    const { cols, rows, half, zmax } = o;
    const cp = Math.cos(o.phi0), sp = Math.sin(o.phi0);
    const re = new Float32Array(cols * rows), im = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const z = zmax * (1 - (r + 0.5) / rows), z2 = z * z;
      for (let c = 0; c < cols; c++) {
        const s = half * ((2 * (c + 0.5)) / cols - 1);
        const px = s * cp, py = s * sp;
        let fr = 0, fi = 0;
        for (let m = 0; m < nx; m++) {
          const ddx = px - xs[m], o2 = m * ny;
          for (let n = 0; n < ny; n++) {
            const ddy = py - ys[n];
            const rr = Math.sqrt(Math.max(ddx * ddx + ddy * ddy + z2, 0.02));
            const a = elem(ddx / rr, ddy / rr) / rr;
            const ph = -TWO_PI * rr, cr = Math.cos(ph) * a, ci = Math.sin(ph) * a;
            fr += wr[o2 + n] * cr - wi[o2 + n] * ci;
            fi += wr[o2 + n] * ci + wi[o2 + n] * cr;
          }
        }
        re[r * cols + c] = fr;
        im[r * cols + c] = fi;
      }
    }
    return { re, im, cols, rows, half, zmax, phi0: o.phi0 };
  }

  const api = {
    C0, ETA0, sinc, besselJ0, epsEff, deltaL, designPatch, slotConductances, analyzePatch,
    zinAt, gammaOf, patchElement, isotropicElement, taper, buildWeights, makeEvaluator,
    sampleHemisphere, hasGratingLobe, computeNearField,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Physics = api;
})(typeof window !== 'undefined' ? window : globalThis);
