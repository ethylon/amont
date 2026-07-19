/* Scénario « Aurelia Storefront » : le faux bridge `window.amont` partagé par les
   harnais navigateur embed.html (démo du site, sans merge) et demo.html (captures,
   avec `{ merge: true }` pour l'état conflit). Miroir de site/scripts/demo-repo.mjs :
   même historique, mêmes contenus de fichiers, mêmes états de working tree. */

const sha = (s) => s.repeat(Math.ceil(40 / s.length)).slice(0, 40);
const diffText = (text) => ({ text, totalLines: text.split("\n").length });

const SARAH = { a: "Sarah Chen", e: "31840555+sarahchen@users.noreply.github.com" };
const MARCO = { a: "Marco Ruiz", e: "18294632+marcoruiz@users.noreply.github.com" };
const AMELIE = { a: "Amélie Laurent", e: "27459811+amelielaurent@users.noreply.github.com" };
const day = (n, who, extra) => ({ d: `2026-06-${String(n).padStart(2, "0")}`, a: who.a, e: who.e, ...extra });

export function installDemoBridge({ merge = false } = {}) {
  /* Historique scénarisé : main ahead 2 / behind 1, un stash, deux merges,
     deux branches ouvertes, deux tags — le graphe du repo démo. */
  const C = [
    {
      h: sha("aa010101"),
      p: [sha("ba010101"), sha("aa020202"), sha("aa030303")],
      r: "",
      s: "On main: wip: sticky header experiment",
      ...day(30, SARAH),
    },
    { h: sha("aa020202"), p: [sha("ba010101")], r: "", s: "index on main: review model", ...day(30, SARAH) },
    { h: sha("aa030303"), p: [], r: "", s: "untracked files on main: review model", ...day(30, SARAH) },
    {
      h: sha("ba010101"),
      p: [sha("ba020202")],
      r: "HEAD -> refs/heads/main",
      s: "feat: review model and average rating",
      ...day(30, SARAH),
    },
    { h: sha("ba020202"), p: [sha("ca010101")], r: "", s: "style: search bar field", ...day(29, SARAH) },
    {
      h: sha("bb010101"),
      p: [sha("ca010101")],
      r: "refs/remotes/origin/main, refs/remotes/origin/HEAD",
      s: "feat: site footer",
      ...day(29, MARCO),
    },
    { h: sha("ca010101"), p: [sha("ca020202")], r: "", s: "chore: move perf notes to the wiki", ...day(28, MARCO) },
    { h: sha("ca020202"), p: [sha("ca030303")], r: "", s: "perf: notes from profiling session", ...day(28, MARCO) },
    {
      h: sha("ca030303"),
      p: [sha("ca040404")],
      r: "",
      s: "style: product card borders and tabular prices",
      ...day(27, AMELIE),
    },
    {
      h: sha("ca040404"),
      p: [sha("ca050505")],
      r: "",
      s: "refactor: extract ProductCard from ProductList",
      ...day(27, AMELIE),
    },
    { h: sha("ca050505"), p: [sha("da010101")], r: "", s: "feat: product tags and canvas tote", ...day(26, SARAH) },
    {
      h: sha("da010101"),
      p: [sha("ea010101"), sha("db010101")],
      r: "",
      s: "merge: price rounding fix",
      ...day(26, MARCO),
    },
    {
      h: sha("fa010101"),
      p: [sha("fa020202")],
      r: "refs/heads/feature/search-filters, refs/remotes/origin/feature/search-filters",
      s: "feat: price sort for search results",
      ...day(25, AMELIE),
    },
    { h: sha("fa020202"), p: [sha("fa030303")], r: "", s: "feat: search bar component", ...day(25, AMELIE) },
    {
      h: sha("fa030303"),
      p: [sha("ea010101")],
      r: "",
      s: "feat: product search with price filter",
      ...day(24, AMELIE),
    },
    {
      h: sha("db010101"),
      p: [sha("ha010101")],
      r: "refs/heads/fix/price-rounding",
      s: "fix: expose price parts to avoid float drift in display",
      ...day(24, MARCO),
    },
    {
      h: sha("ea010101"),
      p: [sha("ga010101")],
      r: "tag: refs/tags/v1.0.0",
      s: "chore: release v1.0.0",
      ...day(23, SARAH),
    },
    {
      h: sha("ga010101"),
      p: [sha("gb010101"), sha("gc010101")],
      r: "",
      s: "merge: checkout flow",
      ...day(23, SARAH),
    },
    {
      h: sha("gc010101"),
      p: [sha("gc020202")],
      r: "refs/heads/feature/checkout-flow",
      s: "test: checkout transitions",
      ...day(22, MARCO),
    },
    { h: sha("gc020202"), p: [sha("gc030303")], r: "", s: "feat: checkout panel component", ...day(22, SARAH) },
    { h: sha("gc030303"), p: [sha("gc040404")], r: "", s: "feat: checkout step transitions", ...day(21, SARAH) },
    { h: sha("gb010101"), p: [sha("ha010101")], r: "", s: "docs: architecture overview", ...day(21, AMELIE) },
    {
      h: sha("gc040404"),
      p: [sha("ia010101")],
      r: "",
      s: "feat: checkout state machine skeleton",
      ...day(20, SARAH),
    },
    { h: sha("ha010101"), p: [sha("ia010101")], r: "", s: "feat: site header with cart link", ...day(20, AMELIE) },
    {
      h: sha("ia010101"),
      p: [sha("ia020202")],
      r: "tag: refs/tags/v0.9.0",
      s: "test: cart quantity merge",
      ...day(19, MARCO),
    },
    {
      h: sha("ia020202"),
      p: [sha("ia030303")],
      r: "",
      s: "feat: cart model with quantity merge and total",
      ...day(19, MARCO),
    },
    {
      h: sha("ia030303"),
      p: [sha("ia040404")],
      r: "",
      s: "feat: base styles and product grid layout",
      ...day(18, AMELIE),
    },
    {
      h: sha("ia040404"),
      p: [sha("ia050505")],
      r: "",
      s: "feat: product list wired to static catalog",
      ...day(18, SARAH),
    },
    {
      h: sha("ia050505"),
      p: [sha("00025000")],
      r: "",
      s: "chore: bootstrap vite + preact storefront",
      ...day(17, SARAH),
    },
  ];

  /* Queue synthétique (~25k commits) : la preuve vivante du « 100,000+ commits,
     no lag » — scroll, saut long, éviction/refetch, dans le hero même. */
  const TAIL = 25_000;
  const th = (i) => sha(String(TAIL - i).padStart(8, "0"));
  const TAIL_SUBJECTS = [
    "fix: price formatting on locale switch",
    "feat: product page skeleton",
    "chore: bump dependencies",
    "refactor: extract cart persistence",
    "test: checkout edge cases",
    "style: tighten grid gaps",
  ];
  const TAIL_AUTHORS = [SARAH, MARCO, AMELIE];
  for (let i = 0; i < TAIL; i++) {
    const who = TAIL_AUTHORS[i % 3];
    C.push({
      h: th(i),
      p: i === TAIL - 1 ? [] : [th(i + 1)],
      d: "2026-06-16",
      a: who.a,
      e: who.e,
      r: "",
      s: `${TAIL_SUBJECTS[i % TAIL_SUBJECTS.length]} (#${TAIL - i})`,
    });
  }

  const BODIES_SEED = {
    ea010101:
      "Aurelia 1.0 — checkout.\n\nFirst public release: product list, cart, checkout flow.\n\nCo-authored-by: Marco Ruiz <18294632+marcoruiz@users.noreply.github.com>\nCo-authored-by: Amélie Laurent <27459811+amelielaurent@users.noreply.github.com>\n",
    da010101: "Keeps display prices stable across locales by formatting from integer parts.\n",
  };
  const BODIES = Object.fromEntries(Object.entries(BODIES_SEED).map(([h, v]) => [sha(h), v]));

  /* Working tree du scénario : cart.ts stagé, styles.css + README modifiés,
     CartBadge.tsx untracked. En mode merge, cart.ts passe en conflit (UU) — git
     autorise le merge avec un arbre sale tant que les fichiers touchés sont propres. */
  let wt = {
    staged: merge ? [] : [{ st: "M", path: "src/cart.ts", old: null }],
    unstaged: [
      { st: "M", path: "src/styles.css" },
      { st: "M", path: "README.md" },
    ],
    untracked: [{ st: "?", path: "src/components/CartBadge.tsx" }],
    conflicts: merge ? [{ st: "UU", path: "src/cart.ts" }] : [],
  };
  const drop = (arr, paths) => arr.filter((f) => !paths.includes(f.path));

  const WT_DIFFS = {
    "src/cart.ts": {
      header: [
        "diff --git a/src/cart.ts b/src/cart.ts",
        "index 5b3a2c1..8f4d9e2 100644",
        "--- a/src/cart.ts",
        "+++ b/src/cart.ts",
      ],
      unstaged: [],
      staged: merge
        ? []
        : [
            [
              "@@ -30,3 +30,11 @@ export function cartTotalCents(): number {",
              " export function formatPrice(cents: number): string {",
              "   return `$${(cents / 100).toFixed(2)}`",
              " }",
              "+",
              "+export function cartItemCount(): number {",
              "+  let count = 0",
              "+  for (const line of lines.values()) {",
              "+    count += line.quantity",
              "+  }",
              "+  return count",
              "+}",
            ],
          ],
    },
    "src/styles.css": {
      header: [
        "diff --git a/src/styles.css b/src/styles.css",
        "index 2d1e4f5..6a7b8c9 100644",
        "--- a/src/styles.css",
        "+++ b/src/styles.css",
      ],
      unstaged: [
        [
          "@@ -24,3 +24,8 @@ body {",
          " .price {",
          "   font-variant-numeric: tabular-nums;",
          " }",
          "+",
          "+.cart-link {",
          "+  font-weight: 600;",
          "+  color: var(--accent);",
          "+}",
        ],
      ],
      staged: [],
    },
    "README.md": {
      header: [
        "diff --git a/README.md b/README.md",
        "index 9c8b7a6..1f2e3d4 100644",
        "--- a/README.md",
        "+++ b/README.md",
      ],
      unstaged: [
        [
          "@@ -1,5 +1,5 @@",
          " # Aurelia Storefront",
          " ",
          "-Small demo storefront: product list, cart, checkout.",
          "+Small demo storefront: product list, cart, checkout. Built with Preact and Vite.",
          " ",
          " ## Development",
        ],
        [
          "@@ -8,3 +8,9 @@ Small demo storefront: product list, cart, checkout.",
          " pnpm install",
          " pnpm dev",
          " ```",
          "+",
          "+## Testing",
          "+",
          "+```sh",
          "+pnpm test",
          "+```",
        ],
      ],
      staged: [],
    },
  };
  const oldStartOf = (hunk) => Number(/^@@ -(\d+)/.exec(hunk[0])[1]);
  const syncWtLists = (path, entry) => {
    wt.unstaged = drop(wt.unstaged, [path]);
    wt.staged = drop(wt.staged, [path]);
    if (entry.unstaged.length) wt.unstaged.push({ st: "M", path });
    if (entry.staged.length) wt.staged.push({ st: "M", path, old: null });
  };

  /* Merge en conflit (mode `merge`) : feature/currency-switch (B/theirs) dans main
     (A/ours), les deux réécrivent formatPrice — cf. demo-repo.mjs --conflict. */
  let merging = merge;
  const CART_HEAD = `import type { Product } from "./api/products"

export interface CartLine {
  product: Product
  quantity: number
}

const lines = new Map<string, CartLine>()

export function addToCart(product: Product, quantity = 1) {
  const existing = lines.get(product.id)
  if (existing) {
    existing.quantity += quantity
  } else {
    lines.set(product.id, { product, quantity })
  }
}

export function cartTotalCents(): number {
  let total = 0
  for (const line of lines.values()) {
    total += line.product.priceCents * line.quantity
  }
  return total
}
`;
  const CART_TAIL = `
export function formatPriceParts(cents: number): { units: string; decimals: string } {
  const [units, decimals] = (cents / 100).toFixed(2).split(".")
  return { units, decimals }
}
`;
  const FORMAT_PRICE_BASE = `export function formatPrice(cents: number): string {
  return \`$\${(cents / 100).toFixed(2)}\`
}
`;
  const FORMAT_PRICE_OURS = `export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}
`;
  const FORMAT_PRICE_THEIRS = `export function formatPrice(cents: number, currency: "USD" | "EUR" = "USD"): string {
  const symbol = currency === "EUR" ? "€" : "$"
  return \`\${symbol}\${(cents / 100).toFixed(2)}\`
}
`;
  const CONFLICTS = {
    "src/cart.ts": {
      base: CART_HEAD + "\n" + FORMAT_PRICE_BASE + CART_TAIL,
      ours: CART_HEAD + "\n" + FORMAT_PRICE_OURS + CART_TAIL,
      theirs: CART_HEAD + "\n" + FORMAT_PRICE_THEIRS + CART_TAIL,
      merged:
        CART_HEAD +
        "\n" +
        "<<<<<<< HEAD\n" +
        FORMAT_PRICE_OURS +
        "=======\n" +
        FORMAT_PRICE_THEIRS +
        ">>>>>>> feature/currency-switch\n" +
        CART_TAIL,
    },
  };

  const REPO = { id: 1, path: "/demo/aurelia-storefront", name: "aurelia-storefront" };
  const RECENTS = [{ path: "/demo/aurelia-storefront", name: "aurelia-storefront" }];
  let nextRepoId = 2;

  let worktrees = [
    {
      path: "/demo/aurelia-storefront",
      head: sha("ba010101"),
      branch: "main",
      main: true,
      current: true,
      locked: false,
      prunable: false,
    },
  ];

  const onOpListeners = new Set();
  const onChangedListeners = new Set();
  const onTraceListeners = new Set();
  const onProgressListeners = new Set();
  const onUpdateListeners = new Set();
  window.__changed = (payload = { id: REPO.id }) => onChangedListeners.forEach((cb) => cb(payload));

  let flowPrefixes = { feature: "feature/", bugfix: "bugfix/", release: "release/", hotfix: "hotfix/" };
  let currentBranch = "main";
  let counts = {
    count: 42,
    size: "168.00 KiB",
    inPack: 25_100,
    packs: 1,
    sizePack: "9.80 MiB",
    prunePackable: 0,
    garbage: 0,
    sizeGarbage: "0 bytes",
  };

  const emitProgress = (op, percent) => onProgressListeners.forEach((cb) => cb({ id: REPO.id, op, percent }));
  const simulateMaint = async (op) => {
    for (const pct of [8, 26, 52, 78, 100]) {
      emitProgress(op, pct);
      await new Promise((r) => setTimeout(r, 260));
    }
  };
  const emitTrace = (line) => onTraceListeners.forEach((cb) => cb({ id: REPO.id, ...line }));
  const simulateFlowCmds = async (cmds, ms = 900) => {
    await new Promise((r) => setTimeout(r, 30));
    for (const text of cmds) {
      emitTrace({ kind: "cmd", text });
      await new Promise((r) => setTimeout(r, ms));
      emitTrace({ kind: "exit", ok: true, ms });
    }
  };

  const REFS = [
    { name: "main", kind: "head", head: true, ahead: 2, behind: 1, tip: sha("ba010101") },
    { name: "feature/checkout-flow", kind: "head", head: false, ahead: 0, behind: 0, tip: sha("gc010101") },
    { name: "feature/search-filters", kind: "head", head: false, ahead: 0, behind: 0, tip: sha("fa010101") },
    { name: "fix/price-rounding", kind: "head", head: false, ahead: 0, behind: 0, tip: sha("db010101") },
    { name: "origin/main", kind: "remote", head: false, ahead: 0, behind: 0, tip: sha("bb010101") },
    {
      name: "origin/feature/search-filters",
      kind: "remote",
      head: false,
      ahead: 0,
      behind: 0,
      tip: sha("fa010101"),
    },
    { name: "v0.9.0", kind: "tag", head: false, ahead: 0, behind: 0, tip: sha("ia010101") },
    { name: "v1.0.0", kind: "tag", head: false, ahead: 0, behind: 0, tip: sha("ea010101") },
  ];
  if (merge) {
    REFS.splice(2, 0, {
      name: "feature/currency-switch",
      kind: "head",
      head: false,
      ahead: 0,
      behind: 0,
      tip: sha("ka010101"),
    });
  }

  const SETTINGS = { autoFetch: false, autoFetchIntervalMin: 5, prune: true };

  /* Fichiers/diffs par commit pour les commits que les captures ouvrent ; les autres
     retombent sur le jeu générique. Contenus copiés de demo-repo.mjs. */
  const COMMIT_FILES = [
    { st: "M", path: "src/cart.ts", old: null },
    { st: "A", path: "src/components/ProductCard.tsx", old: null },
    { st: "M", path: "src/styles.css", old: null },
  ];
  const COMMIT_DIFF = [
    "diff --git a/src/cart.ts b/src/cart.ts",
    "index 1a2b3c4..5d6e7f8 100644",
    "--- a/src/cart.ts",
    "+++ b/src/cart.ts",
    "@@ -18,8 +18,12 @@ export function addToCart(product: Product, quantity = 1) {",
    " export function cartTotalCents(): number {",
    "   let total = 0",
    "   for (const line of lines.values()) {",
    "-    total += line.product.priceCents",
    "+    total += line.product.priceCents * line.quantity",
    "   }",
    "   return total",
    " }",
    "+",
    "+export function formatPrice(cents: number): string {",
    "+  return `$${(cents / 100).toFixed(2)}`",
    "+}",
  ].join("\n");

  const SEARCH_ADD_DIFF = [
    "diff --git a/src/search.ts b/src/search.ts",
    "new file mode 100644",
    "index 0000000..b41c7a2",
    "--- /dev/null",
    "+++ b/src/search.ts",
    "@@ -0,0 +1,15 @@",
    '+import type { Product } from "./api/products"',
    "+",
    "+export interface Filters {",
    "+  query: string",
    "+  maxPriceCents?: number",
    "+}",
    "+",
    "+export function applyFilters(products: Product[], filters: Filters): Product[] {",
    "+  const q = filters.query.trim().toLowerCase()",
    "+  return products.filter((p) => {",
    "+    if (q && !p.name.toLowerCase().includes(q)) return false",
    "+    if (filters.maxPriceCents != null && p.priceCents > filters.maxPriceCents) return false",
    "+    return true",
    "+  })",
    "+}",
  ].join("\n");

  const SEARCH_SORT_DIFF = [
    "diff --git a/src/search.ts b/src/search.ts",
    "index b41c7a2..e59d310 100644",
    "--- a/src/search.ts",
    "+++ b/src/search.ts",
    "@@ -13,3 +13,8 @@ export function applyFilters(products: Product[], filters: Filters): Product[]",
    "     return true",
    "   })",
    " }",
    "+",
    '+export function sortByPrice(products: Product[], direction: "asc" | "desc"): Product[] {',
    '+  const sign = direction === "asc" ? 1 : -1',
    "+  return [...products].sort((a, b) => sign * (a.priceCents - b.priceCents))",
    "+}",
  ].join("\n");

  const PRODUCTLIST_REFACTOR_DIFF = [
    "diff --git a/src/components/ProductList.tsx b/src/components/ProductList.tsx",
    "index 3f2a1b8..c7d4e90 100644",
    "--- a/src/components/ProductList.tsx",
    "+++ b/src/components/ProductList.tsx",
    "@@ -1,25 +1,19 @@",
    ' import { useProducts } from "../api/products"',
    '-import { addToCart, formatPrice } from "../cart"',
    '+import { addToCart } from "../cart"',
    '+import { ProductCard } from "./ProductCard"',
    " ",
    " export function ProductList() {",
    "   const products = useProducts()",
    "   if (products.length === 0) {",
    '     return <p class="empty">No products yet.</p>',
    "   }",
    "   return (",
    '     <ul class="product-grid">',
    "       {products.map((p) => (",
    '-        <li key={p.id} class="product-card">',
    "-          <h2>{p.name}</h2>",
    '-          <p class="price">{formatPrice(p.priceCents)}</p>',
    '-          <ul class="tags">',
    "-            {p.tags.map((t) => (",
    "-              <li key={t}>{t}</li>",
    "-            ))}",
    "-          </ul>",
    "-          <button onClick={() => addToCart(p)}>Add to cart</button>",
    "-        </li>",
    "+        <li key={p.id}>",
    "+          <ProductCard product={p} onAdd={() => addToCart(p)} />",
    "+        </li>",
    "       ))}",
    "     </ul>",
    "   )",
    " }",
  ].join("\n");

  const PRODUCTCARD_ADD_DIFF = [
    "diff --git a/src/components/ProductCard.tsx b/src/components/ProductCard.tsx",
    "new file mode 100644",
    "index 0000000..9e1f4a7",
    "--- /dev/null",
    "+++ b/src/components/ProductCard.tsx",
    "@@ -0,0 +1,18 @@",
    '+import type { Product } from "../api/products"',
    '+import { formatPrice } from "../cart"',
    "+",
    "+export function ProductCard({ product, onAdd }: { product: Product; onAdd?: () => void }) {",
    "+  return (",
    '+    <article class="product-card">',
    "+      <h2>{product.name}</h2>",
    '+      <p class="price">{formatPrice(product.priceCents)}</p>',
    '+      <ul class="tags">',
    "+        {product.tags.map((t) => (",
    "+          <li key={t}>{t}</li>",
    "+        ))}",
    "+      </ul>",
    "+      {onAdd && <button onClick={onAdd}>Add to cart</button>}",
    "+    </article>",
    "+  )",
    "+}",
  ].join("\n");

  const COMMIT_DATA = {
    [sha("fa030303")]: { files: [{ st: "A", path: "src/search.ts", old: null }], diff: SEARCH_ADD_DIFF },
    [sha("fa010101")]: { files: [{ st: "M", path: "src/search.ts", old: null }], diff: SEARCH_SORT_DIFF },
    [sha("ca040404")]: {
      files: [
        { st: "M", path: "src/components/ProductList.tsx", old: null },
        { st: "A", path: "src/components/ProductCard.tsx", old: null },
      ],
      diffs: {
        "src/components/ProductList.tsx": PRODUCTLIST_REFACTOR_DIFF,
        "src/components/ProductCard.tsx": PRODUCTCARD_ADD_DIFF,
      },
      diff: PRODUCTLIST_REFACTOR_DIFF + "\n" + PRODUCTCARD_ADD_DIFF,
    },
  };

  window.amont = {
    state: async () => ({ root: "/demo", recents: RECENTS, tabs: [REPO], active: REPO.id }),
    repos: async () => ({ root: "/demo", recents: RECENTS }),
    setTabs: async () => {},
    openDialog: async () => REPO,
    openPath: async () => REPO,
    close: async () => {},
    chooseRoot: async () => "/demo",
    scanRoot: async () => RECENTS,
    telemetryState: async () => ({ available: false, enabled: true }),
    setTelemetry: async () => {},
    getSettings: async () => ({ ...SETTINGS }),
    setSettings: async (patch) => {
      Object.assign(SETTINGS, patch);
    },
    chooseCreateDir: async () => "/demo/projects",
    initRepo: async (_dir, name) => ({ id: nextRepoId++, path: `/demo/projects/${name}`, name }),
    initBare: async (_dir, name) => `/demo/projects/${name.endsWith(".git") ? name : name + ".git"}`,
    cloneRepo: async (_dir, _url, name) => ({ id: nextRepoId++, path: `/demo/projects/${name}`, name }),
    log: async (_id, skip, count) => C.slice(skip, skip + count),
    total: async () => C.length - 2,
    refs: async () => REFS,
    stashes: async () => [
      {
        name: "stash@{0}",
        h: sha("aa010101"),
        p: [sha("ba010101"), sha("aa020202"), sha("aa030303")],
        d: "2026-06-30",
        a: SARAH.a,
        e: SARAH.e,
        s: "On main: wip: sticky header experiment",
      },
    ],
    stash: async () => {},
    files: async (_id, hash) => COMMIT_DATA[hash]?.files ?? COMMIT_FILES,
    diff: async (_id, hash, _parent, path) =>
      diffText(COMMIT_DATA[hash]?.diffs?.[path] ?? COMMIT_DATA[hash]?.diff ?? COMMIT_DIFF),
    blob: async (_id, path, ref) => {
      const key = ref.kind === "commit" ? ref.rev : ref.kind;
      const hues = ["#e11d48", "#16a34a", "#2563eb", "#d97706", "#9333ea"];
      const fill = hues[[...key].reduce((a, c) => a + c.charCodeAt(0), 0) % hues.length];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="${fill}"/><text x="80" y="56" font-size="13" fill="#fff" text-anchor="middle">${path.split("/").pop()}</text></svg>`;
      return { size: svg.length, bytes: new TextEncoder().encode(svg) };
    },
    status: async () => ({ branch: currentBranch, head: sha("ba010101"), ahead: 2, behind: 1 }),
    body: async (_id, hash) => BODIES[hash] ?? "",
    op: async () => {},
    onOp: (cb) => {
      onOpListeners.add(cb);
      return () => onOpListeners.delete(cb);
    },
    onChanged: (cb) => {
      onChangedListeners.add(cb);
      return () => onChangedListeners.delete(cb);
    },
    onTrace: (cb) => {
      onTraceListeners.add(cb);
      return () => onTraceListeners.delete(cb);
    },
    onProgress: (cb) => {
      onProgressListeners.add(cb);
      return () => onProgressListeners.delete(cb);
    },
    /* mutation queue: the demo runs everything instantly, nothing ever waits */
    onQueue: () => () => {},
    onUpdate: (cb) => {
      onUpdateListeners.add(cb);
      return () => onUpdateListeners.delete(cb);
    },
    checkForUpdates: async () => onUpdateListeners.forEach((cb) => cb({ origin: "manual", kind: "unavailable" })),
    installUpdate: async () => {},
    search: async () => [],
    flow: async () => flowPrefixes,
    flowInfo: async (_id, branch, kind) => {
      const tagged = kind === "release" || kind === "hotfix";
      return {
        commits: 3,
        startedAt: Math.floor(Date.now() / 1000) - 7200,
        base: tagged ? "v1.0.0" : "main",
        targets: tagged ? ["main"] : ["main"],
        nextTag: kind === "release" ? "v1.1.0" : kind === "hotfix" ? "v1.0.1" : null,
        unpushed: true,
      };
    },
    flowInit: async (_id, cfg) => {
      flowPrefixes = { feature: cfg.feature, bugfix: cfg.bugfix, release: cfg.release, hotfix: cfg.hotfix };
      return flowPrefixes;
    },
    flowStart: async (_id, kind, name) => {
      const branch = (flowPrefixes[kind] || `${kind}/`) + name;
      await simulateFlowCmds(["git config --get-regexp ^gitflow\\.prefix\\.", `git flow ${kind} start ${name}`]);
      currentBranch = branch;
    },
    flowPublish: async (_id, kind, name) => {
      await simulateFlowCmds(["git config --get-regexp ^gitflow\\.prefix\\.", `git flow ${kind} publish ${name}`]);
    },
    countObjects: async () => counts,
    fsck: async () => {
      await simulateMaint("fsck");
    },
    gc: async () => {
      await simulateMaint("gc");
      counts = { ...counts, count: 0, size: "0 bytes", packs: 1 };
    },
    branch: async (_id, action, name) => {
      if (action !== "finish") return;
      const kind = Object.keys(flowPrefixes).find((k) => flowPrefixes[k] && name.startsWith(flowPrefixes[k]));
      if (!kind) return;
      const version = name.slice(flowPrefixes[kind].length);
      const tagged = kind === "release" || kind === "hotfix";
      await simulateFlowCmds([
        "git config --get-regexp ^gitflow\\.prefix\\.",
        `git flow ${kind} finish ${tagged ? `-m ${version} ` : ""}${version}`,
      ]);
      if (currentBranch === name) currentBranch = "main";
    },
    checkout: async () => {},
    worktrees: async () => structuredClone(worktrees),
    worktreeAct: async (_id, action, path) => {
      worktrees = action === "prune" ? worktrees.filter((w) => !w.prunable) : worktrees.filter((w) => w.path !== path);
    },
    worktreeAdd: async (_id, branch) => {
      const name = branch.split("/").pop();
      const path = `/demo/aurelia-worktrees/${name}`;
      const tip = REFS.find((r) => r.kind === "head" && r.name === branch)?.tip ?? sha("ba010101");
      worktrees.push({ path, head: tip, branch, main: false, current: false, locked: false, prunable: false });
      return { id: nextRepoId++, path, name };
    },
    worktreeOpen: async (_id, path) => ({ id: nextRepoId++, path, name: path.split("/").pop() }),
    worktreeReveal: async () => {},
    worktree: async () => structuredClone(wt),
    wtdiff: async (_id, p, source) => {
      const entry = WT_DIFFS[p];
      if (!entry) return diffText(`diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n-old\n+new\n`);
      const hunks = entry[source] ?? [];
      return diffText(hunks.length ? [...entry.header, ...hunks.flat(), ""].join("\n") : "");
    },
    applyPatch: async (_id, patch, reverse) => {
      const path = /^diff --git a\/(.+) b\//m.exec(patch)?.[1];
      const entry = WT_DIFFS[path];
      if (!entry) return;
      const from = reverse ? "staged" : "unstaged";
      const to = reverse ? "unstaged" : "staged";
      const starts = [...patch.matchAll(/^@@ -(\d+)/gm)].map((m) => Number(m[1]));
      const moved = entry[from].filter((h) => starts.includes(oldStartOf(h)));
      entry[from] = entry[from].filter((h) => !moved.includes(h));
      entry[to].push(...moved);
      entry[to].sort((a, b) => oldStartOf(a) - oldStartOf(b));
      syncWtLists(path, entry);
    },
    discard: async (_id, paths, untracked) => {
      wt.unstaged = drop(wt.unstaged, paths);
      wt.untracked = drop(wt.untracked, untracked);
      for (const p of paths) {
        const entry = WT_DIFFS[p];
        if (entry) {
          entry.unstaged = [];
          syncWtLists(p, entry);
        }
      }
    },
    discardPatch: async (_id, patch) => {
      const path = /^diff --git a\/(.+) b\//m.exec(patch)?.[1];
      const entry = WT_DIFFS[path];
      if (!entry) return;
      const starts = [...patch.matchAll(/^@@ -(\d+)/gm)].map((m) => Number(m[1]));
      entry.unstaged = entry.unstaged.filter((h) => !starts.includes(oldStartOf(h)));
      syncWtLists(path, entry);
    },
    stage: async (_id, paths) => {
      const moved = [...wt.unstaged, ...wt.untracked].filter((f) => paths.includes(f.path));
      wt.unstaged = drop(wt.unstaged, paths);
      wt.untracked = drop(wt.untracked, paths);
      wt.staged.push(...moved.map((f) => ({ st: f.st === "?" ? "A" : f.st, path: f.path, old: null })));
      for (const p of paths) {
        const entry = WT_DIFFS[p];
        if (entry) entry.staged.push(...entry.unstaged.splice(0));
      }
    },
    unstage: async (_id, paths) => {
      const moved = wt.staged.filter((f) => paths.includes(f.path));
      wt.staged = drop(wt.staged, paths);
      wt.unstaged.push(...moved.map((f) => ({ st: "M", path: f.path })));
      for (const p of paths) {
        const entry = WT_DIFFS[p];
        if (entry) entry.unstaged.push(...entry.staged.splice(0));
      }
    },
    commit: async () => {
      wt.staged = [];
      merging = false;
    },
    mergeState: async () => ({
      merging,
      ours: merging ? "main" : null,
      theirs: merging ? "feature/currency-switch" : null,
    }),
    conflict: async (_id, path) =>
      structuredClone(CONFLICTS[path] ?? { base: null, ours: null, theirs: null, merged: "" }),
    resolve: async (_id, path, content) => {
      CONFLICTS[path] = { ...CONFLICTS[path], merged: content };
      wt.conflicts = drop(wt.conflicts, [path]);
      wt.staged.push({ st: "M", path, old: null });
    },
    mergeAbort: async () => {
      merging = false;
      wt.conflicts = [];
    },
    fileIcon: async () => null,
    openFile: async () => "",
    cancel: async () => {},
  };
}
