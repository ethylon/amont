import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { IconSvgElement } from "@hugeicons/react"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const SVG_NS = "http://www.w3.org/2000/svg"
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())

/** Une icône Hugeicons hors React : le canvas du graphe construit son DOM à la main. */
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
