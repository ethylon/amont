/* Interactive working-tree diff: the body DiffView renders instead of diff2html for a
   staged/unstaged text diff. Same visual grammar as the conflict view's ChunkSide — a header
   row per hunk, a +/- button per changed line, shiki on top — but the action is immediate
   (the professional convention for staging): each click builds the minimal sub-patch
   (diff-parse.ts) and applies it to the index (`repo:applyPatch`), then the worktree and
   diff caches refresh. In the unstaged view + stages; in the staged view − unstages
   (`git apply --cached --reverse`). Untracked files never reach here: without an index
   entry there is nothing to patch — whole-file staging remains their only path. */

import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons"

import type { RepoApi } from "@/lib/git"
import { describeError } from "@/lib/errors"
import { messages } from "@/lib/messages"
import { queryKeys } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { useRepoStore } from "@/features/repo/repo-store"
import { buildHunkPatch, buildPatch, type DiffLineKind, type ParsedDiff, type StageDirection } from "./diff-parse"
import { CodeLine, useShikiTokens } from "@/features/diff/shiki-tokens"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"

/* Same tints as the raw fallback render (diff-view RAW_CLASS): red/green IS the diff
   vocabulary here, unlike the conflict view where neither side is "removed". */
const TINT: Record<DiffLineKind, string> = { add: "bg-success/16", del: "bg-destructive/16", ctx: "" }

const MONO = "font-mono text-xs leading-normal [tab-size:4]"
const LINE_NO = "w-9 shrink-0 text-right text-[0.625rem] leading-normal text-muted-foreground tabular-nums select-none"

type Props = {
  api: RepoApi
  repoId: number
  path: string
  source: "staged" | "unstaged"
  parsed: ParsedDiff
}

export function WtDiffBody({ api, repoId, path, source, parsed }: Props) {
  const dark = useTheme()
  const queryClient = useQueryClient()
  const showOp = useRepoStore((s) => s.showOp)
  const [busy, setBusy] = useState(false)
  const dir: StageDirection = source === "unstaged" ? "stage" : "unstage"

  /* Two documents for the highlighter — old side (ctx + del) and new side (ctx + add) — so
     the grammar sees real code on each side; every diff line remembers which document and
     which line index paints it (same policy as the conflict panes). */
  const { oldDoc, newDoc, refs } = useMemo(() => {
    const oldL: string[] = []
    const newL: string[] = []
    const refs = parsed.hunks.map((h) =>
      h.lines.map((l) => {
        if (l.kind === "del") {
          oldL.push(l.text)
          return { doc: "old" as const, idx: oldL.length - 1 }
        }
        if (l.kind === "ctx") oldL.push(l.text)
        newL.push(l.text)
        return { doc: "new" as const, idx: newL.length - 1 }
      })
    )
    return { oldDoc: oldL.join("\n"), newDoc: newL.join("\n"), refs }
  }, [parsed])
  const oldTokens = useShikiTokens(oldDoc, path, dark)
  const newTokens = useShikiTokens(newDoc, path, dark)

  /* One in-flight apply at a time: the diff under the buttons is about to be refetched,
     a second click would build its patch against a stale parse. */
  const run = async (patch: string | null) => {
    if (!patch || busy) return
    setBusy(true)
    try {
      await api.applyPatch(patch, dir === "unstage")
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.diffAll(repoId) }),
      ])
    } catch (e) {
      showOp(describeError(e), "danger")
    } finally {
      setBusy(false)
    }
  }

  const lineButton = (hunk: number, line: number) => (
    <IconButton
      label={dir === "stage" ? messages.diff.stageLine : messages.diff.unstageLine}
      icon={dir === "stage" ? PlusSignIcon : MinusSignIcon}
      size="icon-xs"
      className="my-px ms-0.5 size-4 shrink-0 opacity-50 hover:opacity-100 focus-visible:opacity-100"
      disabled={busy}
      onClick={() => run(buildPatch(parsed, hunk, new Set([line]), dir))}
    />
  )

  return (
    <div className="min-h-0 flex-auto overflow-y-auto rounded-md border" aria-busy={busy}>
      {parsed.hunks.map((h, hi) => {
        let oldNo = h.oldStart
        let newNo = h.newStart
        return (
          <div key={hi}>
            <div
              className={cn(
                "flex items-center justify-between gap-2 border-b bg-muted/60 px-2 py-0.5",
                hi > 0 && "border-t"
              )}
            >
              <span className={cn("truncate text-[0.625rem] text-muted-foreground", MONO)}>{h.header}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto shrink-0 py-0.5 text-[0.625rem] font-medium"
                disabled={busy}
                onClick={() => run(buildHunkPatch(parsed, hi, dir))}
              >
                {dir === "stage" ? messages.diff.stageHunk : messages.diff.unstageHunk}
              </Button>
            </div>
            <div className="min-w-0 overflow-x-auto">
              {h.lines.map((l, li) => {
                const ref = refs[hi][li]
                const no = {
                  old: l.kind === "add" ? null : oldNo++,
                  new: l.kind === "del" ? null : newNo++,
                }
                return (
                  <div key={li} className={cn("flex min-w-max items-start", TINT[l.kind])}>
                    {l.kind === "ctx" ? (
                      <span aria-hidden className="my-px ms-0.5 size-4 shrink-0" />
                    ) : (
                      lineButton(hi, li)
                    )}
                    <span className={LINE_NO}>{no.old}</span>
                    <span className={LINE_NO}>{no.new}</span>
                    <pre className={cn("flex-1 px-1.5 whitespace-pre", MONO)}>
                      <CodeLine text={l.text} tokens={(ref.doc === "old" ? oldTokens : newTokens)?.[ref.idx]} />
                    </pre>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
