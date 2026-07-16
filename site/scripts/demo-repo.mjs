#!/usr/bin/env node
// Génère un repo git scénarisé pour les captures du site.
//   node site/scripts/demo-repo.mjs <dir> [--conflict] [--force]
// <dir>        cible (défaut: ~/amont-demo)
// --conflict   laisse un merge en conflit (capture "conflits") au lieu de l'état
//              staging/stash/ahead-behind par défaut
// --force      supprime la cible si elle existe

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const target = args.find((a) => !a.startsWith("--")) ?? join(homedir(), "amont-demo");
const originDir = target.replace(/[\\/]+$/, "") + "-origin.git";

if (existsSync(target) || existsSync(originDir)) {
  if (!flags.has("--force")) {
    console.error(`Refus: ${target} ou ${originDir} existe déjà. Relance avec --force.`);
    process.exit(1);
  }
  rmSync(target, { recursive: true, force: true });
  rmSync(originDir, { recursive: true, force: true });
}
mkdirSync(target, { recursive: true });

const AUTHORS = {
  sarah: { name: "Sarah Chen", email: "31840555+sarahchen@users.noreply.github.com" },
  marco: { name: "Marco Ruiz", email: "18294632+marcoruiz@users.noreply.github.com" },
  amelie: { name: "Amélie Laurent", email: "27459811+amelielaurent@users.noreply.github.com" },
};

// Timeline déterministe: minutes écoulées depuis la base → captures reproductibles.
const BASE = new Date("2026-06-22T09:00:00+02:00").getTime();
const at = (minutes) => new Date(BASE + minutes * 60_000).toISOString();

function git(cmd, { author = AUTHORS.sarah, date, cwd = target } = {}) {
  const env = { ...process.env };
  if (date) {
    env.GIT_AUTHOR_DATE = date;
    env.GIT_COMMITTER_DATE = date;
  }
  env.GIT_AUTHOR_NAME = author.name;
  env.GIT_AUTHOR_EMAIL = author.email;
  env.GIT_COMMITTER_NAME = author.name;
  env.GIT_COMMITTER_EMAIL = author.email;
  return execFileSync("git", cmd, { cwd, env, stdio: ["ignore", "pipe", "inherit"] })
    .toString()
    .trim();
}

