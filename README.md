# GridBeam

An interactive, in-browser simulator of a **planar patch antenna array** with **multi-beamforming**.

**Live demo: <https://thomasfchrr.github.io/gridbeam/>**

Set the number of patches, their size, the substrate, the feed impedance and the steering directions; the radiation pattern, the array excitation and the E / H fields update in real time.

No dependencies and no build step: plain HTML, CSS and JavaScript.

## Run it

Open `index.html` in a recent browser.

Or serve it locally:

```bash
python -m http.server 5173
```

then go to <http://localhost:5173>.

## Getting started

1. Pick a **scenario** at the top right (single beam, dual beam, four beams, grating lobes…).
2. **Click or drag in the u-v map** to steer the active beam. "+ Add a beam" creates up to six, transmitted simultaneously.
3. Under **Patch antenna**, change the frequency, the substrate (εr, h), the dimensions W and L, the feed position and Z₀. The "Match feed to Z₀" button moves the inset to the match point.
4. Watch the wave propagate in the **vertical cut**, switch between E(t), H(t) and |E| in dB, and hover over the view to probe the fields.

## Views

| View | What it shows |
| --- | --- |
| 3D pattern | Radiated level (dB) in the half-space above the array. Drag to rotate. |
| u-v space | The same pattern seen from above: `u = sinθ·cosφ`, `v = sinθ·sinφ`. Centre = array normal, rim = horizon. |
| Array excitation | Each patch drawn to scale; hue = phase, opacity = amplitude. |
| Radiated field | Vertical cut of the field, the coherent sum of the waves from every element. Hover probe: E (V/m), H (A/m), power density S (W/m²). |
| Pattern cut | Level versus θ in the vertical plane of the active beam, with a −3 dB marker. |
| S₁₁ | Reflection coefficient of the patch around the operating frequency. |

Metrics shown: directivity, realized gain, EIRP, −3 dB beamwidth, sidelobe level, input impedance, VSWR, resonant frequency, bandwidth, far-field distance. Warnings flag grating lobes, overlapping patches, mismatch and an off-resonance patch.

## Parameters

| Group | Parameters |
| --- | --- |
| Array | Number of elements along x and y (1 to 16), spacing along x and y (0.25 to 1.5 λ), taper (uniform, cosine, Hamming, Dolph-Chebyshev), phase-shifter quantisation (2 to 6 bits), element type (patch or isotropic source). |
| Beams | For each one: steering angle θ, azimuth φ, relative level. |
| Patch | Frequency, εr, thickness h, width W, length L (automatic or manual), feed inset, Z₀. |
| Display | Dynamic range in dB, input power. |

## Physical model

Everything is analytical; the formulas come from the transmission-line / cavity model (C. A. Balanis, *Antenna Theory*, ch. 14) and classical array theory.

**Rectangular patch**

```
W     = c / (2f) · √(2 / (εr + 1))
εeff  = (εr + 1)/2 + (εr − 1)/2 · (1 + 12h/W)^(−1/2)
ΔL    = 0.412·h · (εeff + 0.3)(W/h + 0.264) / ((εeff − 0.258)(W/h + 0.8))
L     = c / (2f·√εeff) − 2ΔL
```

**Input impedance**

```
Redge = 1 / (2·(G1 + G12))          G1, G12: self and mutual slot conductances (integrated numerically)
Rin   = Redge · cos²(π·y0 / L)      feed inset at y0
Zin(f) = Rin / (1 + jQ·(f/fr − fr/f))
BW    ≈ 3.77 · (εr − 1)/εr² · (W/L) · (h/λ0)      (VSWR < 2),   Q = 1 / (BW·√2)
```

**Element pattern** (two radiating slots, infinite ground plane, L along x)

```
|E|² ∝ sinc²(k·W·v / 2) · cos²(k·Leff·u / 2) · (1 − v²)
```

**Array and multiple beams**

```
w_mn = a_m · a_n · Σ_b A_b · exp(−j·k·(x_m·u_b + y_n·v_b))
AF(u, v) = Σ_m Σ_n w_mn · exp(+j·k·(x_m·u + y_n·v))
```

Each beam contributes its own phase gradient; the weight sets are summed, then the phase is optionally quantised.

**Directivity and gain**

```
D = 4π · Pmax / ∬ P(θ, φ) · sinθ dθ dφ        (numerical integration over the half-space)
Realized gain = D · (1 − |S11|²)
```

**Field in the vertical cut**

```
F(P) = Σ w_mn · g(direction) · exp(−j·k·r_mn) / r_mn
E(t) = Re{F · e^(jωt)},     H = E / η0  (η0 ≈ 377 Ω)
```

The probe's absolute values are calibrated on the far field: `E = √(30·Pin·G) / r` towards the maximum.

### Validation

On Balanis's classic example (10 GHz, εr = 2.2, h = 1.588 mm, W = 11.86 mm, L = 9.06 mm), the engine returns fr ≈ 10.0 GHz, Redge ≈ 228 Ω and a 50 Ω match inset of 3.13 mm. The 8-element, −30 dB Dolph-Chebyshev taper reproduces the tabulated coefficients (0.262 · 0.519 · 0.812 · 1).

### Limitations

- No mutual coupling between patches, no surface waves, infinite ground plane.
- Dielectric and conductor losses are ignored: realized gain only accounts for mismatch.
- Very close to the array (reactive zone), field values are indicative only.
- This is not a full-wave solver: to design a real antenna, validate with an electromagnetic simulation tool.

## Structure

```
index.html        page, control panel and built-in guide
css/style.css     theme and layout
js/physics.js     engine: patch, tapers, array factor, near field
js/app.js         state, controls, canvas rendering, interactions
```

`js/physics.js` does not touch the DOM and can be loaded in Node (`require('./js/physics.js')`) for calculations outside the browser.

## License

MIT — see [LICENSE](LICENSE).
