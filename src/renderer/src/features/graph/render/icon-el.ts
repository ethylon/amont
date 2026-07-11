/* A Hugeicons icon outside React (AUDIT.md §7, phase 5, item 6 — used to live in lib/utils, only
   the graph engine builds its DOM by hand and needs it). */

import type { IconSvgElement } from "@hugeicons/react"

const SVG_NS = "http://www.w3.org/2000/svg"
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())

export function iconEl(icon: IconSvgElement, className: string, strokeWidth = 2) {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("class", className)
  for (const [tag, attrs] of icon) {
    const el = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(attrs)) if (k !== "key") el.setAttribute(kebab(k), String(v))
    if (el.hasAttribute("stroke")) el.setAttribute("stroke-width", String(strokeWidth))
    svg.appendChild(el)
  }
  return svg
}
