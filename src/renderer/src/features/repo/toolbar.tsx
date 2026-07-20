import { memo } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArchiveArrowDownIcon,
  ArchiveArrowUpIcon,
  ArchiveRestoreIcon,
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowUp02Icon,
  Folder01Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons"

import type { OpName, Repo, StashAct, Status } from "@/lib/git"
import { useLocale } from "@/lib/i18n"
import { messages } from "@/lib/messages"
import { Badge } from "@/components/ui/badge"
import { GitCmd, MenuItemWithCmd } from "@/components/ui/git-cmd"
import { IconButton } from "@/components/ui/icon-button"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"

/* labels are thunks, not values: reading messages.* at module scope would run `t` during
   import, before setupI18n() has activated a locale (cf. refs-menu.tsx). Pull/Push reuse the
   refs catalogue entries — same action, same string. Fetch's `cmd` is the base; `--prune` is
   appended live from the setting (see the component), so the shown command stays truthful. */
const OPS = [
  { op: "fetch", label: () => messages.repo.fetch, icon: Refresh01Icon, cmd: "git fetch --all" },
  { op: "pull", label: () => messages.refs.pull, icon: ArrowDown02Icon, cmd: "git pull --ff-only" },
  { op: "push", label: () => messages.refs.push, icon: ArrowUp02Icon, cmd: "git push" },
] as const

type Props = {
  repo: Repo
  status: Status | null
  busyOp: OpName | null
  /** labels waiting in the repo's mutation queue (`git:queue`): a same-name network op in
      there greys its button — queueing a duplicate push would be pointless */
  queued: string[]
  sidebarOpen: boolean
  onToggleSidebar(): void
  onRunOp(op: OpName): void
  /** the worktree has something to stash: an empty tree greys the stash button */
  canStash: boolean
  /** newest entry (`stash@{0}`) or `null`: the apply/pop menu only exists when there is one */
  latestStash: string | null
  onStash(action: StashAct, name?: string): void
  /** the `prune` setting: appends `--prune` to the shown fetch command when on */
  prune: boolean
  /** the search bar: it needs the graph, which the toolbar doesn't know about */
  children: React.ReactNode
}

/* memo (perf audit, finding 4b): a commit click re-renders the tab, but none of the
   toolbar's props move — with stable callbacks and a memoized `children` element on
   RepoView's side, the whole bar (and the search field inside it) skips. */
export const Toolbar = memo(function Toolbar({
  repo,
  status,
  busyOp,
  queued,
  sidebarOpen,
  onToggleSidebar,
  onRunOp,
  canStash,
  latestStash,
  onStash,
  prune,
  children,
}: Props) {
  /* memo'd component: re-render on a runtime language switch even when no prop moved */
  useLocale()
  const counts: Record<OpName, number | null> = {
    fetch: null,
    pull: status?.behind ?? null,
    push: status?.ahead ?? null,
  }

  /* one op button (fetch/pull/push); `cmdOverride` lets fetch show its live, prune-aware command.
     A running op no longer greys the two others: clicking them queues (main-side FIFO) — that's
     how a fetch→pull→push chain is fired in one go. Only the same op, already running or
     already waiting, is greyed: a duplicate would be dropped main-side anyway. */
  const opButton = ({ op, label, icon, cmd }: (typeof OPS)[number], cmdOverride?: string) => {
    const n = counts[op]
    return (
      <Button
        key={op}
        variant="ghost"
        size="sm"
        className="h-auto min-h-6 gap-2 py-0.5"
        disabled={n === 0 || busyOp === op || queued.includes(op)}
        aria-busy={busyOp === op}
        onClick={() => onRunOp(op)}
      >
        {busyOp === op ? (
          <Spinner data-icon="inline-start" className="size-3" />
        ) : (
          <HugeiconsIcon icon={icon} strokeWidth={2} data-icon="inline-start" />
        )}
        <span className="flex flex-col items-start">
          <span className="flex items-center gap-1">
            {label()}
            {!!n && (
              <Badge color="primary" shape="squared" className="tabular-nums">
                {n}
              </Badge>
            )}
          </span>
          <GitCmd cmd={cmdOverride ?? cmd} running={busyOp === op} />
        </span>
      </Button>
    )
  }

  const [fetchOp, ...restOps] = OPS
  /* `--prune` is a live setting, appended to fetch's shown command so it never lies */
  const fetchCmd = `${fetchOp.cmd}${prune ? " --prune" : ""}`

  return (
    <div className="flex h-11.5 shrink-0 items-center gap-2 overflow-x-auto border-b pr-3.5">
      {/* w-59 = the sidebar's width: the closing separator lands on its border-r.
          Fixed width also keeps the bar's geometry stable across repo-name lengths. */}
      <div className="flex w-59 shrink-0 items-center gap-2 self-stretch pl-2.5">
        <IconButton
          label={sidebarOpen ? messages.repo.hideSidebar : messages.repo.showSidebar}
          icon={PanelLeftCloseIcon}
          swapIcon={PanelLeftOpenIcon}
          swapped={sidebarOpen}
          onClick={onToggleSidebar}
        />

        <span className="amont-reponame flex min-w-0 flex-1 items-center gap-1.5 text-xs">
          <HugeiconsIcon icon={Folder01Icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{repo.name}</span>
        </span>

        <Separator orientation="vertical" className="my-2" />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {/* `--prune` is a live setting, so fetch's shown command is built from it (see fetchCmd). */}
        {opButton(fetchOp, fetchCmd)}
        {restOps.map((op) => opButton(op))}
      </div>

      <Separator orientation="vertical" className="mx-1 my-2" />

      {/* Stash, local counterpart of the network ops (hence past the separator): the button
          stashes the whole tree (same command as the staging panel's menu entry); the chevron
          only exists when the list has an entry, and targets the newest one — the sidebar's
          stash section keeps the per-entry menu. */}
      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="sm"
          className="h-auto min-h-6 gap-2 py-0.5"
          disabled={!canStash}
          onClick={() => onStash("push")}
        >
          <HugeiconsIcon icon={ArchiveArrowDownIcon} strokeWidth={2} data-icon="inline-start" />
          <span className="flex flex-col items-start">
            <span>{messages.worktree.stash}</span>
            <GitCmd cmd="git stash push -u" />
          </span>
        </Button>
        {latestStash && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<IconButton label={messages.worktree.moreActions} icon={ArrowDown01Icon} size="icon-xs" />}
            />
            <DropdownMenuContent align="start" className="w-max min-w-44">
              <DropdownMenuItem onClick={() => onStash("apply", latestStash)}>
                <HugeiconsIcon icon={ArchiveArrowUpIcon} strokeWidth={2} />
                <MenuItemWithCmd label={messages.stash.apply} cmd={`git stash apply ${latestStash}`} />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onStash("pop", latestStash)}>
                <HugeiconsIcon icon={ArchiveRestoreIcon} strokeWidth={2} />
                <MenuItemWithCmd label={messages.stash.applyAndDrop} cmd={`git stash pop ${latestStash}`} />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <span className="flex-1" />

      {children}
    </div>
  )
})
