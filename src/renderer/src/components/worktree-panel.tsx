import { useState } from "react"
import { type IconSvgElement } from "@hugeicons/react"
import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons"

import type { FileChange, RepoApi, Worktree, WtSource } from "@/lib/git"
import type { DiffCtx } from "@/components/diff-view"
import { FileListHeader, FileRow } from "@/components/file-list"
import { IconButton } from "@/components/ui/icon-button"
import { Button } from "@/components/ui/primitives/button"
import { Field, FieldError, FieldGroup } from "@/components/ui/primitives/field"
import { Textarea } from "@/components/ui/primitives/textarea"

/** `act` reçoit l'api du repo : la section est une constante, l'onglet ne l'est pas. */
type Section = {
  key: keyof Worktree
  title: string
  source: WtSource
  icon?: IconSvgElement
  hint?: string
  all?: string
  act?: WtAct
}

export type WtAct = (api: RepoApi, paths: string[]) => Promise<void>

const SECTIONS: Section[] = [
  { key: "conflicts", title: "Conflits", source: "unstaged" },
  { key: "staged", title: "Indexés", source: "staged", icon: MinusSignIcon, hint: "Désindexer", all: "Tout désindexer", act: (a, p) => a.unstage(p) },
  { key: "unstaged", title: "Modifiés", source: "unstaged", icon: PlusSignIcon, hint: "Indexer", all: "Tout indexer", act: (a, p) => a.stage(p) },
  { key: "untracked", title: "Non suivis", source: "untracked", icon: PlusSignIcon, hint: "Indexer", all: "Tout indexer", act: (a, p) => a.stage(p) },
]

type Props = {
  worktree: Worktree
  activePath?: string
  message: string
  onMessageChange(v: string): void
  onOpenDiff(ctx: DiffCtx, file: FileChange): void
  onRun(act: WtAct, paths: string[]): void
  onCommit(): Promise<void>
  children?: React.ReactNode
}

export function WorktreePanel({
  worktree, activePath, message, onMessageChange, onOpenDiff, onRun, onCommit, children,
}: Props) {
  const [committing, setCommitting] = useState(false)
  const staged = worktree.staged.length
  const hasConflicts = worktree.conflicts.length > 0
  const ready = staged > 0 && message.trim().length > 0 && !hasConflicts

  return (
    <>
      <h2 className="text-sm leading-snug font-semibold tracking-tight">Modifications non validées</h2>

      {SECTIONS.map((s) => {
        const list = worktree[s.key]
        if (!list.length) return null
        return (
          <div key={s.key} className="mt-4 border-t pt-3">
            <FileListHeader
              actions={
                s.act && (
                  <Button variant="ghost" size="xs" className="normal-case" onClick={() => onRun(s.act!, list.map((f) => f.path))}>
                    {s.all}
                  </Button>
                )
              }
            >
              {s.title} · {list.length}
            </FileListHeader>

            {list.map((f) => (
              <FileRow
                key={f.path}
                file={f}
                active={f.path === activePath}
                onClick={() => onOpenDiff({ wt: s.source }, f)}
                action={
                  s.act && (
                    <IconButton
                      label={s.hint!}
                      icon={s.icon!}
                      size="icon-xs"
                      className="ms-auto shrink-0 self-center opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100"
                      onClick={(ev) => {
                        ev.stopPropagation()
                        onRun(s.act!, [f.path])
                      }}
                    />
                  )
                }
              />
            ))}
          </div>
        )
      })}

      <FieldGroup className="mt-4 border-t pt-3">
        <Field data-invalid={hasConflicts || undefined}>
          {hasConflicts && <FieldError>Résous les conflits avant de committer.</FieldError>}
          <Textarea
            placeholder="Message de commit"
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            className="min-h-16 resize-y text-xs"
          />
          <Button
            disabled={!ready || committing}
            onClick={async () => {
              setCommitting(true)
              await onCommit()
              setCommitting(false)
            }}
          >
            {staged ? `Commit · ${staged} fichier${staged > 1 ? "s" : ""}` : "Commit"}
          </Button>
        </Field>
      </FieldGroup>

      {children}
    </>
  )
}
