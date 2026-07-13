import { Analytics01Icon, PackageIcon, ShieldIcon } from "@hugeicons/core-free-icons"

import { messages } from "@/lib/messages"
import type { MenuDescriptor } from "@/app/menu/types"

/** Repository ▸ database maintenance (Git Flow now lives in its own top-level menu). The whole
    menu is greyed off a repo tab (`disabled`); its items only build when a repository is in the
    foreground. */
export const repositoryMenu: MenuDescriptor = {
  id: "repository",
  get label() {
    return messages.menu.repository
  },
  disabled: (ctx) => !ctx.activeRepo,
  build: (ctx) => {
    const repo = ctx.activeRepo
    if (!repo) return []
    return [
      {
        kind: "action",
        id: "repository.stats",
        label: messages.menu.databaseStatistics,
        icon: Analytics01Icon,
        run: repo.openStats,
      },
      {
        kind: "action",
        id: "repository.verify",
        label: messages.menu.verifyDatabase,
        icon: ShieldIcon,
        run: repo.verifyDatabase,
      },
      {
        kind: "action",
        id: "repository.compact",
        label: messages.menu.compactDatabase,
        icon: PackageIcon,
        run: repo.compactDatabase,
      },
    ]
  },
}
