/* The app-level dialog open-states and their openers. The dialogs themselves stay in App
   (they're lazy JSX); this owns when each is open, and the create dialog's mounted-once
   flag that keeps its exit animation after the first open. */

import { useCallback, useState } from "react"

import { host, type Repo } from "@/lib/git"

export function useDialogs(openTab: (repo: Repo) => void) {
  /* the folder-picker path shared with the home screen: open the dialog, and if a repo
     comes back, surface it as a tab. A cancelled dialog resolves to null and is a no-op. */
  const openDialog = useCallback(() => {
    void host.openDialog().then((res) => res && openTab(res))
  }, [openTab])

  /* Repository creation is a modal now (was a pinned tab): the "+" and File ▸ New repository
     open it; a created/cloned repo opens as a tab through `openTab`, which closes the dialog.
     The lazy dialog mounts on first open and stays mounted, so re-opens are instant and
     closing keeps its exit animation. */
  const [createOpen, setCreateOpen] = useState(false)
  const [createMounted, setCreateMounted] = useState(false)
  const openCreate = useCallback(() => {
    setCreateMounted(true)
    setCreateOpen(true)
  }, [])
  const openCreated = useCallback(
    (repo: Repo) => {
      setCreateOpen(false)
      openTab(repo)
    },
    [openTab]
  )

  const [settingsOpen, setSettingsOpen] = useState(false)
  const openSettings = useCallback(() => setSettingsOpen(true), [])

  const [aboutOpen, setAboutOpen] = useState(false)
  const openAbout = useCallback(() => setAboutOpen(true), [])

  return {
    createOpen,
    setCreateOpen,
    createMounted,
    settingsOpen,
    setSettingsOpen,
    aboutOpen,
    setAboutOpen,
    openDialog,
    openCreate,
    openCreated,
    openSettings,
    openAbout,
  }
}
