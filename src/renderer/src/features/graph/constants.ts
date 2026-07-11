/* Constantes du moteur de graphe (AUDIT.md §6/§10, item « décomposition ») : géométrie, budgets
   de virtualisation et largeurs de colonnes en un seul endroit. Avant ce module, `FIXED_W` et le
   grid-template de `ROW_CLASS` (graph-canvas.ts) resommaient les mêmes largeurs à la main dans
   deux expressions séparées, susceptibles de dériver en silence l'une de l'autre — elles dérivent
   maintenant des mêmes constantes nommées. */

export const ROW = 28
export const LANE = 14
export const PAD = 10
export const R = 4

/** Bucket de montage/démontage du SVG (un `<g>` par chunk, cf. render/svg.ts) ET granularité de
    `layoutChunk` (le layout progresse par lots de cette taille). Les deux usages partagent
    volontairement la même constante : un lot de layout correspond à un chunk de rendu. */
export const CHUNK = 500

/** Taille d'une page `api.log` (data/loader.ts). */
export const PAGE = 1000

/** Fenêtre résidente du cache de pages de commits (data/page-cache.ts) : au-delà, les pages les
    moins récemment touchées sont évincées — hors pages sous le viewport ou sous la sélection. */
export const RESIDENT = 12

/** Nombre de teintes distinctes définies dans app.css (`--lane-0`..`--lane-9`) : au-delà,
    `laneColor` boucle — deux branches simultanées de rang 10 et 11 partagent alors la teinte
    des rangs 0 et 1. */
export const LANES = 10

/* ponytail: plafond de la colonne métro — au-delà, les lanes profondes sont rognées par le
   viewport du SVG plutôt que de pousser le sujet hors champ. Écart connu avec `LANES` (10) :
   les lanes 10 et 11 sont dessinées mais recyclent une teinte déjà utilisée plus à gauche ;
   étendre la palette (`--lane-10`/`--lane-11`) est un choix de designer qui dépasse ce
   refactor (AUDIT.md §6 le signale comme dette de constantes, pas comme bug visuel à corriger
   ici) — laissé en l'état, signalé dans la PR. */
export const MAX_LANES = 12

/* Les teintes vivent dans :root / .dark (cf. app.css) : un var() dans un attribut de
   présentation SVG suit le thème sans passer par une utility Tailwind. */
export const laneColor = (i: number) => `var(--lane-${i % LANES})`

/** gouttière d'une colonne, `pe-2.5` ou vide de fin de piste */
export const GAP = 10
export const TYPE_MAX = "max-w-28"
/** plafond du nom de branche : 96px, au-delà il défile au survol */
export const BRANCH_MAX = "max-w-24"
/* ponytail: budget fixe à 1 — la colonne fait la largeur d'un chip, en afficher deux demanderait
   de mesurer chaque ligne. Compter, pas mesurer. Les refs sont triées branche → tag (cf.
   parseRefs), donc `slice(0, 1)` garde bien le nom de branche prioritaire. */
export const BRANCH_BUDGET = 1

/* --- Largeurs de colonnes fixes : une seule source pour le grid-template ET pour FIXED_W ---
   Avant : `FIXED_W` resommait à la main les mêmes pixels que `grid-cols-[...]` littéral. Un
   changement de colonne (ajout, largeur) ne pouvait que dériver de l'un sans l'autre. */
/** décalage de la colonne graphe sous le SVG (`calc(var(--graphw,0px)+Npx)`) */
export const COL_GRAPH_GUTTER = 12
/** largeur minimale supposée de la colonne sujet (`1fr`, non fixe — sert seulement à estimer
    la largeur totale minimale de la ligne pour `inner.style.minWidth`) */
export const COL_SUBJECT_MIN = 320
export const COL_AUTHOR = 130
export const COL_DATE = 84
export const COL_HASH = 68
/** `pr-4.5` (Tailwind, 4.5 × 4px) : marge de fin de ligne */
export const ROW_PADDING_END = 18

export const FIXED_W = COL_GRAPH_GUTTER + COL_SUBJECT_MIN + COL_AUTHOR + COL_DATE + COL_HASH + ROW_PADDING_END

/* La colonne branche est à gauche du métro : elle fusionne les anciens chips de branche (qui
   précédaient le sujet) et la colonne des tags. Priorité au nom de branche ; les branches en trop
   et les tags tombent derrière un "+N". Elle et la colonne type se dimensionnent sur le contenu
   chargé (cf. render/measure.ts) et tombent à 0 quand le dépôt n'a rien à y mettre. La colonne
   graphe est un espaceur réservant `--graphw` sous le SVG, décalé de la largeur de la colonne
   branche. */
/* Le grid-template dérive des mêmes constantes mais vit dans une variable CSS (`--gg-cols`, posée
   par rowDiv) plutôt que dans la classe : `grid-cols-[…${COL}px…]` construit par interpolation
   n'est pas un littéral que le scanner Tailwind voit — il ne l'émettait jamais et la ligne
   retombait sur une colonne unique (tout tassé à gauche). `grid-cols-(--gg-cols)` est une classe
   statique, donc émise ; la valeur interpolée passe par la var. Les espaces autour du `+` du calc
   sont obligatoires — `calc(a+b)` est invalide. */
export const GRID_COLS =
  `var(--gg-branch,0px) calc(var(--graphw,0px) + ${COL_GRAPH_GUTTER}px) var(--gg-type,0px) 1fr ${COL_AUTHOR}px ${COL_DATE}px ${COL_HASH}px`

export const ROW_CLASS =
  "gg-row grid h-7 cursor-pointer grid-cols-(--gg-cols) " +
  "items-center border-l-2 border-l-transparent pr-4.5 text-xs hover:bg-muted/60 " +
  "data-selected:border-l-primary data-selected:bg-primary/20 data-selected:hover:bg-primary/25"

/** Surface flottante du projet (cf. `dialog`, `command`). Bornée en hauteur : un commit très
    décoré (dizaines de tags) scrolle dans le panneau au lieu de dépasser la fenêtre. */
export const MORE_CLASS =
  "gg-more absolute z-20 hidden max-h-[min(50vh,20rem)] w-max max-w-72 flex-col items-start gap-1 overflow-y-auto " +
  "rounded-xl bg-popover p-2 text-popover-foreground shadow-lg ring-1 ring-foreground/10"

/* --- Fenêtres de virtualisation découplées ---
   Le SVG (nœuds/arêtes courtes) monte par chunk entier (CHUNK lignes) : la géométrie d'un chunk
   est bon marché et son montage/démontage suit `layoutChunk`. Les LIGNES HTML (chips, avatars,
   texte défilant) sont, elles, coûteuses par ligne — les monter par chunk entier revenait à
   afficher jusqu'à 3 × CHUNK lignes pour ~30 visibles (~50× d'overdraw, AUDIT.md §6). Elles se
   montent donc par bucket plus fin, dimensionné sur le viewport réel plutôt que sur CHUNK. */
/** granularité de montage des lignes HTML — dix fois plus fine que le bucket SVG */
export const ROW_BUCKET = CHUNK / 10

/** Bucketing de l'overlay (arêtes longues + pendantes, render/overlay.ts) : grossier exprès — une
    arête longue touche au plus quelques buckets même si elle traverse tout l'historique, ce qui
    évite de la recopier dans des centaines de buckets fins tout en permettant à `sync()` de ne
    monter que les buckets qui recoupent le viewport (fini le rebuild O(n²/PAGE) de tout l'overlay
    à chaque page reçue, AUDIT.md §6). */
export const OVERLAY_BUCKET = CHUNK * 10
