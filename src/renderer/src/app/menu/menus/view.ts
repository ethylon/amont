import { Home01Icon, Moon02Icon, RefreshIcon } from "@hugeicons/core-free-icons"

import { messages } from "@/lib/messages"
import type { MenuDescriptor } from "@/app/menu/types"

/** View ▸ navigation and appearance. */
export const viewMenu: MenuDescriptor = {
  id: "view",
  get label() {
    return messages.menu.view
  },
  build: (ctx) => [
    { kind: "action", id: "view.home", label: messages.menu.goHome, icon: Home01Icon, run: ctx.goHome },
    { kind: "separator" },
    {
      kind: "checkbox",
      id: "view.dark",
      label: messages.menu.darkTheme,
      icon: Moon02Icon,
      checked: ctx.isDark,
      onCheckedChange: ctx.toggleTheme,
    },
    { kind: "separator" },
    {
      kind: "action",
      id: "view.reload",
      label: messages.menu.reload,
      icon: RefreshIcon,
      shortcut: "F5",
      run: ctx.reload,
    },
  ],
}
