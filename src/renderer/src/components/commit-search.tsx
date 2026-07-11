import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, ArrowUp01Icon, FileSearchIcon, Search01Icon } from "@hugeicons/core-free-icons"

import type { RepoApi } from "@/lib/git"
import { describeError } from "@/lib/errors"
import type { GraphHandle } from "@/components/graph-canvas"
import {
  InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/primitives/spinner"

/* Sous ce seuil, `git log -S` balaierait l'historique entier pour rien. */
const MIN = 2
const DEBOUNCE = 300

type Props = {
  api: RepoApi
  graph: RefObject<GraphHandle | null>
  /** un onglet en arrière-plan ne capte pas Ctrl+F */
  active: boolean
}

/* Barre de recherche façon « find in page » : le graphe n'est jamais filtré — il perdrait ses
   lanes — mais estompe les lignes hors résultat, et Entrée saute de résultat en résultat. */
export function CommitSearch({ api, graph, active }: Props) {
  const [q, setQ] = useState("")
  const [content, setContent] = useState(false)
  const [hits, setHits] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const input = useRef<HTMLInputElement>(null)
  const cursor = useRef(-1) // dernière ligne atteinte, -1 = avant la première

  useEffect(() => {
    const term = q.trim()
    cursor.current = -1
    if (term.length < MIN) {
      setHits(null)
      setError(null)
      setBusy(false)
      graph.current?.setMatches(null)
      return
    }
    setBusy(true)
    let alive = true
    const t = window.setTimeout(async () => {
      try {
        const found = await api.search(term, content)
        if (!alive) return
        setHits(found)
        setError(null)
        graph.current?.setMatches(found)
      } catch (e) {
        if (!alive) return
        setHits(null)
        setError(describeError(e))
        graph.current?.setMatches(null)
      } finally {
        if (alive) setBusy(false)
      }
    }, DEBOUNCE)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [api, content, graph, q])

  const jump = useCallback(
    async (dir: 1 | -1) => {
      const row = await graph.current?.nextMatch(cursor.current, dir)
      if (row != null) cursor.current = row
    },
    [graph]
  )

  /* F3 navigue sans repasser par le champ : la sélection reste sur le graphe. */
  useEffect(() => {
    if (!active) return
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "f") {
        ev.preventDefault()
        input.current?.select()
      } else if (ev.key === "F3") {
        ev.preventDefault()
        jump(ev.shiftKey ? -1 : 1)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [active, jump])

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === "Enter") jump(ev.shiftKey ? -1 : 1)
    else if (ev.key === "Escape" && q) {
      ev.stopPropagation() // sinon RepoView referme le diff au lieu de vider le champ
      setQ("")
    }
  }

  const empty = hits !== null && hits.length === 0

  return (
    <InputGroup className="min-w-52 max-w-96">
      <InputGroupAddon>
        <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
      </InputGroupAddon>

      <InputGroupInput
        ref={input}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        aria-invalid={!!error || empty}
        placeholder="Filtrer les commits — message, auteur, hash"
      />

      {/* résultat de recherche annoncé aux lecteurs d'écran */}
      <span aria-live="polite" className="sr-only">
        {error ? `Erreur : ${error}` : empty ? "Aucun résultat" : hits ? `${hits.length} résultat${hits.length > 1 ? "s" : ""}` : ""}
      </span>

      <InputGroupAddon align="inline-end">
        {busy ? (
          <Spinner className="size-3" />
        ) : error ? (
          <InputGroupText className="text-destructive">erreur</InputGroupText>
        ) : (
          hits && <InputGroupText className="tabular-nums">{hits.length}</InputGroupText>
        )}

        <InputGroupButton
          size="icon-xs"
          aria-label="Chercher aussi dans le contenu des diffs"
          aria-pressed={content}
          className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
          onClick={() => setContent((v) => !v)}
        >
          <HugeiconsIcon icon={FileSearchIcon} strokeWidth={2} />
        </InputGroupButton>

        <InputGroupButton
          size="icon-xs"
          aria-label="Résultat précédent"
          disabled={!hits?.length}
          onClick={() => jump(-1)}
        >
          <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
        </InputGroupButton>
        <InputGroupButton
          size="icon-xs"
          aria-label="Résultat suivant"
          disabled={!hits?.length}
          onClick={() => jump(1)}
        >
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
