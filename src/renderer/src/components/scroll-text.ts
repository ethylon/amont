/* Texte trop long pour sa boîte, sans ellipsis : le fondu `scroll-fade-x` (shadcn) signale le
   débordement et suit la position de scroll — bord gauche net à 0, bord droit net en fin de
   course. `overflow-hidden` garde la boîte défilable par script mais neutralise la molette.
   Au survol le texte défile vers la gauche à vitesse fixe, linéaire, et boucle sans retour :
   une copie du texte prend le relais derrière un écart constant, le scroll retombe à 0 au
   raccord — indétectable, les deux copies y coïncident. */

const SPEED = 30 // px/s, indépendant de la longueur du texte

/** classes du conteneur, partagées avec les rendus React (cf. detail-panel) */
export const SCROLL_TEXT_CLASS = "gg-scrolltext scroll-fade-x flex min-w-0 max-w-full gap-3 overflow-hidden whitespace-nowrap"

export function scrollText(text: string) {
  const el = document.createElement("span")
  el.className = SCROLL_TEXT_CLASS
  const copy = document.createElement("span")
  copy.textContent = text
  el.appendChild(copy)
  return el
}

/* Un seul texte défile à la fois — celui sous le curseur. */
let current: HTMLElement | null = null
let dup: HTMLElement | null = null
let raf = 0

export function scrollTextStop() {
  if (!current) return
  cancelAnimationFrame(raf)
  dup?.remove()
  dup = null
  current.scrollLeft = 0
  current = null
}

export function scrollTextHover(el: HTMLElement | null) {
  if (el === current) return
  scrollTextStop()
  if (!el || el.scrollWidth <= el.clientWidth) return
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
  const first = el.firstElementChild as HTMLElement
  /* longueur d'un tour : le texte plus l'écart, mesurés avant d'ajouter la copie */
  const cycle = first.getBoundingClientRect().width + (parseFloat(getComputedStyle(el).columnGap) || 0)
  dup = first.cloneNode(true) as HTMLElement
  dup.setAttribute("aria-hidden", "true")
  el.appendChild(dup)
  current = el
  /* position en flottant local : `scrollLeft` arrondit au pixel physique et perdrait le cumul */
  let pos = 0
  let last = performance.now()
  const step = (now: number) => {
    /* élément démonté sans mouseleave (reset du graphe, changement d'onglet) : sans cette
       sortie, la boucle rAF tournerait indéfiniment sur un nœud détaché */
    if (!el.isConnected) return scrollTextStop()
    pos = (pos + ((now - last) / 1000) * SPEED) % cycle
    last = now
    el.scrollLeft = pos
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}
