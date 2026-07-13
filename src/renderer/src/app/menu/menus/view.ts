import { ComputerIcon, Globe02Icon, Home01Icon, Moon02Icon, RefreshIcon, Sun03Icon } from "@hugeicons/core-free-icons"

import { messages } from "@/lib/messages"
import type { MenuDescriptor } from "@/app/menu/types"

/** View ▸ navigation, language, and appearance. Language and Theme are runtime switches
    (persisted); the checkmark on each tracks the live choice from `ctx`. */
export const viewMenu: MenuDescriptor = {
  id: "view",
  get label() {
    return messages.menu.view
  },
  build: (ctx) => [
    { kind: "action", id: "view.home", label: messages.menu.goHome, icon: Home01Icon, run: ctx.goHome },
    { kind: "separator" },
    {
      kind: "submenu",
      id: "view.language",
      label: messages.menu.language,
      icon: Globe02Icon,
      items: [
        {
          kind: "checkbox",
          id: "view.language.en",
          label: messages.menu.english,
          checked: ctx.locale === "en",
          onCheckedChange: () => ctx.setLocale("en"),
        },
        {
          kind: "checkbox",
          id: "view.language.fr",
          label: messages.menu.french,
          checked: ctx.locale === "fr",
          onCheckedChange: () => ctx.setLocale("fr"),
        },
      ],
    },
    {
      kind: "submenu",
      id: "view.theme",
      label: messages.menu.theme,
      icon: Moon02Icon,
      items: [
        {
          kind: "checkbox",
          id: "view.theme.light",
          label: messages.menu.themeLight,
          icon: Sun03Icon,
          checked: ctx.themeMode === "light",
          onCheckedChange: () => ctx.setTheme("light"),
        },
        {
          kind: "checkbox",
          id: "view.theme.dark",
          label: messages.menu.themeDark,
          icon: Moon02Icon,
          checked: ctx.themeMode === "dark",
          onCheckedChange: () => ctx.setTheme("dark"),
        },
        {
          kind: "checkbox",
          id: "view.theme.system",
          label: messages.menu.themeSystem,
          icon: ComputerIcon,
          checked: ctx.themeMode === "system",
          onCheckedChange: () => ctx.setTheme("system"),
        },
      ],
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
