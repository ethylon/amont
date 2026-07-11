import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, ArrowUp01Icon, FileSearchIcon, Search01Icon } from "@hugeicons/core-free-icons"

import type { RepoApi } from "@/lib/git"
import { describeError } from "@/lib/errors"
import { messages } from "@/lib/messages"
import { SEARCH_MIN, useSearchQuery } from "@/features/search/search-queries"
import { PRIORITY, useShortcut } from "@/app/shortcuts"
import type { GraphHandle } from "@/features/graph/controller"
import {
  InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"

const DEBOUNCE = 300

type Props = {
  api: RepoApi
  repoId: number
  graph: RefObject<GraphHandle | null>
  /** a background tab doesn't capture Ctrl+F */
  active: boolean
}

/* "Find in page" style search bar: the graph is never filtered — it would lose its
   lanes — but dims rows outside the results, and Enter jumps from result to result. */
export function CommitSearch({ api, repoId, graph, active }: Props) {
  const [q, setQ] = useState("")
  const [term, setTerm] = useState("") // debounced from `q`, the only identity the query retains
  const [content, setContent] = useState(false)

  const input = useRef<HTMLInputElement>(null)
  const cursor = useRef(-1) // last row reached, -1 = before the first

  useEffect(() => {
    cursor.current = -1
    const trimmed = q.trim()
    /* below the threshold: clear right away, no need to wait for the debounce */
    if (trimmed.length < SEARCH_MIN) {
      setTerm(trimmed)
      return
    }
    const t = window.setTimeout(() => setTerm(trimmed), DEBOUNCE)
    return () => clearTimeout(t)
  }, [q])

  /* TanStack Query itself cancels the stale fetch when `term`/`content` change before
     resolution (AbortSignal provided to the queryFn, see lib/queries.ts): no more `alive`
     flag to hand-copy to ignore a late response. */
  const { data: hits = null, isFetching: busy, error: queryError } = useSearchQuery(api, repoId, term, content)
  const error = queryError ? describeError(queryError) : null

  useEffect(() => {
    graph.current?.setMatches(term.length >= SEARCH_MIN ? (hits ?? null) : null)
  }, [graph, hits, term])

  const jump = useCallback(
    async (dir: 1 | -1) => {
      const row = await graph.current?.nextMatch(cursor.current, dir)
      if (row != null) cursor.current = row
    },
    [graph]
  )

  /* F3 navigates without going back through the field: the selection stays on the graph. */
  useShortcut(active, PRIORITY.DEFAULT, (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "f") {
      ev.preventDefault()
      input.current?.select()
      return true
    }
    if (ev.key === "F3") {
      ev.preventDefault()
      jump(ev.shiftKey ? -1 : 1)
      return true
    }
    return false
  })

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === "Enter") jump(ev.shiftKey ? -1 : 1)
    else if (ev.key === "Escape" && q) {
      ev.stopPropagation() // otherwise RepoView closes the diff instead of clearing the field
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
        placeholder={messages.search.placeholder}
      />

      {/* search result announced to screen readers */}
      <span aria-live="polite" className="sr-only">
        {error ? messages.search.error(error) : empty ? messages.search.noResults : hits ? messages.search.results(hits.length) : ""}
      </span>

      <InputGroupAddon align="inline-end">
        {busy ? (
          <Spinner className="size-3" />
        ) : error ? (
          <InputGroupText className="text-destructive">{messages.search.errorShort}</InputGroupText>
        ) : (
          hits && <InputGroupText className="tabular-nums">{hits.length}</InputGroupText>
        )}

        <InputGroupButton
          size="icon-xs"
          aria-label={messages.search.searchDiffContent}
          aria-pressed={content}
          className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
          onClick={() => setContent((v) => !v)}
        >
          <HugeiconsIcon icon={FileSearchIcon} strokeWidth={2} />
        </InputGroupButton>

        <InputGroupButton
          size="icon-xs"
          aria-label={messages.search.prevResult}
          disabled={!hits?.length}
          onClick={() => jump(-1)}
        >
          <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
        </InputGroupButton>
        <InputGroupButton
          size="icon-xs"
          aria-label={messages.search.nextResult}
          disabled={!hits?.length}
          onClick={() => jump(1)}
        >
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
