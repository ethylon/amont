# Audit design du site amont.dev (skill design-taste-frontend)

> **Statut : correctifs appliqués.** Toutes les non-conformités listées ci-dessous ont
> été corrigées dans les commits qui suivent celui-ci sur la même branche, à une
> exception près : le caractère `↗` des liens externes est conservé (c'est de la
> typographie, pas un SVG dessiné à la main ; le skill ne l'interdit pas).

Date : 2026-07-23. Périmètre : `site/` (landing EN/FR, pages download, 404) et les
points de contact avec `brand/`. L'application Electron (`src/renderer`) est une UI
produit dense, hors périmètre de ce skill (Section 13) ; elle n'est pas auditée ici.

**Lecture du brief** : site produit d'un client Git open source pour Windows, audience
développeurs, langage minimaliste type Linear, Geist + Tailwind v4, thème double.
Cadrans estimés de l'existant : VARIANCE 5, MOTION 3, DENSITY 3. Ces valeurs sont
cohérentes avec le produit et l'audience ; il n'y a pas lieu de les changer.

## Verdict global

Le site passe environ 90 % de la grille pre-flight du skill, ce qui est nettement
au-dessus de la moyenne. Les fondamentaux sont excellents : un seul accent (Courant
`#5B8FD6`, issu de la marque), neutres zinc uniques, Geist + Geist Mono, hero
asymétrique, vraies captures d'écran light/dark, démo interactive du vrai renderer,
motion discret et entièrement dégradable, accessibilité soignée. Les non-conformités
restantes sont typographiques et de calibrage, pas structurelles.

## Points forts (à préserver tels quels)

- **Assets réels.** Captures produit réelles en paires light/dark, et surtout la démo
  embarquée du vrai renderer dans le hero. C'est l'exact opposé du « faux screenshot
  en divs » que le skill bannit ; c'est la meilleure preuve produit possible.
- **Zéro tell IA majeur.** Aucun eyebrow uppercase (0 sur 5 sections, la grille en
  tolère 2), pas de dégradé violet, pas de rangée de trois cartes égales, pas de
  glassmorphism gratuit, pas de scroll cue, pas de faux chiffres (le « 100 000+ » est
  assumé et le texte précise honnêtement que la capture montre ~25 000 commits).
- **Discipline CTA.** Une seule intention primaire, un seul libellé (« Download for
  Windows ») répété à l'identique ; le secondaire (« View the source ») porte une
  intention distincte. Conforme à la règle « un libellé par intention ».
- **Motion motivé et dégradable.** Starfield, impulsions du graphe décoratif et
  reveal-on-scroll sont tous derrière `prefers-reduced-motion`, le reveal est
  transform-only (le contenu n'est jamais masqué sans JS), et tout passe par
  IntersectionObserver, jamais par un listener scroll. Conforme aux sections 5.D et 6.B.
- **Thème.** Double thème complet, résolu avant le premier paint, toggle + préférence
  système. L'îlot sombre de la section Trust en mode clair est l'unique inversion de
  la page : c'est exactement l'exception « color block » unique que la Section 4.11
  autorise, et elle est motivée (la console est toujours sombre dans le produit).
- **Cohérence accent documentée.** La sélection (`::selection`) utilise Iris
  `#8F8FE8`, qui n'est pas l'accent principal, mais c'est un token de marque documenté
  (« Iris : tags, sélection » dans les guidelines). Règle écrite et suivie : conforme
  au Color Consistency Lock.
- **Perf et SEO.** Image LCP eager + `fetchpriority=high`, préchargement de la fonte,
  variantes responsive, canonical + hreflang + JSON-LD SoftwareApplication. Solide.
- **Copy.** Concrète, honnête (l'encart SmartScreen est un modèle du genre), sans
  verbes creux. Aucune correction demandée par l'auto-audit de copy.

## Non-conformités

### 1. Tirets cadratins visibles (Section 9.G, règle binaire du skill)

Le skill interdit tout `—` visible. Occurrences dans des chaînes rendues :

- `site/src/i18n/ui.ts:135` : `"Command log — read-only"` (affiché sur la page, section Trust)
- `site/src/i18n/ui.ts:230` : `"Journal des commandes — lecture seule"` (idem, FR)
- `site/src/i18n/ui.ts:61` et `:156` : titres meta `"Amont — Git history you can actually read"` (onglet + SERP)
- `site/src/i18n/ui.ts:145` et `:240` : `pageTitle` des pages download
- `site/src/pages/404.astro:10` : `<title>404 — Amont</title>`

Correctif suggéré : pour le label de console, « Read-only command log » / « Journal
des commandes (lecture seule) ». Pour les titres meta, un séparateur `·` ou `:`
(« Amont · Git history you can actually read »). Les `—` dans les commentaires de
code ne comptent pas.

### 2. Rationnement du point médian (Section 9.F : max 1 par ligne)

- `Landing.astro:93` et `DownloadPage.astro:51` : `v0.37.1 · Windows · MIT` (2 points médians)
- `404.astro:26` : `Page not found · Page introuvable` (1 seul, conforme ; listé pour mémoire)

Correctif : garder un seul séparateur, p. ex. `v0.37.1 · Windows, MIT` ou éclater
l'information (voir point 3).

### 3. Strip version sous les CTA du hero (Sections 4.7 et 9.F)

`v{version} · Windows · MIT` sous les CTA est à la fois un « version label » et une
« tiny tagline below CTAs », deux motifs bannis du hero par défaut. Le contexte
atténue : pour un produit open source à télécharger, version, plateforme et licence
sont de l'information réelle, pas de la décoration. Mais la redondance est réelle :
« Windows » est déjà dans le libellé du CTA, « MIT » est déjà porté par la section
Trust. Recommandation : réserver ce strip à la page download (où il est légitime) et
le retirer du hero de la landing.

### 4. Lede du hero trop long (Section 4.7 : max 20 mots)

`ui.ts:68` : le lede EN fait ~38 mots sur 3 phrases (le FR est équivalent). Le
premier tiers duplique ce que la capture montre déjà juste en dessous.
Piste : « Your repository as one fast, readable commit graph. Smooth at 100,000+
commits, keyboard-driven if you want. » (~17 mots), le détail des lanes/tags/stashs
restant porté par la section « The graph is the point ».

### 5. Zigzag ×3 dans le tour (Section 4.7 : cap à 2 consécutifs)

`Landing.astro:155-174` : les trois arrêts du tour sont trois splits image+texte
consécutifs en alternance. Le cap du skill est 2 ; le troisième doit casser le motif.
Piste : passer le dernier arrêt (résolution de conflits, la capture la plus
spectaculaire) en pleine largeur, titre au-dessus, image dessous.

### 6. Icônes SVG dessinées à la main (Sections 3.C et 9.E)

Flèche de téléchargement (`Landing.astro:67`, `DownloadPage.astro:34`), glyphe
terminal (`CommandLog.astro:25`), demi-lune du toggle (`Nav.astro:89`) et chevron
externe `↗` en caractère texte. Les glyphes sont propres, mais le skill impose une
bibliothèque, et l'application utilise déjà HugeIcons : reprendre
`@hugeicons/core-free-icons` côté site alignerait les deux surfaces avec un
strokeWidth commun.

### 7. Divers mineurs

- `global.css:21` : `scroll-behavior: smooth` non conditionné ; à placer sous
  `@media (prefers-reduced-motion: no-preference)`.
- `Landing.astro:51` : `sm:pt-28` (7 rem) dépasse le cap `pt-24` du hero. Marginal
  (la nav sticky de 4 rem en absorbe une partie), à ramener à `pt-24` si retouche.
- `404.astro:23` : `min-h-screen` ; le skill impose `min-h-[100dvh]` (barre
  d'adresse iOS).
- `Nav.astro:33` : sous 640 px, les liens Graph/Tour/Download disparaissent sans
  menu de repli. Le CTA du hero couvre le téléchargement, mais « Tour » devient
  inatteignable au clavier mobile autrement qu'en scrollant. Un lien « Download »
  conservé en mobile suffirait.

### 8. Cas limites jugés conformes (pour trancher les débats futurs)

- **CommandLog** est un terminal construit en HTML, ce que le skill bannit en tant
  que « faux screenshot ». Il est ici acceptable : c'est la reproduction fidèle d'un
  composant réel du produit (la console lecture seule), peuplée de vraies commandes,
  soit la clause « real component preview » de la Section 4.8.
- **Starfield et GraphBg** sont des SVG décoratifs faits main, motif que le skill
  décourage. Ils passent car ce sont des marques de composition simples, dérivées du
  motif de graphe de la marque (triade documentée dans les guidelines), statiques par
  défaut et animées seulement en ornement.

## Priorités de correction

1. Tirets cadratins visibles (mécanique, 7 chaînes) et points médians du strip version.
2. Lede du hero à ~20 mots ; retrait du strip version du hero de la landing.
3. Casse du 3e split du tour.
4. Icônes via HugeIcons ; `scroll-behavior` conditionné ; `100dvh` sur la 404.

Aucune refonte de structure, de palette ou de typographie n'est justifiée : les
fondations sont bonnes, l'audit ne demande que du polissage.
