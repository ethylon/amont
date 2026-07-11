import { useSyncExternalStore } from "react"

import { sha256 } from "@/lib/sha256"
import { laneColor } from "@/features/graph/constants"
import { prefs } from "@/lib/prefs"

/* A `users.noreply.github.com` address carries the account id in its prefix: the avatar can be
   derived without an API call or a token. It's the only forge resolved this way — GitLab requires
   an authenticated call to the instance instead, which no address alone can give us.
   The older, id-less form (`login@users.noreply.github.com`) isn't handled: it has no id to give. */
const GH_NOREPLY = /^(\d+)\+[^@]+@users\.noreply\.github\.com$/

/* --- Privacy toggle (AUDIT.md §9): every avatar shown is a network request to Gravatar or
   GitHub, leaking the viewer's IP and the (hashed, but often reversible) author email to a third
   party. Off by default; opting in falls back to Gravatar/GitHub, opting out (or leaving it off)
   always uses the monogram below. Reactive like lib/theme.ts's useTheme, for the same reason: a
   toggle flipped from settings should update every consumer without a page reload.
   Known limitation: rows already painted in the graph (features/graph/render/rows.ts) are never
   repainted — the toggle takes effect on newly rendered rows (scroll, new tab, reopened repo). */
const listeners = new Set<() => void>()

export const avatarsEnabled = (): boolean => prefs.avatars.get() === "on"

export function setAvatarsEnabled(enabled: boolean): void {
  prefs.avatars.set(enabled ? "on" : "off")
  listeners.forEach((f) => f())
}

export function useAvatarsEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    avatarsEnabled
  )
}

/* Otherwise Gravatar, indexed by the sha256 of the normalized e-mail: the only source that needs
   neither an account nor configuration. `d=404` fails the image when the author has none there —
   the monogram behind stays visible, and the app works offline.
   A single size requested everywhere: one author, one URL, one HTTP cache entry. */
export function avatarUrl(email: string) {
  if (!email || !avatarsEnabled()) return null
  const e = email.trim().toLowerCase()
  const id = Number(GH_NOREPLY.exec(e)?.[1])
  if (id) return `https://avatars.githubusercontent.com/u/${id}?s=64`
  return `https://www.gravatar.com/avatar/${sha256(e)}?s=64&d=404`
}

/* Email-tinted monogram: two authors stand apart at a glance, avatar or not.
   The palette is the graph's lane palette, already tuned for both themes. */
const hue = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export const tint = (name: string, email: string) => laneColor(hue(email || name))

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("")
