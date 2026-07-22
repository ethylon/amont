/* Remote-ahead banner — the strip a refused push opens (git/ops.ts probes the tracking ref
   and raises REMOTE_AHEAD instead of letting git's non-fast-forward rejection land as a
   dead-end badge). Same warning strip as the conflict banner, and it carries the ways out:
   integrate the remote's commits (`git pull --ff` — fast-forward when possible, a merge when
   diverged), overwrite them (`git push --force-with-lease`), or cancel. The choice closes the
   strip right away; the op's own feedback (toolbar shimmer, footer feed, badges) takes over. */

import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUp02Icon, Cancel01Icon } from "@hugeicons/core-free-icons"

import { messages } from "@/lib/messages"
import { useRepoStore } from "@/features/repo/repo-store"
import { Banner, BannerActions, BannerDetail, BannerTitle } from "@/components/ui/banner"
import { Button } from "@/components/ui/button"
import { GitCmd } from "@/components/ui/git-cmd"

export function RemoteAheadBanner() {
  const remoteAhead = useRepoStore((s) => s.ui.remoteAhead)
  const resolve = useRepoStore((s) => s.resolveRemoteAhead)
  const onClose = useRepoStore((s) => s.closeRemoteAhead)
  if (!remoteAhead) return null

  return (
    /* amont-drop (via Banner): after boot, the insertion pushes the content in smoothly (see app.css) */
    <Banner>
      <HugeiconsIcon icon={ArrowUp02Icon} strokeWidth={2} className="size-4 shrink-0" />
      <BannerTitle>{messages.remoteAhead.banner}</BannerTitle>
      {remoteAhead.behind > 0 && <BannerDetail>{messages.remoteAhead.commitsBehind(remoteAhead.behind)}</BannerDetail>}
      <BannerActions>
        <Button variant="outline" size="sm" className="h-auto min-h-6 py-0.5" onClick={() => void resolve("pull")}>
          <span className="flex flex-col items-start">
            <span>{messages.remoteAhead.pullFf}</span>
            <GitCmd cmd="git pull --ff" />
          </span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto min-h-6 py-0.5 normal-case tracking-normal text-destructive"
          onClick={() => void resolve("force")}
        >
          <span className="flex flex-col items-start">
            <span>{messages.remoteAhead.forcePush}</span>
            <GitCmd cmd="git push --force-with-lease" className="text-destructive/70" />
          </span>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={messages.remoteAhead.cancel}>
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      </BannerActions>
    </Banner>
  )
}
