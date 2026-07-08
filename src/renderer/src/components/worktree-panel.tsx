import { useState } from "react"
import { type IconSvgElement } from "@hugeicons/react"
import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons"

import type { FileChange, RepoApi, Worktree, WtSource } from "@/lib/git"
import type { DiffCtx } from "@/components/diff-view"
import { FileListHeader, FileRow } from "@/components/file-list"
import { IconButton } from "@/components/ui/icon-button"
import { Button } from "@/components/ui/primitives/button"
import { Field, FieldError, FieldGroup } from "@/components/ui/primitives/field"
import { Input } from "@/components/ui/primitives/input"
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
  /** première ligne du message ; la description remplit le corps */
  subject: string
  description: string
  onSubjectChange(v: string): void
  onDescriptionChange(v: string): void
  onOpenDiff(ctx: DiffCtx, file: FileChange): void
  onRun(act: WtAct, paths: string[]): void
  onCommit(): Promise<void>
}

export function WorktreePanel({
  worktree, activePath, subject, description, onSubjectChange, onDescriptionChange,
  onOpenDiff, onRun, onCommit,
}: Props) {
  const [committing, setCommitting] = useState(false)
  const staged = worktree.staged.length
  const hasConflicts = worktree.conflicts.length > 0
  const ready = staged > 0 && subject.trim().length > 0 && !hasConflicts

  return (
    <>
      <h2 className="shrink-0 text-sm leading-snug font-semibold tracking-tight">Modifications non validées</h2>

      {/* seules les sections scrollent : le titre et le bloc de commit restent en place */}
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto border-t pt-3">
        {SECTIONS.map((s) => {
          const list = worktree[s.key]
          if (!list.length) return null
          return (
            <div key={s.key} className="mt-4 border-t pt-3 first:mt-0 first:border-t-0 first:pt-0">
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
      </div>

      <FieldGroup className="mt-4 shrink-0 border-t pt-3">
        <Field data-invalid={hasConflicts || undefined}>
          {hasConflicts && <FieldError>Résous les conflits avant de committer.</FieldError>}
          <Input
            name="subject"
            aria-label="Message de commit"
            placeholder="Message de commit"
            value={subject}
            onChange={(e) => onSubjectChange(e.target.value)}
          />
          <Textarea
            name="description"
            aria-label="Description"
            placeholder="Description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
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
    </>
  )
}
