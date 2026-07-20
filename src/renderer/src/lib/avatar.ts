import { sha256 } from "@/lib/sha256"
import { laneColor } from "@/features/graph/constants"

/* A `users.noreply.github.com` address carries the account id in its prefix: the avatar can be
   derived without an API call or a token. It's the only forge resolved this way — GitLab requires
   an authenticated call to the instance instead, which no address alone can give us.
   The older, id-less form (`login@users.noreply.github.com`) isn't handled: it has no id to give. */
const GH_NOREPLY = /^(\d+)\+[^@]+@users\.noreply\.github\.com$/

/* Otherwise Gravatar, indexed by the sha256 of the normalized e-mail: the only source that needs
   neither an account nor configuration. `d=404` fails the image when the author has none there —
   the monogram behind stays visible, and the app works offline.
   A single size requested everywhere: one author, one URL, one HTTP cache entry. */
export function avatarUrl(email: string) {
  if (!email) return null
  const e = email.trim().toLowerCase()
  const id = Number(GH_NOREPLY.exec(e)?.[1])
  if (id) return `https://avatars.githubusercontent.com/u/${id}?s=64`
  return `https://www.gravatar.com/avatar/${sha256(e)}?s=64&d=404`
}

/* Second chance once Gravatar has failed: GitHub resolves any address verified on an account —
   github.com/claude for `noreply@anthropic.com`, personal addresses too — through the avatar
   host's `u/e?email=` lookup, the endpoint its own commit pages use. No token, and the same host
   the CSP already trusts for img-src (connect-src added for the probe below).
   The lookup answers 200 either way: a hit serves the account's avatar, a miss serves one
   placeholder identicon shared by every unknown address — useless to an `onerror` chain, and
   blander than the tinted monogram it would cover. So the placeholder is never pinned here: it is
   learned once per session by asking for an address that cannot have an account (`.invalid` is a
   reserved TLD), and a candidate is a hit iff its bytes differ from that reference.
   Only addresses Gravatar already rejected are sent — in clear, unlike Gravatar's hash: the
   accepted price of a token-less lookup. One settled promise per address: the graph repeats an
   author hundreds of times, the network sees each address once. */
const lookupUrl = (e: string) => `https://avatars.githubusercontent.com/u/e?email=${encodeURIComponent(e)}&s=64`

const bytesOf = (url: string): Promise<Uint8Array | null> =>
  fetch(url)
    .then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null))
    .catch(() => null)

const differ = (a: Uint8Array, b: Uint8Array) => a.length !== b.length || a.some((v, i) => v !== b[i])

let placeholder: Promise<Uint8Array | null> | undefined
const looked = new Map<string, Promise<string | null>>()

export function githubEmailAvatar(email: string): Promise<string | null> {
  const e = email.trim().toLowerCase()
  if (!e) return Promise.resolve(null)
  let p = looked.get(e)
  if (!p) {
    placeholder ??= bytesOf(lookupUrl("no-account@sentinel.invalid"))
    const url = lookupUrl(e)
    p = Promise.all([bytesOf(url), placeholder]).then(([got, ref]) => (got && ref && differ(got, ref) ? url : null))
    looked.set(e, p)
  }
  return p
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
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("")
