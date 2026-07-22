/* Live merge dry-run behind the release dialog's branch list: a real preview per branch
   (`git merge-tree` cascade, cf. main/git/merge-preview.ts — the worktree never moves),
   re-run on every change of [base, included order]. */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"

import type { MergePreview, RepoApi } from "@/lib/git"

/** Dry-run: one preview per [base, included order], latest response wins. Also unchecks
    (via `setItems`) the branches the preview reports as already merged — see below. */
export function useMergePreview<I extends { branch: string; included: boolean }>(
  api: RepoApi,
  base: string,
  included: string[],
  setItems: Dispatch<SetStateAction<I[]>>
): { preview: Map<string, MergePreview>; previewing: boolean } {
  const [preview, setPreview] = useState<Map<string, MergePreview>>(new Map())
  const [previewing, setPreviewing] = useState(false)
  const seq = useRef(0)
  useEffect(() => {
    if (!base || !included.length) {
      setPreview(new Map())
      return
    }
    const mine = ++seq.current
    setPreviewing(true)
    api
      .mergePreview(base, included)
      .then(
        (res) => {
          if (seq.current === mine) setPreview(new Map(res.map((p) => [p.branch, p])))
        },
        () => {
          if (seq.current === mine) setPreview(new Map())
        }
      )
      .finally(() => {
        if (seq.current === mine) setPreviewing(false)
      })
  }, [api, base, included])

  /* a branch the base already holds has nothing to merge: unchecked once, automatically —
     re-checking it stays the user's call (autoExcluded remembers who was already handled) */
  const autoExcluded = useRef(new Set<string>())
  useEffect(() => {
    setItems((prev) =>
      prev.map((i) => {
        if (!i.included || preview.get(i.branch)?.status !== "merged" || autoExcluded.current.has(i.branch)) return i
        autoExcluded.current.add(i.branch)
        return { ...i, included: false }
      })
    )
  }, [preview, setItems])

  return { preview, previewing }
}
