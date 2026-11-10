/*
 * app.js — state, UI and rendering for the simulator.
 * Depends on window.Physics (js/physics.js). No external libraries.
 */
(function () {
  'use strict';
  const P = window.Physics;
  const $ = (s) => document.querySelector(s);
  const DEG = Math.PI / 180;
  const BEAM_COLORS = ['#5eead4', '#fbbf24', '#f472b6', '#60a5fa', '#a3e635', '#c084fc'];
  const MAX_BEAMS = BEAM_COLORS.length;

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  const S = {
    nx: 8, ny: 8, dx: 0.5, dy: 0.5, taper: 'uniform', sll: 30, bits: 0, elem: 'patch',
    f: 28, er: 2.2, h: 0.508, auto: true, W: 4, L: 3, inset: 30, z0: 50,
    beams: [{ theta: 20, phi: 0, amp: 0 }], sel: 0,
    dyn: 40, pinDbm: 30,
    nfMode: 'E', nfPlane: 'beam', nfSpan: 12, play: true,
  };
  const R = {};                       // results of the last computation
  const view = { az: -0.7, el: 0.48 }; // 3D camera
  let wavePhase = 0, probe = null;
  let needAll = true, needNear = false, nearDirty = true;

  const PRESETS = {
    mono: { nx: 8, ny: 8, dx: 0.5, dy: 0.5, taper: 'uniform', bits: 0, beams: [{ theta: 20, phi: 0, amp: 0 }] },
    dual: { nx: 8, ny: 8, dx: 0.5, dy: 0.5, taper: 'uniform', bits: 0, beams: [{ theta: 30, phi: 0, amp: 0 }, { theta: 30, phi: 180, amp: 0 }] },
    quad: { nx: 12, ny: 12, dx: 0.5, dy: 0.5, taper: 'uniform', bits: 0, beams: [45, 135, 225, 315].map((phi) => ({ theta: 35, phi, amp: 0 })) },
    lowsll: { nx: 16, ny: 16, dx: 0.5, dy: 0.5, taper: 'chebyshev', sll: 35, bits: 0, beams: [{ theta: 15, phi: 0, amp: 0 }] },
    grating: { nx: 8, ny: 8, dx: 1, dy: 1, taper: 'uniform', bits: 0, beams: [{ theta: 25, phi: 0, amp: 0 }] },
    linear: { nx: 16, ny: 1, dx: 0.5, dy: 0.5, taper: 'uniform', bits: 0, beams: [{ theta: 30, phi: 0, amp: 0 }] },
  };

  /* ------------------------------------------------------------------ */
  /* Colormaps                                                            */
  /* ------------------------------------------------------------------ */
  function makeLut(stops) {
    const lut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * (stops.length - 1), k = Math.min(Math.floor(t), stops.length - 2), f = t - k;
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f);
    }
    return lut;
  }
  const LUT_DB = makeLut([[6, 8, 20], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]]);
  const LUT_E = makeLut([[186, 230, 253], [14, 116, 188], [9, 13, 21], [234, 88, 12], [254, 215, 170]]);
  const LUT_H = makeLut([[233, 213, 255], [126, 34, 206], [9, 13, 21], [5, 150, 105], [167, 243, 208]]);
  const lutCss = (lut, i) => `rgb(${lut[i * 3]},${lut[i * 3 + 1]},${lut[i * 3 + 2]})`;

  /* ------------------------------------------------------------------ */
  /* Building the controls                                               */
  /* ------------------------------------------------------------------ */
  const ctl = {};
  function addSlider(host, o) {
    const el = document.createElement('label');
    el.className = 'ctl';
    if (o.tip) el.title = o.tip;
    el.innerHTML = `<span>${o.label}</span><output></output><input type="range" min="${o.min}" max="${o.max}" step="${o.step}">`;
    const input = el.querySelector('input'), out = el.querySelector('output');
    const fmt = o.fmt || ((v) => v.toFixed(o.dec || 0) + (o.unit ? ' ' + o.unit : ''));
    const sync = () => { input.value = S[o.key]; out.textContent = fmt(S[o.key]); };
    input.addEventListener('input', () => { S[o.key] = +input.value; out.textContent = fmt(S[o.key]); if (o.on) o.on(); needAll = true; });
    $(host).appendChild(el);
    ctl[o.key] = { el, input, sync };
    sync();
  }

  function buildControls() {
    addSlider('#ctl-array', { key: 'nx', label: 'Elements along x', min: 1, max: 16, step: 1, tip: 'Number of patches along x' });
    addSlider('#ctl-array', { key: 'ny', label: 'Elements along y', min: 1, max: 16, step: 1, tip: 'Number of patches along y' });
    const mm = (v) => `${v.toFixed(2)} λ · ${(v * (R.lam || 0) * 1e3).toFixed(2)} mm`;
    addSlider('#ctl-array', { key: 'dx', label: 'Spacing along x', min: 0.25, max: 1.5, step: 0.01, fmt: mm, tip: 'Centre-to-centre distance. Beyond ~0.5 λ grating lobes may appear.' });
    addSlider('#ctl-array', { key: 'dy', label: 'Spacing along y', min: 0.25, max: 1.5, step: 0.01, fmt: mm });
    addSlider('#ctl-sll', { key: 'sll', label: 'Target sidelobe level', min: 15, max: 60, step: 1, fmt: (v) => `−${v} dB` });

    addSlider('#ctl-patch', { key: 'f', label: 'Frequency', min: 1, max: 60, step: 0.1, dec: 1, unit: 'GHz' });
    addSlider('#ctl-patch', { key: 'er', label: 'Substrate permittivity εr', min: 1.5, max: 12, step: 0.05, dec: 2, tip: 'FR-4 ≈ 4.4 · Rogers RT5880 = 2.2 · alumina ≈ 9.8' });
    addSlider('#ctl-patch', { key: 'h', label: 'Substrate thickness h', min: 0.1, max: 3.2, step: 0.001, dec: 3, unit: 'mm' });
    addSlider('#ctl-size', { key: 'W', label: 'Width W (along y)', min: 0.5, max: 50, step: 0.001, dec: 3, unit: 'mm', tip: 'Mainly sets the radiation resistance and the bandwidth' });
    addSlider('#ctl-size', { key: 'L', label: 'Length L (along x)', min: 0.5, max: 50, step: 0.001, dec: 3, unit: 'mm', tip: 'Sets the resonant frequency (≈ λg / 2)' });
    addSlider('#ctl-feed', { key: 'inset', label: 'Feed inset y₀ / L', min: 0, max: 50, step: 0.5, dec: 1, unit: '%', tip: '0 % = radiating edge (highest impedance), 50 % = centre (zero impedance)' });
    addSlider('#ctl-feed', { key: 'z0', label: 'Line impedance Z₀', min: 25, max: 200, step: 1, unit: 'Ω' });

    addSlider('#ctl-display', { key: 'dyn', label: 'Display dynamic range', min: 20, max: 60, step: 1, unit: 'dB' });
    addSlider('#ctl-display', {
      key: 'pinDbm', label: 'Input power', min: 0, max: 50, step: 1,
      fmt: (v) => { const w = Math.pow(10, v / 10) / 1000; return `${v} dBm · ${w >= 1 ? w.toFixed(w < 10 ? 1 : 0) + ' W' : (w * 1000).toFixed(0) + ' mW'}`; },
    });

    document.querySelectorAll('[data-key]').forEach((el) => {
      const key = el.dataset.key, num = 'num' in el.dataset;
      el.value = S[key];
      el.addEventListener('input', () => {
        S[key] = num ? +el.value : el.value;
        if (key.startsWith('nf')) { needNear = true; syncMisc(); } else needAll = true;
        syncMisc();
      });
    });

    $('#auto').addEventListener('change', (e) => { S.auto = e.target.checked; syncMisc(); needAll = true; });
    $('#match').addEventListener('click', () => {
      S.inset = Math.round(R.patch.insetMatch * 1000) / 10;
      ctl.inset.sync(); needAll = true;
    });
    $('#add-beam').addEventListener('click', () => {
      if (S.beams.length >= MAX_BEAMS) return;
      const n = S.beams.length;
      S.beams.push({ theta: 30, phi: (n * 97) % 360, amp: 0 });
      S.sel = n; renderBeams(); needAll = true;
    });
    $('#preset').addEventListener('change', (e) => applyPreset(e.target.value));
    $('#play').addEventListener('click', () => { S.play = !S.play; syncMisc(); });
    $('#nf-mode').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      S.nfMode = b.dataset.v; syncMisc(); needNear = true;
    });
    const guide = $('#guide');
    $('#btn-guide').addEventListener('click', () => guide.showModal());
    $('#foot-guide').addEventListener('click', (e) => { e.preventDefault(); guide.showModal(); });
    $('#guide-close').addEventListener('click', () => guide.close());
    guide.addEventListener('click', (e) => { if (e.target === guide) guide.close(); });
  }

  /** Refreshes the UI elements that depend on state (other than sliders). */
  function syncMisc() {
    ctl.sll.el.style.display = S.taper === 'chebyshev' ? '' : 'none';
    ctl.W.input.disabled = ctl.L.input.disabled = S.auto;
    $('#auto').checked = S.auto;
    $('#play').textContent = S.play ? '❚❚' : '▶';
    $('#nf-span-out').textContent = S.nfSpan + ' λ';
    document.querySelectorAll('#nf-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.nfMode));
    document.querySelectorAll('[data-key]').forEach((el) => { el.value = S[el.dataset.key]; });
    $('#add-beam').disabled = S.beams.length >= MAX_BEAMS;
  }

  function applyPreset(name) {
    const p = PRESETS[name]; if (!p) return;
    Object.assign(S, p, { beams: p.beams.map((b) => ({ ...b })), sel: 0 });
    Object.values(ctl).forEach((c) => c.sync());
    renderBeams(); syncMisc(); needAll = true;
  }

  /* ---------- Beam list ---------- */
  const BEAM_FIELDS = [
    { k: 'theta', label: 'Steering θ', min: 0, max: 80, step: 0.5, fmt: (v) => v.toFixed(1) + '°' },
    { k: 'phi', label: 'Azimuth φ', min: 0, max: 360, step: 1, fmt: (v) => v.toFixed(0) + '°' },
    { k: 'amp', label: 'Relative level', min: -20, max: 0, step: 0.5, fmt: (v) => v.toFixed(1) + ' dB' },
  ];
  function renderBeams() {
    const host = $('#beams');
    host.innerHTML = '';
    S.beams.forEach((b, i) => {
      const card = document.createElement('div');
      card.className = 'beam';
      card.style.setProperty('--c', BEAM_COLORS[i]);
      card.innerHTML = `<div class="beam-h"><span><i></i>Beam ${i + 1}</span>${S.beams.length > 1 ? '<button title="Remove" aria-label="Remove">✕</button>' : ''}</div>` +
        BEAM_FIELDS.map((f) => `<label class="ctl"><span>${f.label}</span><output data-o="${f.k}"></output><input type="range" data-f="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}"></label>`).join('');
      card.addEventListener('pointerdown', () => { if (S.sel !== i) { S.sel = i; syncBeams(); needAll = true; } });
      card.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => { b[inp.dataset.f] = +inp.value; syncBeams(); needAll = true; }));
      const del = card.querySelector('button');
      if (del) del.addEventListener('click', (e) => {
        e.stopPropagation();
        S.beams.splice(i, 1); S.sel = Math.min(S.sel, S.beams.length - 1);
        renderBeams(); needAll = true;
      });
      host.appendChild(card);
    });
    syncBeams(); syncMisc();
  }
  function syncBeams() {
    document.querySelectorAll('#beams .beam').forEach((card, i) => {
      card.classList.toggle('sel', i === S.sel);
      const b = S.beams[i];
      BEAM_FIELDS.forEach((f) => {
        const inp = card.querySelector(`[data-f=${f.k}]`);
        if (document.activeElement !== inp) inp.value = b[f.k];
        card.querySelector(`[data-o=${f.k}]`).textContent = f.fmt(b[f.k]);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Compute                                                             */
  /* ------------------------------------------------------------------ */
  const beamUV = (b) => {
    const st = Math.sin(b.theta * DEG);
    return [st * Math.cos(b.phi * DEG), st * Math.sin(b.phi * DEG)];
  };
  const toDb = (p) => 10 * Math.log10(Math.max(p / R.pmax, 1e-12));

  function recompute() {
    const f = S.f * 1e9, h = S.h * 1e-3;
    if (S.auto) {
      const d = P.designPatch(f, S.er, h);
      S.W = d.W * 1e3; S.L = d.L * 1e3;
      for (const k of ['W', 'L']) { ctl[k].input.min = (S[k] * 0.4).toFixed(3); ctl[k].input.max = (S[k] * 2.5).toFixed(3); }
    }
    R.patch = P.analyzePatch({ f, er: S.er, h, W: S.W * 1e-3, L: S.L * 1e-3, inset: S.inset / 100, z0: S.z0 });
    R.lam = R.patch.lam0;
    ['W', 'L', 'dx', 'dy'].forEach((k) => ctl[k].sync());

    R.w = P.buildWeights(S);
    R.elem = S.elem === 'patch' ? P.patchElement((S.W * 1e-3) / R.lam, R.patch.Leff / R.lam) : P.isotropicElement;
    R.evalP = P.makeEvaluator(R.w, R.elem);
    R.hemi = P.sampleHemisphere(R.evalP, 61, 120);
    R.pmax = R.hemi.pmax;
    for (const b of S.beams) { const [u, v] = beamUV(b); R.pmax = Math.max(R.pmax, R.evalP(u, v)); }
    // An isotropic source also radiates towards z < 0: total power doubles.
    R.D = (4 * Math.PI * R.pmax) / (R.hemi.integral * (S.elem === 'patch' ? 1 : 2));
    R.G = R.D * R.patch.mismatch;
    R.pin = Math.pow(10, S.pinDbm / 10) / 1000;

    computeUV();
    computeCut();
    computeNear();
    updateMetrics();
    drawStatic();
  }

  /* ---------- u-v map ---------- */
  const UVN = 141;
  const uvCanvas = document.createElement('canvas');
  uvCanvas.width = uvCanvas.height = UVN;
  function computeUV() {
    const ctx = uvCanvas.getContext('2d'), img = ctx.createImageData(UVN, UVN), d = img.data;
    for (let j = 0; j < UVN; j++) {
      const v = 1 - (2 * j) / (UVN - 1);
      for (let i = 0; i < UVN; i++) {
        const u = (2 * i) / (UVN - 1) - 1, k = (j * UVN + i) * 4;
        if (u * u + v * v > 1.03) continue;
        const s = Math.min(1, 1 / Math.hypot(u, v)); // the rim just outside the disc reuses the edge value
        const t = Math.max(0, 1 + toDb(R.evalP(u * s, v * s)) / S.dyn);
        const c = Math.round(t * 255) * 3;
        d[k] = LUT_DB[c]; d[k + 1] = LUT_DB[c + 1]; d[k + 2] = LUT_DB[c + 2]; d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /* ---------- Cut in the active beam's plane ---------- */
  const CUT_N = 361;
  function computeCut() {
    const b = S.beams[S.sel], cp = Math.cos(b.phi * DEG), sp = Math.sin(b.phi * DEG);
    const db = new Float32Array(CUT_N);
    for (let i = 0; i < CUT_N; i++) { const st = Math.sin((i * 0.5 - 90) * DEG); db[i] = toDb(R.evalP(st * cp, st * sp)); }
    // Main lobe: local peak closest to the steered direction
    let i = Math.round((b.theta + 90) / 0.5);
    while (i > 0 && db[i - 1] > db[i]) i--;
    while (i < CUT_N - 1 && db[i + 1] > db[i]) i++;
    const pk = db[i];
    let a = i, c = i;
    while (a > 0 && db[a] > pk - 3) a--;
    while (c < CUT_N - 1 && db[c] > pk - 3) c++;
    const left = a + (pk - 3 - db[a]) / ((db[a + 1] - db[a]) || 1), right = c - (pk - 3 - db[c]) / ((db[c - 1] - db[c]) || 1);
    let l = i, r = i;
    while (l > 0 && db[l - 1] < db[l]) l--;
    while (r < CUT_N - 1 && db[r + 1] < db[r]) r++;
    let sll = -Infinity;
    for (let k = 0; k < CUT_N; k++) if (k < l || k > r) sll = Math.max(sll, db[k]);
    R.cut = { db, phi: b.phi, hpbw: (right - left) * 0.5, sll: sll - pk, peakDeg: i * 0.5 - 90 };
  }

  /* ---------- Near field ---------- */
  const nearCanvas = document.createElement('canvas');
  const NEAR_PAD = { l: 36, r: 10, t: 8, b: 24 };
  let refineTimer = 0;
  /** hi = false: fast pass while adjusting; a fine pass follows after 250 ms of quiet. */
  function computeNear(hi) {
    clearTimeout(refineTimer);
    if (!hi) refineTimer = setTimeout(() => computeNear(true), 250);
    const box = $('#cv-near').getBoundingClientRect();
    const aw = Math.max(50, box.width - NEAR_PAD.l - NEAR_PAD.r), ah = Math.max(50, box.height - NEAR_PAD.t - NEAR_PAD.b);
    const n = S.nx * S.ny;
    // Compute budget: resolution drops as the array grows.
    const px = hi ? Math.min(110000, Math.max(12000, 1.2e7 / n)) : Math.min(30000, Math.max(3500, 1.6e6 / n));
    const cols = Math.round(Math.sqrt((px * aw) / ah)), rows = Math.max(8, Math.round((cols * ah) / aw));
    const phi0 = S.nfPlane === 'xz' ? 0 : S.nfPlane === 'yz' ? Math.PI / 2 : S.beams[S.sel].phi * DEG;
    const nf = P.computeNearField(R.w, R.elem, { phi0, half: S.nfSpan, zmax: (2 * S.nfSpan * ah) / aw, cols, rows });
    // Display reference: maximum outside the reactive zone right above the array
    const N = cols * rows, mag = new Float32Array(N);
    let ref = 1e-12;
    for (let i = 0; i < N; i++) {
      mag[i] = Math.hypot(nf.re[i], nf.im[i]);
      if (i < N - Math.ceil(rows * 0.1) * cols && mag[i] > ref) ref = mag[i];
    }
    // Compression (power law) to keep the wave readable far from the array
    nf.scale = new Float32Array(N); nf.dbIdx = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.min(1, mag[i] / ref);
      nf.scale[i] = mag[i] > 0 ? Math.pow(a, 0.65) / mag[i] : 0;
      nf.dbIdx[i] = Math.round(255 * Math.max(0, 1 + (20 * Math.log10(Math.max(a, 1e-6))) / S.dyn));
    }
    nf.mag = mag;
    nearCanvas.width = cols; nearCanvas.height = rows;
    nf.img = nearCanvas.getContext('2d').createImageData(cols, rows);
    R.near = nf; nearDirty = true;
  }

  /* ------------------------------------------------------------------ */
  /* Metrics                                                             */
  /* ------------------------------------------------------------------ */
  const fmtLen = (m) => (m >= 1 ? m.toFixed(2) + ' m' : m >= 0.01 ? (m * 100).toFixed(1) + ' cm' : (m * 1000).toFixed(2) + ' mm');
  function updateMetrics() {
    const p = R.patch, dB = (x) => 10 * Math.log10(x);
    const z = p.Zin, single = S.beams.length === 1;
    const eirp = S.pinDbm + dB(R.G);
    const ap = Math.hypot((S.nx - 1) * S.dx + (S.L * 1e-3) / R.lam, (S.ny - 1) * S.dy + (S.W * 1e-3) / R.lam) * R.lam;
    R.farField = (2 * ap * ap) / R.lam;
    const items = [
      ['Directivity', dB(R.D).toFixed(1), 'dBi', `${S.nx * S.ny} elements`],
      ['Realized gain', dB(R.G).toFixed(1), 'dBi', `mismatch ${dB(p.mismatch).toFixed(2)} dB`],
      ['EIRP', eirp.toFixed(1), 'dBm', `${(Math.pow(10, eirp / 10) / 1000).toPrecision(3)} W`],
      ['−3 dB beamwidth', R.cut.hpbw.toFixed(1), '°', `plane φ = ${R.cut.phi.toFixed(0)}°`],
      ['Sidelobe level', single && isFinite(R.cut.sll) ? R.cut.sll.toFixed(1) : '—', single ? 'dB' : '', single ? 'in the cut' : 'multi-beam'],
      ['Impedance Zin', `${z.re.toFixed(1)}${z.im < 0 ? '−' : '+'}j${Math.abs(z.im).toFixed(1)}`, 'Ω', `VSWR ${p.vswr < 100 ? p.vswr.toFixed(2) : '>100'} · S₁₁ ${p.s11dB.toFixed(1)} dB`],
      ['Resonance', (p.fr / 1e9).toFixed(2), 'GHz', `bandwidth ≈ ${(p.BW * 100).toFixed(1)} % · edge R ${p.Redge.toFixed(0)} Ω`],
      ['Far-field distance', fmtLen(R.farField), '', `λ₀ = ${fmtLen(R.lam)}`],
    ];
    $('#metrics').innerHTML = items.map(([k, v, u, s]) => `<div class="metric"><div class="k">${k}</div><div class="v">${v}<small>${u}</small></div><div class="s">${s}</div></div>`).join('');

    const warns = [];
    if (S.beams.some((b) => { const [u, v] = beamUV(b); return P.hasGratingLobe(u, v, S.dx, S.dy, S.nx, S.ny); })) warns.push('Grating lobes in visible space — reduce the spacing or the steering angle');
    if (S.elem === 'patch' && ((S.L * 1e-3) / R.lam > S.dx && S.nx > 1 || (S.W * 1e-3) / R.lam > S.dy && S.ny > 1)) warns.push('Patches overlap — increase the spacing or εr');
    if (Math.abs(p.fr / (S.f * 1e9) - 1) > p.BW / 2) warns.push(`Patch off resonance (${(p.fr / 1e9).toFixed(2)} GHz) — adjust L`);
    else if (p.s11dB > -10) warns.push('Mismatch: S₁₁ > −10 dB — use “Match feed to Z₀”');
    if (S.h * 1e-3 > 0.1 * R.lam) warns.push('Thick substrate (h > 0.1 λ) — the model loses accuracy');
    $('#warns').innerHTML = warns.map((w) => `<span class="warn">⚠ ${w}</span>`).join('');
    $('#cut-title').textContent = `Pattern cut — plane φ = ${R.cut.phi.toFixed(0)}°`;
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  function fit(canvas) {
    const r = canvas.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.font = '11px ui-monospace, Consolas, monospace';
    return { ctx, w: r.width, h: r.height };
  }
  const C = { grid: 'rgba(139,150,173,.22)', text: '#8b96ad', bright: '#e6ebf5', accent: '#5eead4' };

  function colorbar(ctx, x, y, w, h) {
    for (let i = 0; i < h; i++) { ctx.fillStyle = lutCss(LUT_DB, Math.round(255 * (1 - i / h))); ctx.fillRect(x, y + i, w, 1.5); }
    ctx.fillStyle = C.text; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText('0', x - 4, y + 4); ctx.fillText(`−${S.dyn}`, x - 4, y + h - 4); ctx.fillText('dB', x - 4, y + h / 2);
  }

  function drawStatic() { draw3D(); drawUV(); drawArray(); drawCut(); drawS11(); nearDirty = true; }

  /* ---------- 3D ---------- */
  function draw3D() {
    const { ctx, w, h } = fit($('#cv-3d'));
    const { nt, np, P: pw } = R.hemi;
    const sc = Math.min(w * 0.44, h * 0.72), cx = w / 2, cy = h * 0.8;
    const ca = Math.cos(view.az), sa = Math.sin(view.az), ce = Math.cos(view.el), se = Math.sin(view.el);
    // Orthographic projection: returns [screen X, screen Y, closeness to camera]
    const proj = (x, y, z) => { const xr = x * ca - y * sa, yr = x * sa + y * ca; return [cx + xr * sc, cy - (yr * se + z * ce) * sc, -yr * ce + z * se]; };
    const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };

    // Ground: level circles and axes
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (const rr of [0.5, 1]) {
      ctx.beginPath();
      for (let k = 0; k <= 72; k++) { const a = (k / 72) * 2 * Math.PI, p = proj(rr * Math.cos(a), rr * Math.sin(a), 0); k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
      ctx.stroke();
    }
    const o = proj(0, 0, 0);
    ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    [['x', 1.12, 0, 0], ['y', 0, 1.12, 0], ['z', 0, 0, 1.1]].forEach(([n, x, y, z]) => { const p = proj(x, y, z); line(o, p); ctx.fillText(n, p[0] + (p[0] - o[0]) * 0.06, p[1] + (p[1] - o[1]) * 0.06); });

    // Pattern surface: r = level in dB mapped to [0, 1]
    const V = new Float32Array(nt * np * 4);
    for (let i = 0; i < nt; i++) {
      const th = (i / (nt - 1)) * Math.PI / 2, st = Math.sin(th), ct = Math.cos(th);
      for (let j = 0; j < np; j++) {
        const ph = (j / np) * 2 * Math.PI, r = Math.max(0, 1 + toDb(pw[i * np + j]) / S.dyn);
        const p = proj(r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct), k = (i * np + j) * 4;
        V[k] = p[0]; V[k + 1] = p[1]; V[k + 2] = p[2]; V[k + 3] = r;
      }
    }
    const quads = [];
    for (let i = 0; i < nt - 1; i++) for (let j = 0; j < np; j++) {
      const a = (i * np + j) * 4, b = (i * np + ((j + 1) % np)) * 4, c = b + np * 4, d = a + np * 4;
      const r = (V[a + 3] + V[b + 3] + V[c + 3] + V[d + 3]) / 4;
      if (r > 0.004) quads.push([(V[a + 2] + V[b + 2] + V[c + 2] + V[d + 2]) / 4, a, b, c, d, r]);
    }
    quads.sort((p, q) => p[0] - q[0]);
    ctx.lineWidth = 0.7; ctx.lineJoin = 'round';
    for (const q of quads) {
      // Colour follows the level
      const col = lutCss(LUT_DB, Math.round(255 * Math.min(1, q[5])));
      ctx.fillStyle = ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(V[q[1]], V[q[1] + 1]);
      for (let k = 2; k <= 4; k++) ctx.lineTo(V[q[k]], V[q[k] + 1]);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // Steered directions
    S.beams.forEach((b, i) => {
      const [u, v] = beamUV(b), wz = Math.cos(b.theta * DEG), p = proj(u * 1.12, v * 1.12, wz * 1.12);
      ctx.strokeStyle = ctx.fillStyle = BEAM_COLORS[i]; ctx.lineWidth = i === S.sel ? 2 : 1.2; ctx.setLineDash([4, 4]);
      line(o, p); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, 7); ctx.fill();
      ctx.fillText(String(i + 1), p[0] + 9, p[1] - 8);
    });
    colorbar(ctx, w - 18, 14, 8, Math.min(120, h * 0.4));
  }

  /* ---------- u-v ---------- */
  function drawUV() {
    const { ctx, w, h } = fit($('#cv-uv'));
    const rad = Math.max(20, Math.min(w - 90, h - 44) / 2), cx = w / 2 - 6, cy = h / 2;
    R.uvGeom = { cx, cy, rad };
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.clip();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(uvCanvas, cx - rad, cy - rad, rad * 2, rad * 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(230,235,245,.25)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(230,235,245,.6)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    for (const t of [30, 60, 90]) {
      const r = rad * Math.sin(t * DEG);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
      if (t < 90) ctx.fillText(t + '°', cx + r * 0.707 + 2, cy - r * 0.707);
    }
    ctx.beginPath(); ctx.moveTo(cx - rad, cy); ctx.lineTo(cx + rad, cy); ctx.moveTo(cx, cy - rad); ctx.lineTo(cx, cy + rad); ctx.stroke();
    ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('u  φ=0°', cx + rad + 26, cy); ctx.fillText('v  φ=90°', cx, cy - rad - 10);
    S.beams.forEach((b, i) => {
      const [u, v] = beamUV(b), x = cx + u * rad, y = cy - v * rad;
      ctx.strokeStyle = BEAM_COLORS[i]; ctx.lineWidth = i === S.sel ? 2.5 : 1.5;
      ctx.beginPath(); ctx.arc(x, y, i === S.sel ? 9 : 7, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); ctx.stroke();
      ctx.fillStyle = BEAM_COLORS[i]; ctx.fillText(String(i + 1), x + 14, y - 11);
    });
    colorbar(ctx, w - 16, cy - rad * 0.6, 8, rad * 1.2);
  }

  /* ---------- Array excitation ---------- */
  function drawArray() {
    const { ctx, w, h } = fit($('#cv-arr'));
    const { nx, ny, dx, dy, amp, phase } = R.w;
    const bar = 34, sc = Math.min((w - 36) / (nx * dx), (h - bar - 30) / (ny * dy));
    const cx = w / 2, cy = (h - bar) / 2 + 4;
    const pl = S.elem === 'patch' ? Math.min((S.L * 1e-3) / R.lam, dx * 1.2) * sc : 0;
    const pwd = S.elem === 'patch' ? Math.min((S.W * 1e-3) / R.lam, dy * 1.2) * sc : 0;
    for (let m = 0; m < nx; m++) for (let n = 0; n < ny; n++) {
      const i = m * ny + n, x = cx + (m - (nx - 1) / 2) * dx * sc, y = cy - (n - (ny - 1) / 2) * dy * sc;
      const hue = (((phase[i] / (2 * Math.PI)) * 360) % 360 + 360) % 360;
      ctx.fillStyle = `hsla(${hue},85%,60%,${0.12 + 0.88 * amp[i]})`;
      ctx.strokeStyle = `hsla(${hue},85%,70%,.7)`; ctx.lineWidth = 1;
      ctx.beginPath();
      if (S.elem === 'patch') ctx.rect(x - pl / 2, y - pwd / 2, pl, pwd);
      else ctx.arc(x, y, Math.max(2, Math.min(dx, dy) * sc * 0.22), 0, 7);
      ctx.fill(); ctx.stroke();
    }
    // Phase legend + axes
    const lw = Math.min(w - 60, 180), lx = cx - lw / 2, ly = h - 24;
    for (let i = 0; i < lw; i++) { ctx.fillStyle = `hsl(${(i / lw) * 360},85%,60%)`; ctx.fillRect(lx + i, ly, 1.5, 6); }
    ctx.fillStyle = C.text; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillText('0°', lx, ly + 9);
    ctx.textAlign = 'right'; ctx.fillText('360°', lx + lw, ly + 9);
    ctx.textAlign = 'center'; ctx.fillText('phase', cx, ly + 9);
    ctx.strokeStyle = C.text; ctx.textBaseline = 'middle';
    ctx.beginPath(); ctx.moveTo(12, h - bar - 6); ctx.lineTo(34, h - bar - 6); ctx.moveTo(12, h - bar - 6); ctx.lineTo(12, h - bar - 28); ctx.stroke();
    ctx.fillText('x', 40, h - bar - 6); ctx.fillText('y', 12, h - bar - 35);
  }

  /* ---------- Cut ---------- */
  function drawCut() {
    const { ctx, w, h } = fit($('#cv-cut'));
    const m = { l: 40, r: 14, t: 14, b: 28 }, pw = w - m.l - m.r, ph = h - m.t - m.b, db = R.cut.db;
    const X = (deg) => m.l + ((deg + 90) / 180) * pw, Y = (d) => m.t + (-Math.max(d, -S.dyn) / S.dyn) * ph;
    ctx.strokeStyle = C.grid; ctx.fillStyle = C.text; ctx.lineWidth = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let d = 0; d >= -S.dyn; d -= 10) { ctx.beginPath(); ctx.moveTo(m.l, Y(d)); ctx.lineTo(w - m.r, Y(d)); ctx.stroke(); ctx.fillText(d ? '−' + -d : '0', m.l - 6, Y(d)); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let t = -90; t <= 90; t += 30) { ctx.beginPath(); ctx.moveTo(X(t), m.t); ctx.lineTo(X(t), m.t + ph); ctx.stroke(); ctx.fillText(t + '°', X(t), m.t + ph + 6); }
    ctx.fillText('θ', w - m.r - 4, m.t + ph + 6 - 22);
    // −3 dB marker
    ctx.strokeStyle = 'rgba(251,191,36,.5)'; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(m.l, Y(-3)); ctx.lineTo(w - m.r, Y(-3)); ctx.stroke(); ctx.setLineDash([]);
    // Beams lying in this plane
    S.beams.forEach((b, i) => {
      const d = ((b.phi - R.cut.phi) % 360 + 360) % 360;
      const t = d < 1 || d > 359 ? b.theta : Math.abs(d - 180) < 1 ? -b.theta : b.theta < 0.5 ? 0 : null;
      if (t === null) return;
      ctx.strokeStyle = BEAM_COLORS[i]; ctx.globalAlpha = 0.7; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(X(t), m.t); ctx.lineTo(X(t), m.t + ph); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    });
    const path = new Path2D();
    for (let i = 0; i < CUT_N; i++) { const x = X(i * 0.5 - 90), y = Y(db[i]); i ? path.lineTo(x, y) : path.moveTo(x, y); }
    const fill = new Path2D(path); fill.lineTo(X(90), m.t + ph); fill.lineTo(X(-90), m.t + ph); fill.closePath();
    const g = ctx.createLinearGradient(0, m.t, 0, m.t + ph);
    g.addColorStop(0, 'rgba(94,234,212,.35)'); g.addColorStop(1, 'rgba(94,234,212,0)');
    ctx.fillStyle = g; ctx.fill(fill);
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke(path);
  }

  /* ---------- S11 ---------- */
  function drawS11() {
    const { ctx, w, h } = fit($('#cv-s11'));
    const m = { l: 30, r: 8, t: 8, b: 18 }, pw = w - m.l - m.r, ph = h - m.t - m.b, f0 = S.f * 1e9, span = 0.15, lo = -30;
    const X = (f) => m.l + ((f / f0 - (1 - span)) / (2 * span)) * pw, Y = (d) => m.t + (Math.max(d, lo) / lo) * ph;
    ctx.strokeStyle = C.grid; ctx.fillStyle = C.text; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = '10px ui-monospace, Consolas, monospace';
    for (let d = 0; d >= lo; d -= 10) { ctx.beginPath(); ctx.moveTo(m.l, Y(d)); ctx.lineTo(w - m.r, Y(d)); ctx.stroke(); ctx.fillText(d ? '−' + -d : '0', m.l - 4, Y(d)); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    [1 - span, 1, 1 + span].forEach((k, i) => { ctx.textAlign = ['left', 'center', 'right'][i]; ctx.fillText((S.f * k).toFixed(2) + (i === 2 ? ' GHz' : ''), X(f0 * k), m.t + ph + 4); });
    ctx.strokeStyle = 'rgba(251,191,36,.5)'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(m.l, Y(-10)); ctx.lineTo(w - m.r, Y(-10)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(230,235,245,.5)'; ctx.beginPath(); ctx.moveTo(X(f0), m.t); ctx.lineTo(X(f0), m.t + ph); ctx.stroke();
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const f = f0 * (1 - span + (2 * span * i) / 160), g = P.gammaOf(P.zinAt(R.patch, f), S.z0).mag;
      const y = Y(20 * Math.log10(Math.max(g, 1e-4)));
      i ? ctx.lineTo(X(f), y) : ctx.moveTo(X(f), y);
    }
    ctx.stroke();
  }

  /* ---------- Near field (animated) ---------- */
  function drawNear() {
    const nf = R.near; if (!nf) return;
    const { ctx, w, h } = fit($('#cv-near'));
    const m = NEAR_PAD, aw = w - m.l - m.r, ah = h - m.t - m.b, N = nf.cols * nf.rows, d = nf.img.data;
    if (S.nfMode === 'dB') {
      for (let i = 0, k = 0; i < N; i++, k += 4) { const c = nf.dbIdx[i] * 3; d[k] = LUT_DB[c]; d[k + 1] = LUT_DB[c + 1]; d[k + 2] = LUT_DB[c + 2]; d[k + 3] = 255; }
    } else {
      // Re{F·e^{jωt}}: the wave travels away from the array as the time phase advances
      const lut = S.nfMode === 'E' ? LUT_E : LUT_H, c0 = Math.cos(wavePhase), s0 = Math.sin(wavePhase);
      for (let i = 0, k = 0; i < N; i++, k += 4) {
        const v = (nf.re[i] * c0 - nf.im[i] * s0) * nf.scale[i];
        const c = Math.max(0, Math.min(255, Math.round(127.5 + v * 127.5))) * 3;
        d[k] = lut[c]; d[k + 1] = lut[c + 1]; d[k + 2] = lut[c + 2]; d[k + 3] = 255;
      }
    }
    nearCanvas.getContext('2d').putImageData(nf.img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(nearCanvas, m.l, m.t, aw, ah);

    const X = (s) => m.l + ((s + nf.half) / (2 * nf.half)) * aw, Y = (z) => m.t + (1 - z / nf.zmax) * ah;
    const cp = Math.cos(nf.phi0), sp = Math.sin(nf.phi0);
    ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, aw, ah); ctx.clip();
    // Far-field (Fraunhofer) boundary when it falls inside the window
    const rf = R.farField / R.lam;
    if (rf < Math.hypot(nf.half, nf.zmax)) {
      ctx.strokeStyle = 'rgba(230,235,245,.4)'; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.ellipse(X(0), Y(0), (rf / (2 * nf.half)) * aw, (rf / nf.zmax) * ah, 0, Math.PI, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(230,235,245,.6)'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('2D²/λ', X(0), Y(rf) - 3);
    }
    // Rays of the beams lying in this plane
    S.beams.forEach((b, i) => {
      const [u, v] = beamUV(b), inPlane = u * cp + v * sp, out = -u * sp + v * cp, wz = Math.cos(b.theta * DEG);
      if (Math.abs(out) > 0.03) return;
      const len = 3 * nf.half;
      ctx.strokeStyle = BEAM_COLORS[i]; ctx.lineWidth = 1.3; ctx.setLineDash([6, 5]); ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(inPlane * len), Y(wz * len)); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    });
    ctx.restore();
    // Array (trace of the aperture in the cut plane)
    const ext = (Math.abs(cp) * (S.nx - 1) * S.dx + Math.abs(sp) * (S.ny - 1) * S.dy) / 2 + 0.25;
    ctx.strokeStyle = C.accent; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(X(-ext), m.t + ah); ctx.lineTo(X(ext), m.t + ah); ctx.stroke(); ctx.lineCap = 'butt';
    // Axes graduated in wavelengths
    ctx.fillStyle = C.text; ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    const step = nf.half <= 6 ? 2 : nf.half <= 15 ? 5 : 10;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let s = -Math.floor(nf.half / step) * step; s <= nf.half; s += step) ctx.fillText(s + 'λ', X(s), m.t + ah + 6);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let z = step; z < nf.zmax; z += step) ctx.fillText(z + 'λ', m.l - 5, Y(z));
    ctx.textBaseline = 'top'; ctx.fillText('z', m.l - 5, m.t);

    // Probe
    if (probe && probe.x >= m.l && probe.x <= m.l + aw && probe.y >= m.t && probe.y <= m.t + ah) {
      const c = Math.min(nf.cols - 1, Math.floor(((probe.x - m.l) / aw) * nf.cols)), r = Math.min(nf.rows - 1, Math.floor(((probe.y - m.t) / ah) * nf.rows));
      const s = nf.half * ((2 * (probe.x - m.l)) / aw - 1), z = nf.zmax * (1 - (probe.y - m.t) / ah);
      // Calibrated on the far field: E_rms = √(30·Pin·G) / r towards the maximum
      const E = (Math.sqrt(30 * R.pin * R.G) / (Math.sqrt(R.pmax) * R.lam)) * nf.mag[r * nf.cols + c];
      const Hf = E / P.ETA0, Sd = (E * E) / P.ETA0, dist = Math.hypot(s, z) * R.lam;
      const eng = (x, u) => (x >= 1 ? x.toPrecision(3) + ' ' + u : x >= 1e-3 ? (x * 1e3).toPrecision(3) + ' m' + u : (x * 1e6).toPrecision(3) + ' µ' + u);
      const lines = [`r = ${fmtLen(dist)}  (${Math.hypot(s, z).toFixed(1)} λ)`, `E = ${eng(E, 'V/m')}`, `H = ${eng(Hf, 'A/m')}`, `S = ${eng(Sd, 'W/m²')}`];
      ctx.strokeStyle = 'rgba(230,235,245,.7)'; ctx.beginPath(); ctx.arc(probe.x, probe.y, 4, 0, 7); ctx.stroke();
      const bw = 172, bh = lines.length * 15 + 10, bx = probe.x + 14 + bw > w ? probe.x - 14 - bw : probe.x + 14, by = Math.min(Math.max(probe.y - bh / 2, m.t), m.t + ah - bh);
      ctx.fillStyle = 'rgba(9,13,21,.88)'; ctx.strokeStyle = '#2f3a54';
      ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.bright; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      lines.forEach((t, i) => ctx.fillText(t, bx + 8, by + 7 + i * 15));
    }
    nearDirty = false;
  }

  /* ------------------------------------------------------------------ */
  /* View interactions                                                   */
  /* ------------------------------------------------------------------ */
  function bindCanvases() {
    // u-v: selects the clicked beam, otherwise moves the active beam
    const uv = $('#cv-uv');
    const aim = (e, pick) => {
      const r = uv.getBoundingClientRect(), g = R.uvGeom; if (!g) return;
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (pick) {
        let best = -1, bd = 14;
        S.beams.forEach((b, i) => { const [u, v] = beamUV(b), d = Math.hypot(x - (g.cx + u * g.rad), y - (g.cy - v * g.rad)); if (d < bd) { bd = d; best = i; } });
        if (best >= 0) { S.sel = best; syncBeams(); needAll = true; return; }
      }
      const u = (x - g.cx) / g.rad, v = -(y - g.cy) / g.rad, b = S.beams[S.sel];
      b.theta = Math.round(Math.min(80, Math.asin(Math.min(1, Math.hypot(u, v))) / DEG) * 2) / 2;
      b.phi = Math.round(((Math.atan2(v, u) / DEG) + 360) % 360) % 360;
      syncBeams(); needAll = true;
    };
    uv.addEventListener('pointerdown', (e) => { uv.setPointerCapture(e.pointerId); aim(e, true); });
    uv.addEventListener('pointermove', (e) => { if (e.buttons & 1) aim(e, false); });

    // 3D: rotation
    const c3 = $('#cv-3d');
    let last = null;
    c3.addEventListener('pointerdown', (e) => { c3.setPointerCapture(e.pointerId); last = [e.clientX, e.clientY]; });
    c3.addEventListener('pointermove', (e) => {
      if (!last || !(e.buttons & 1)) return;
      view.az += (e.clientX - last[0]) * 0.01;
      view.el = Math.min(1.5, Math.max(0.05, view.el + (e.clientY - last[1]) * 0.01));
      last = [e.clientX, e.clientY]; draw3D();
    });
    c3.addEventListener('pointerup', () => { last = null; });

    // Near field: probe
    const cn = $('#cv-near');
    cn.addEventListener('pointermove', (e) => { const r = cn.getBoundingClientRect(); probe = { x: e.clientX - r.left, y: e.clientY - r.top }; nearDirty = true; });
    cn.addEventListener('pointerleave', () => { probe = null; nearDirty = true; });

    new ResizeObserver(() => { if (R.w) { needNear = true; drawStatic(); } }).observe($('.grid'));
  }

  /* ------------------------------------------------------------------ */
  /* Main loop                                                           */
  /* ------------------------------------------------------------------ */
  let lastT = 0;
  function frame(t) {
    const dt = Math.min(0.1, (t - lastT) / 1000 || 0); lastT = t;
    if (needAll) { needAll = needNear = false; recompute(); }
    else if (needNear) { needNear = false; computeNear(); }
    const animated = S.play && S.nfMode !== 'dB';
    if (animated) wavePhase = (wavePhase + dt * 2 * Math.PI * 0.8) % (2 * Math.PI);
    if (animated || nearDirty) drawNear();
    requestAnimationFrame(frame);
  }

  // At start-up the feed is placed at the Z0 match point.
  {
    const d = P.designPatch(S.f * 1e9, S.er, S.h * 1e-3);
    S.inset = Math.round(P.analyzePatch({ f: S.f * 1e9, er: S.er, h: S.h * 1e-3, W: d.W, L: d.L, inset: 0, z0: S.z0 }).insetMatch * 1000) / 10;
  }
  buildControls();
  renderBeams();
  bindCanvases();
  syncMisc();
  requestAnimationFrame(frame);

  // Console access for the curious: GridBeam.state, GridBeam.results
  window.GridBeam = { state: S, results: R };
})();
