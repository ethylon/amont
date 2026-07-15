import { FolderAddIcon, FolderOpenIcon, Cancel01Icon, Settings01Icon } from "@hugeicons/core-free-icons"

import { messages } from "@/lib/messages"
import type { MenuDescriptor } from "@/app/menu/types"

/** File ▸ repository lifecycle: create, open, close the active tab, plus app settings. */
export const fileMenu: MenuDescriptor = {
  id: "file",
  get label() {
    return messages.menu.file
  },
  build: (ctx) => [
    { kind: "action", id: "file.new", label: messages.menu.newRepo, icon: FolderAddIcon, run: ctx.newRepo },
    { kind: "action", id: "file.open", label: messages.menu.openRepo, icon: FolderOpenIcon, run: ctx.openRepo },
    { kind: "separator" },
    {
      kind: "action",
      id: "file.settings",
      label: messages.menu.settings,
      icon: Settings01Icon,
      run: ctx.openSettings,
    },
    { kind: "separator" },
    {
      kind: "action",
      id: "file.close",
      label: messages.menu.closeTab,
      icon: Cancel01Icon,
      disabled: !ctx.hasActiveRepo,
      run: ctx.closeActiveTab,
    },
  ],
}