function write(rel, content) {
  const abs = join(target, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function append(rel, content) {
  appendFileSync(join(target, rel), content);
}

let clock = 0;
function commit(message, { author = AUTHORS.sarah, gap = 210 } = {}) {
  clock += gap;
  git(["add", "-A"], {});
  git(["commit", "-m", message], { author, date: at(clock) });
}

// ---------------------------------------------------------------------------
// Acte 1 — bootstrap du projet (main)
// ---------------------------------------------------------------------------
git(["init", "-b", "main"]);
git(["config", "core.autocrlf", "false"]);

write(
  "package.json",
  `{
  "name": "aurelia-storefront",
  "version": "0.9.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest"
  },
  "dependencies": {
    "preact": "^10.24.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
`
);
write(
  "README.md",
  `# Aurelia Storefront

Small demo storefront: product list, cart, checkout.

## Development

\`\`\`sh
pnpm install
pnpm dev
\`\`\`
`
);
write(".gitignore", "node_modules/\ndist/\n");
commit("chore: bootstrap vite + preact storefront", { author: AUTHORS.sarah, gap: 0 });

write(
  "src/main.tsx",
  `import { render } from "preact"
import { App } from "./app"

render(<App />, document.getElementById("root")!)
`
);
write(
  "src/app.tsx",
  `import { ProductList } from "./components/ProductList"

export function App() {
  return (
    <main>
      <h1>Aurelia</h1>
      <ProductList />
    </main>
  )
}
`
);
write(
  "src/components/ProductList.tsx",
  `import { useProducts } from "../api/products"

export function ProductList() {
  const products = useProducts()
  return (
    <ul class="product-grid">
      {products.map((p) => (
        <li key={p.id}>{p.name}</li>
      ))}
    </ul>
  )
}
`
);
write(
  "src/api/products.ts",
  `export interface Product {
  id: string
  name: string
  priceCents: number
}

const CATALOG: Product[] = [
  { id: "tee-noir", name: "Classic Tee", priceCents: 2400 },
  { id: "hoodie-gris", name: "Heavy Hoodie", priceCents: 6900 },
  { id: "cap-marine", name: "Navy Cap", priceCents: 1900 },
]

export function useProducts(): Product[] {
  return CATALOG
}
`
);
commit("feat: product list wired to static catalog", { author: AUTHORS.sarah });

write(
  "src/styles.css",
  `:root {
  --accent: #7c3aed;
  --surface: #ffffff;
  --text: #18181b;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  color: var(--text);
  background: var(--surface);
}

.product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 1rem;
  padding: 0;
  list-style: none;
}
`
);
commit("feat: base styles and product grid layout", { author: AUTHORS.amelie });

write(
  "src/cart.ts",
  `import type { Product } from "./api/products"

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

export function formatPrice(cents: number): string {
  return \`$\${(cents / 100).toFixed(2)}\`
}
`
);
commit("feat: cart model with quantity merge and total", { author: AUTHORS.marco });

write(
  "src/cart.test.ts",
  `import { describe, expect, it } from "vitest"
import { addToCart, cartTotalCents } from "./cart"

describe("cart", () => {
  it("merges quantities for the same product", () => {
    const tee = { id: "tee-noir", name: "Classic Tee", priceCents: 2400 }
    addToCart(tee)
    addToCart(tee, 2)
    expect(cartTotalCents()).toBe(7200)
  })
})
`
);
commit("test: cart quantity merge", { author: AUTHORS.marco });
git(["tag", "-a", "v0.9.0", "-m", "First internal demo"], { date: at(clock) });

// ---------------------------------------------------------------------------
// Acte 2 — deux features en parallèle + un fix, lanes croisées
// ---------------------------------------------------------------------------
git(["checkout", "-b", "feature/checkout-flow"]);
write(
  "src/checkout.ts",
  `import { cartTotalCents, formatPrice } from "./cart"

export interface CheckoutState {
  step: "cart" | "address" | "payment" | "done"
  email?: string
}

export function startCheckout(): CheckoutState {
  return { step: "cart" }
}

export function checkoutSummary(): string {
  return \`Total: \${formatPrice(cartTotalCents())}\`
}
`
);
commit("feat: checkout state machine skeleton", { author: AUTHORS.sarah });

git(["checkout", "main"]);
write(
  "src/components/Header.tsx",
  `export function Header() {
  return (
    <header class="site-header">
      <a href="/" class="brand">Aurelia</a>
      <a href="/cart" class="cart-link">Cart</a>
    </header>
  )
}
`
);
commit("feat: site header with cart link", { author: AUTHORS.amelie });

git(["checkout", "feature/checkout-flow"]);
append(
  "src/checkout.ts",
  `
export function advance(state: CheckoutState): CheckoutState {
  switch (state.step) {
    case "cart":
      return { ...state, step: "address" }
    case "address":
      return { ...state, step: "payment" }
    case "payment":
      return { ...state, step: "done" }
    case "done":
      return state
  }
}
`
);
commit("feat: checkout step transitions", { author: AUTHORS.sarah });

write(
  "src/components/CheckoutPanel.tsx",
  `import { startCheckout, advance, checkoutSummary } from "../checkout"
import { useState } from "preact/hooks"

export function CheckoutPanel() {
  const [state, setState] = useState(startCheckout)
  return (
    <aside class="checkout-panel">
      <p>{checkoutSummary()}</p>
      <button onClick={() => setState(advance(state))}>Continue</button>
    </aside>
  )
}
`
);
commit("feat: checkout panel component", { author: AUTHORS.sarah });

git(["checkout", "main"]);
git(["checkout", "-b", "fix/price-rounding"]);
append(
  "src/cart.ts",
  `
export function formatPriceParts(cents: number): { units: string; decimals: string } {
  const [units, decimals] = (cents / 100).toFixed(2).split(".")
  return { units, decimals }
}
`
);
commit("fix: expose price parts to avoid float drift in display", { author: AUTHORS.marco });

git(["checkout", "main"]);
write(
  "docs/architecture.md",
  `# Architecture

- \`src/api\` — data access, static for now.
- \`src/components\` — preact components, no global state.
- \`src/cart.ts\` — cart domain model, framework-free.
`
);
commit("docs: architecture overview", { author: AUTHORS.amelie });

git(["checkout", "feature/checkout-flow"]);
write(
  "src/checkout.test.ts",
  `import { describe, expect, it } from "vitest"
import { advance, startCheckout } from "./checkout"

describe("checkout", () => {
  it("walks cart -> address -> payment -> done", () => {
    let s = startCheckout()
    s = advance(s)
    expect(s.step).toBe("address")
    s = advance(advance(s))
    expect(s.step).toBe("done")
  })
})
`
);
commit("test: checkout transitions", { author: AUTHORS.marco });

// Merge de la feature + release
git(["checkout", "main"]);
clock += 45;
git(["merge", "--no-ff", "feature/checkout-flow", "-m", "merge: checkout flow"], {
  author: AUTHORS.sarah,
  date: at(clock),
});
write(
  "package.json",
  `{
  "name": "aurelia-storefront",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest"
  },
  "dependencies": {
    "preact": "^10.24.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
`
);
commit("chore: release v1.0.0", { author: AUTHORS.sarah, gap: 20 });
git(["tag", "-a", "v1.0.0", "-m", "Aurelia 1.0 — checkout"], { date: at(clock) });

// ---------------------------------------------------------------------------
// Acte 3 — vie après la release: nouvelle feature, fix mergé, activité
// ---------------------------------------------------------------------------
git(["checkout", "-b", "feature/search-filters"]);
write(
  "src/search.ts",
  `import type { Product } from "./api/products"

export interface Filters {
  query: string
  maxPriceCents?: number
}

export function applyFilters(products: Product[], filters: Filters): Product[] {
  const q = filters.query.trim().toLowerCase()
  return products.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q)) return false
    if (filters.maxPriceCents != null && p.priceCents > filters.maxPriceCents) return false
    return true
  })
}
`
);
commit("feat: product search with price filter", { author: AUTHORS.amelie });

write(
  "src/components/SearchBar.tsx",
  `import { useState } from "preact/hooks"

export function SearchBar({ onChange }: { onChange: (query: string) => void }) {
  const [value, setValue] = useState("")
  return (
    <input
      class="search-bar"
      type="search"
      placeholder="Search products"
      value={value}
      onInput={(e) => {
        const next = (e.target as HTMLInputElement).value
        setValue(next)
        onChange(next)
      }}
    />
  )
}
`
);
commit("feat: search bar component", { author: AUTHORS.amelie });

git(["checkout", "main"]);
clock += 30;
git(["merge", "--no-ff", "fix/price-rounding", "-m", "merge: price rounding fix"], {
  author: AUTHORS.marco,
  date: at(clock),
});

write(
  "src/api/products.ts",
  `export interface Product {
  id: string
  name: string
  priceCents: number
  tags: string[]
}

const CATALOG: Product[] = [
  { id: "tee-noir", name: "Classic Tee", priceCents: 2400, tags: ["apparel"] },
  { id: "hoodie-gris", name: "Heavy Hoodie", priceCents: 6900, tags: ["apparel", "winter"] },
  { id: "cap-marine", name: "Navy Cap", priceCents: 1900, tags: ["accessories"] },
  { id: "tote-ecru", name: "Canvas Tote", priceCents: 2200, tags: ["accessories"] },
]

export function useProducts(): Product[] {
  return CATALOG
}
`
);
commit("feat: product tags and canvas tote", { author: AUTHORS.sarah });

write(
  "src/components/ProductCard.tsx",
  `import type { Product } from "../api/products"
import { formatPrice } from "../cart"

export function ProductCard({ product }: { product: Product }) {
  return (
    <article class="product-card">
      <h2>{product.name}</h2>
      <p class="price">{formatPrice(product.priceCents)}</p>
    </article>
  )
}
`
);
commit("refactor: extract ProductCard from ProductList", { author: AUTHORS.amelie });

append(
  "src/styles.css",
  `
.product-card {
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 1rem;
}

.price {
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}
`
);
commit("style: product card borders and tabular prices", { author: AUTHORS.amelie });

git(["checkout", "feature/search-filters"]);
append(
  "src/search.ts",
  `
export function sortByPrice(products: Product[], direction: "asc" | "desc"): Product[] {
  const sign = direction === "asc" ? 1 : -1
  return [...products].sort((a, b) => sign * (a.priceCents - b.priceCents))
}
`
);
commit("feat: price sort for search results", { author: AUTHORS.amelie });

git(["checkout", "main"]);
write(
  "perf-notes.md",
  `# Perf notes

- Product grid re-renders on every cart change: memoize ProductCard.
- Search debounce at 150ms feels right.
`
);
commit("perf: notes from profiling session", { author: AUTHORS.marco });
rmSync(join(target, "perf-notes.md"));
commit("chore: move perf notes to the wiki", { author: AUTHORS.marco, gap: 12 });

// ---------------------------------------------------------------------------
// Acte 4 — état final: remote, ahead/behind, stash, working tree
// ---------------------------------------------------------------------------
git(["init", "--bare", originDir], { cwd: dirname(target) });
git(["remote", "add", "origin", originDir]);

const FORMAT_PRICE_ORIGINAL =
  "export function formatPrice(cents: number): string {\n  return `$${(cents / 100).toFixed(2)}`\n}";

function rewriteCart(replacement) {
  const path = join(target, "src/cart.ts");
  const current = readFileSync(path, "utf8");
  if (!current.includes(FORMAT_PRICE_ORIGINAL)) throw new Error("formatPrice introuvable dans src/cart.ts");
  writeFileSync(path, current.replace(FORMAT_PRICE_ORIGINAL, replacement));
}

if (flags.has("--conflict")) {
  // Variante conflit: une branche qui touche les mêmes lignes de cart.ts que main.
  git(["checkout", "-b", "feature/currency-switch"]);
  rewriteCart(`export function formatPrice(cents: number, currency: "USD" | "EUR" = "USD"): string {
  const symbol = currency === "EUR" ? "€" : "$"
  return \`\${symbol}\${(cents / 100).toFixed(2)}\`
}`);
  commit("feat: currency-aware price formatting", { author: AUTHORS.amelie });

  git(["checkout", "main"]);
  rewriteCart(`export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}`);
  commit("refactor: format prices through Intl.NumberFormat", { author: AUTHORS.marco });

  git(["push", "-u", "origin", "main"]);
  try {
    git(["merge", "feature/currency-switch"]);
  } catch {
    console.log("Merge en conflit laissé en place (attendu) — ouvre src/cart.ts dans Amont.");
  }
} else {
  // Commit "équipe" qui restera uniquement sur origin → behind 1.
  write(
    "src/components/Footer.tsx",
    `export function Footer() {
  return (
    <footer class="site-footer">
      <p>© 2026 Aurelia. All rights reserved.</p>
    </footer>
  )
}
`
  );
  commit("feat: site footer", { author: AUTHORS.marco });
  git(["push", "-u", "origin", "main"]);
  git(["push", "origin", "feature/search-filters", "v0.9.0", "v1.0.0"]);
  git(["reset", "--hard", "HEAD~1"]);

  // Deux commits locaux non poussés → ahead 2.
  append(
    "src/styles.css",
    `
.search-bar {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #d4d4d8;
  border-radius: 6px;
}
`
  );
  commit("style: search bar field", { author: AUTHORS.sarah });
  write(
    "src/api/reviews.ts",
    `export interface Review {
  productId: string
  rating: 1 | 2 | 3 | 4 | 5
  comment: string
}

export function averageRating(reviews: Review[]): number {
  if (reviews.length === 0) return 0
  return reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
}
`
  );
  commit("feat: review model and average rating", { author: AUTHORS.sarah });

  // Un stash visible dans le graphe.
  append(
    "src/components/Header.tsx",
    `
// WIP sticky header experiment
`
  );
  git(["stash", "push", "-m", "wip: sticky header experiment"], { date: at((clock += 15)) });

  // Working tree pour la capture staging: 1 fichier stagé, 2 modifiés, 1 nouveau.
  append(
    "src/cart.ts",
    `
export function cartItemCount(): number {
  let count = 0
  for (const line of lines.values()) {
    count += line.quantity
  }
  return count
}
`
  );
  git(["add", "src/cart.ts"]);
  append(
    "src/styles.css",
    `
.cart-link {
  font-weight: 600;
  color: var(--accent);
}
`
  );
  append(
    "README.md",
    `
## Testing

\`\`\`sh
pnpm test
\`\`\`
`
  );
  write(
    "src/components/CartBadge.tsx",
    `import { cartItemCount } from "../cart"

export function CartBadge() {
  const count = cartItemCount()
  if (count === 0) return null
  return <span class="cart-badge">{count}</span>
}
`
  );
}

const summary = git(["log", "--oneline", "--all"]).split("\n").length;
console.log(`OK — ${summary} commits dans ${target}`);
console.log(`Remote de simulation: ${originDir}`);
if (!flags.has("--conflict")) {
  console.log("État: main ahead 2 / behind 1, 1 stash, staging mixte, feature/search-filters + fix/price-rounding.");
}
