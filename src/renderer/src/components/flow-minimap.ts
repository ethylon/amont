import type { FlowKind } from "@/lib/commit-message"
import { ROW } from "@/lib/graph-layout"
import { onThemeChange } from "@/lib/theme"

/* Minimap de flow : une gouttière canvas à droite du graphe, à l'échelle du dépôt entier
   (hauteur / total). Jamais un nœud DOM par commit — un dépôt à 100k commits tient dans
   deux fillRect et une boucle. Deux calques : les bandes (hors écran, repeintes quand des
   données arrivent ou que le thème bascule) et le rectangle viewport (recomposé à chaque
   scroll par un simple drawImage). */

export type MinimapDeps = {
  /** commits du dépôt — l'échelle verticale de la gouttière */
  total(): number
  /** commits déjà chargés : en dessous, le flow est inconnu (tramé) */
  known(): number
  /** flow d'une ligne chargée — les capsules release/hotfix du collapse */
  flowAt(i: number): FlowKind | undefined
  /** amène la ligne à l'écran, en chargeant ce qui manque (clic/drag) */
  scrollToRow(row: number): void
}

export type Minimap = {
  /** à appeler quand données ou total ont pu bouger ; ne repeint que si nécessaire */
  repaint(): void
  destroy(): void
}

export function createMinimap(canvas: HTMLCanvasElement, board: HTMLDivElement, deps: MinimapDeps): Minimap {
  const ctx = canvas.getContext("2d")!
  const off = document.createElement("canvas")
  const octx = off.getContext("2d")!
  let W = 0
  let H = 0
  let lastKnown = -1
  let lastTotal = -1

  /* Les couleurs canvas ne suivent pas le CSS : résolues depuis :root, relues à chaque thème. */
  let colors = { release: "", hotfix: "", neutral: "", frame: "" }
  let hatch: CanvasPattern | null = null

  function readColors() {
    const s = getComputedStyle(document.documentElement)
    colors = {
      release: s.getPropertyValue("--release").trim(),
      hotfix: s.getPropertyValue("--destructive").trim(),
      neutral: s.getPropertyValue("--muted-foreground").trim(),
      frame: s.getPropertyValue("--foreground").trim(),
    }
    /* tuile du tramé « inconnu » : hachures diagonales discrètes */
    const t = document.createElement("canvas")
    t.width = t.height = 6
    const c = t.getContext("2d")!
    c.strokeStyle = colors.neutral
    c.globalAlpha = 0.3
    c.lineWidth = 1
    c.beginPath()
    c.moveTo(-2, 4)
    c.lineTo(4, -2)
    c.moveTo(0, 8)
    c.lineTo(8, 0)
    c.moveTo(4, 10)
    c.lineTo(10, 4)
    c.stroke()
    hatch = octx.createPattern(t, "repeat")
  }

  /* Calque des bandes : densité neutre sur le chargé, capsules par-dessus, tramé au-delà. */
  function paintOff() {
    octx.clearRect(0, 0, W, H)
    const total = deps.total()
    lastTotal = total
    lastKnown = deps.known()
    if (!total || !H) return
    const known = Math.min(lastKnown, total)
    const yKnown = (known / total) * H

    octx.globalAlpha = 0.15
    octx.fillStyle = colors.neutral
    octx.fillRect(0, 0, W, yKnown)

    /* une capsule fait moins d'un pixel à cette échelle : bande d'au moins 2px */
    octx.globalAlpha = 1
    const band = Math.max(2, H / total)
    for (let i = 0; i < known; i++) {
      const f = deps.flowAt(i)
      if (!f) continue
      octx.fillStyle = f === "hotfix" ? colors.hotfix : colors.release
      octx.fillRect(0, (i / total) * H, W, band)
    }

    if (yKnown < H && hatch) {
      octx.fillStyle = hatch
      octx.fillRect(0, yKnown, W, H - yKnown)
    }
  }

  function paint() {
    ctx.clearRect(0, 0, W, H)
    ctx.drawImage(off, 0, 0, W, H)
    const total = deps.total()
    if (!total || !H) return
    const y = (board.scrollTop / ROW / total) * H
    const h = Math.max(8, (board.clientHeight / ROW / total) * H)
    ctx.globalAlpha = 0.7
    ctx.strokeStyle = colors.frame
    ctx.lineWidth = 1.5
    ctx.strokeRect(0.75, y + 0.75, W - 1.5, Math.min(h, H - y) - 1.5)
    ctx.globalAlpha = 1
  }

  let raf = 0
  const schedule = () => {
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        paint()
      })
  }

  /* dimensionné en pixels physiques, dessiné en pixels CSS */
  const ro = new ResizeObserver(() => {
    const dpr = devicePixelRatio || 1
    W = canvas.clientWidth
    H = canvas.clientHeight
    canvas.width = off.width = Math.max(1, Math.round(W * dpr))
    canvas.height = off.height = Math.max(1, Math.round(H * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    octx.setTransform(dpr, 0, 0, dpr, 0, 0)
    paintOff()
    paint()
  })
  ro.observe(canvas)

  const offTheme = onThemeChange(() => {
    readColors()
    paintOff()
    schedule()
  })
  readColors()

  /* viewport synchronisé au scroll du graphe ; l'autre sens passe par scrollToRow */
  const onScroll = () => schedule()
  board.addEventListener("scroll", onScroll, { passive: true })

  const rowAt = (ev: PointerEvent) => {
    const r = Math.floor((ev.offsetY / H) * deps.total())
    return Math.max(0, Math.min(deps.total() - 1, r))
  }
  const onDown = (ev: PointerEvent) => {
    if (!deps.total() || !H) return
    canvas.setPointerCapture(ev.pointerId)
    deps.scrollToRow(rowAt(ev))
  }
  const onMove = (ev: PointerEvent) => {
    if (!(ev.buttons & 1) || !deps.total() || !H) return
    deps.scrollToRow(rowAt(ev))
  }
  canvas.addEventListener("pointerdown", onDown)
  canvas.addEventListener("pointermove", onMove)

  return {
    repaint() {
      if (deps.known() !== lastKnown || deps.total() !== lastTotal) paintOff()
      schedule()
    },
    destroy() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      offTheme()
      board.removeEventListener("scroll", onScroll)
      canvas.removeEventListener("pointerdown", onDown)
      canvas.removeEventListener("pointermove", onMove)
    },
  }
}
