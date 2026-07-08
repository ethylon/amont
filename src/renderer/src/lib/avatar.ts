import { host } from "@/lib/git"
import { laneColor } from "@/lib/graph-layout"

/* Une adresse `users.noreply.github.com` porte l'id du compte dans son préfixe : l'avatar se
   déduit sans requête d'API ni jeton. C'est la seule forge résolue ainsi — GitLab, lui, exige
   un appel authentifié à l'instance, ce qu'aucune adresse ne dit à elle seule.
   ponytail: pas d'ancienne forme `login@users.noreply.github.com`, elle n'a pas d'id à donner. */
const GH_NOREPLY = /^(\d+)\+[^@]+@users\.noreply\.github\.com$/

/* Certains signent sous une adresse ordinaire que seul GitHub sait rattacher à un compte : c'est
   le cas de `noreply@anthropic.com`, e-mail vérifié du compte `claude`. Les clients qui affichent
   cet avatar interrogent l'API de la forge à chaque commit ; deux entrées codées en dur ne coûtent
   aucune requête et n'exigent aucun jeton.
   ponytail: table figée — basculer sur l'API GitHub si la liste s'allonge. */
const KNOWN: Record<string, number> = { "noreply@anthropic.com": 81847 }

/* Sinon Gravatar, indexé par le sha256 de l'e-mail normalisé : la seule source qui ne demande ni
   compte ni configuration. `d=404` fait échouer l'image quand l'auteur n'y est pas — le monogramme
   derrière reste visible, et l'app marche hors ligne.
   Une seule taille demandée partout : un auteur, une URL, une entrée de cache HTTP. */
export function avatarUrl(email: string) {
  if (!email) return null
  const e = email.trim().toLowerCase()
  const id = KNOWN[e] ?? Number(GH_NOREPLY.exec(e)?.[1])
  if (id) return `https://avatars.githubusercontent.com/u/${id}?s=64`
  return `https://www.gravatar.com/avatar/${host.sha256(e)}?s=64&d=404`
}

/* Monogramme teinté par l'e-mail : deux auteurs se distinguent d'un coup d'œil, avatar ou pas.
   La palette est celle des lanes du graphe, déjà accordée aux deux thèmes. */
const hue = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export const tint = (name: string, email: string) => laneColor(hue(email || name))

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("")
