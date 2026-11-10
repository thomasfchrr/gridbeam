# GridBeam

Simulateur interactif, dans le navigateur, d'un **réseau planaire d'antennes patch** avec **formation de faisceaux multiples** (multi-beamforming).

On règle le nombre de patchs, leur taille, le substrat, l'impédance d'alimentation et les directions visées ; le diagramme de rayonnement, l'excitation du réseau et les champs E / H se mettent à jour en temps réel.

Aucune dépendance, aucune étape de build : du HTML, du CSS et du JavaScript.

## Lancer

Ouvrez simplement `index.html` dans un navigateur récent.

Ou, pour le servir en local :

```bash
python -m http.server 5173
```

puis rendez-vous sur <http://localhost:5173>.

## Prise en main

1. Choisissez un **scénario** en haut à droite (faisceau unique, double faisceau, quatre faisceaux, lobes de réseau…).
2. **Cliquez ou glissez dans la carte u-v** pour pointer le faisceau actif. « + Ajouter un faisceau » en crée jusqu'à six, émis simultanément.
3. Dans **Antenne patch**, changez la fréquence, le substrat (εr, h), les dimensions W et L, la position de l'alimentation et Z₀. Le bouton « Adapter l'alimentation à Z₀ » place l'encastrement au point d'adaptation.
4. Regardez l'onde se propager dans la **coupe verticale**, basculez entre E(t), H(t) et |E| en dB, et survolez la vue pour sonder les champs.

## Les vues

| Vue | Ce qu'elle montre |
| --- | --- |
| Diagramme 3D | Niveau rayonné (dB) dans le demi-espace au-dessus du réseau. Glisser pour tourner. |
| Espace u-v | Le même diagramme vu du dessus : `u = sinθ·cosφ`, `v = sinθ·sinφ`. Centre = normale au réseau, bord = horizon. |
| Excitation du réseau | Chaque patch à l'échelle ; teinte = phase, opacité = amplitude. |
| Champ rayonné | Coupe verticale du champ, somme cohérente des ondes de tous les éléments. Sonde au survol : E (V/m), H (A/m), densité de puissance S (W/m²). |
| Coupe du diagramme | Niveau en fonction de θ dans le plan vertical du faisceau actif, avec repère à −3 dB. |
| S₁₁ | Coefficient de réflexion du patch autour de la fréquence de travail. |

Indicateurs affichés : directivité, gain réalisé, PIRE, ouverture à −3 dB, niveau de lobes secondaires, impédance d'entrée, ROS, fréquence de résonance, bande passante, distance de zone lointaine. Des avertissements signalent les lobes de réseau, le chevauchement des patchs, la désadaptation et un patch hors résonance.

## Paramètres

| Groupe | Paramètres |
| --- | --- |
| Réseau | Nombre d'éléments en x et y (1 à 16), pas en x et y (0,25 à 1,5 λ), pondération (uniforme, cosinus, Hamming, Dolph-Chebyshev), quantification des déphaseurs (2 à 6 bits), type d'élément (patch ou source isotrope). |
| Faisceaux | Pour chacun : dépointage θ, azimut φ, niveau relatif. |
| Patch | Fréquence, εr, épaisseur h, largeur W, longueur L (automatiques ou manuelles), encastrement de l'alimentation, Z₀. |
| Affichage | Dynamique en dB, puissance injectée. |

## Modèle physique

Tout est analytique ; les formules viennent du modèle ligne de transmission / cavité (C. A. Balanis, *Antenna Theory*, ch. 14) et de la théorie classique des réseaux.

**Patch rectangulaire**

```
W     = c / (2f) · √(2 / (εr + 1))
εeff  = (εr + 1)/2 + (εr − 1)/2 · (1 + 12h/W)^(−1/2)
ΔL    = 0,412·h · (εeff + 0,3)(W/h + 0,264) / ((εeff − 0,258)(W/h + 0,8))
L     = c / (2f·√εeff) − 2ΔL
```

**Impédance d'entrée**

```
Rbord = 1 / (2·(G1 + G12))          G1, G12 : conductances propre et mutuelle des fentes (intégrées numériquement)
Rin   = Rbord · cos²(π·y0 / L)      alimentation encastrée à y0
Zin(f) = Rin / (1 + jQ·(f/fr − fr/f))
BW    ≈ 3,77 · (εr − 1)/εr² · (W/L) · (h/λ0)      (ROS < 2),   Q = 1 / (BW·√2)
```

**Diagramme d'un élément** (deux fentes rayonnantes, plan de masse infini, L selon x)

```
|E|² ∝ sinc²(k·W·v / 2) · cos²(k·Leff·u / 2) · (1 − v²)
```

**Réseau et faisceaux multiples**

```
w_mn = a_m · a_n · Σ_b A_b · exp(−j·k·(x_m·u_b + y_n·v_b))
AF(u, v) = Σ_m Σ_n w_mn · exp(+j·k·(x_m·u + y_n·v))
```

Chaque faisceau apporte son gradient de phase ; les jeux de poids sont additionnés, puis la phase est éventuellement quantifiée.

**Directivité et gain**

```
D = 4π · Pmax / ∬ P(θ, φ) · sinθ dθ dφ        (intégration numérique sur le demi-espace)
G réalisé = D · (1 − |S11|²)
```

**Champ dans la coupe verticale**

```
F(P) = Σ w_mn · g(direction) · exp(−j·k·r_mn) / r_mn
E(t) = Re{F · e^(jωt)},     H = E / η0  (η0 ≈ 377 Ω)
```

Les valeurs absolues de la sonde sont étalonnées sur le champ lointain : `E = √(30·Pin·G) / r` dans la direction du maximum.

### Validation

Sur l'exemple classique de Balanis (10 GHz, εr = 2,2, h = 1,588 mm, W = 11,86 mm, L = 9,06 mm), le moteur redonne fr ≈ 10,0 GHz, Rbord ≈ 228 Ω et un encastrement d'adaptation à 50 Ω de 3,13 mm. La pondération Dolph-Chebyshev à 8 éléments et −30 dB redonne les coefficients tabulés (0,262 · 0,519 · 0,812 · 1).

### Limites

- Pas de couplage mutuel entre patchs, pas d'ondes de surface, plan de masse infini.
- Pertes diélectriques et conductrices ignorées : le gain réalisé ne tient compte que de la désadaptation.
- Tout près du réseau (zone réactive), les valeurs de champ sont indicatives.
- Ce n'est pas un solveur full-wave : pour dimensionner une antenne réelle, validez avec un outil de simulation électromagnétique.

## Structure

```
index.html        page, panneau de contrôle et guide intégré
css/style.css     thème et mise en page
js/physics.js     moteur : patch, pondérations, facteur de réseau, champ proche
js/app.js         état, contrôles, rendus canvas, interactions
```

`js/physics.js` n'utilise pas le DOM et peut être chargé dans Node (`require('./js/physics.js')`) pour des calculs hors navigateur.

## Licence

MIT — voir [LICENSE](LICENSE).
