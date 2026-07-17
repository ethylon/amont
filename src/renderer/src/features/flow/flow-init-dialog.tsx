import { useState } from "react"

import { useRepoStore } from "@/features/repo/repo-store"
import type { FlowInitConfig } from "@/lib/git"
import { messages } from "@/lib/messages"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/* git-flow's own `init -d` defaults (avh edition): the form is prefilled with these and stays
   fully editable. `versiontag` defaults to empty — the classic git-flow default. */
const DEFAULTS: FlowInitConfig = {
  master: "master",
  develop: "develop",
  feature: "feature/",
  bugfix: "bugfix/",
  release: "release/",
  hotfix: "hotfix/",
  support: "support/",
  versiontag: "",
}

/** One label/input row of the form. */
function Row({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-xs text-muted-foreground">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} autoComplete="off" />
    </label>
  )
}

export function FlowInitDialog({ onClose }: { onClose: () => void }) {
  const api = useRepoStore((s) => s.api)
  const runFlow = useRepoStore((s) => s.runFlow)
  const [cfg, setCfg] = useState<FlowInitConfig>(DEFAULTS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: keyof FlowInitConfig) => (v: string) => setCfg((c) => ({ ...c, [key]: v }))
  const valid = cfg.master.trim() !== "" && cfg.develop.trim() !== ""

  async function submit() {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    const err = await runFlow(() => api.flowInit(cfg).then(() => {}))
    setBusy(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] sm:max-w-md">
        {/* max-h relayed onto the viewport, minus DialogContent's p-4: the stock viewport
            (size-full) would otherwise resolve against an auto height and never scroll */}
        <ScrollArea className="[&>[data-slot=scroll-area-viewport]]:max-h-[calc(85vh-2rem)]">
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{messages.gitflow.initializeTitle}</DialogTitle>
              <DialogDescription>{messages.gitflow.initializeIntro}</DialogDescription>
            </DialogHeader>

            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              <Row label={messages.gitflow.productionBranch} value={cfg.master} onChange={set("master")} />
              <Row label={messages.gitflow.developmentBranch} value={cfg.develop} onChange={set("develop")} />
              <Row label={messages.gitflow.featurePrefix} value={cfg.feature} onChange={set("feature")} />
              <Row label={messages.gitflow.bugfixPrefix} value={cfg.bugfix} onChange={set("bugfix")} />
              <Row label={messages.gitflow.releasePrefix} value={cfg.release} onChange={set("release")} />
              <Row label={messages.gitflow.hotfixPrefix} value={cfg.hotfix} onChange={set("hotfix")} />
              <Row label={messages.gitflow.supportPrefix} value={cfg.support} onChange={set("support")} />
              <Row label={messages.gitflow.versionTagPrefix} value={cfg.versiontag} onChange={set("versiontag")} />

              {error && (
                <Badge color="danger" shape="squared" className="self-start">
                  {error}
                </Badge>
              )}

              <DialogFooter className="mt-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                  {messages.gitflow.cancel}
                </Button>
                <Button type="submit" disabled={!valid || busy}>
                  {busy ? messages.gitflow.initializing : messages.gitflow.initialize}
                </Button>
              </DialogFooter>
            </form>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
