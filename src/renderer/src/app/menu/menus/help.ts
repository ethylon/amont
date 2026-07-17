import {
  Book02Icon,
  BugIcon,
  InformationCircleIcon,
  SystemUpdate01Icon,
} from "@hugeicons/core-free-icons"

import { messages } from "@/lib/messages"
import type { MenuDescriptor } from "@/app/menu/types"

// The source repo is private; the public releases repo hosts the issue tracker.
const SITE = "https://amont.dev"
const RELEASES_REPO = "https://github.com/ethylon/amont-releases"

/** Help ▸ documentation, issue reporting, version. */
export const helpMenu: MenuDescriptor = {
  id: "help",
  get label() {
    return messages.menu.help
  },
  build: (ctx) => [
    {
      kind: "action",
      id: "help.docs",
      label: messages.menu.documentation,
      icon: Book02Icon,
      run: () => ctx.openExternal(SITE),
    },
    {
      kind: "action",
      id: "help.issue",
      label: messages.menu.reportIssue,
      icon: BugIcon,
      run: () => ctx.openExternal(`${RELEASES_REPO}/issues/new`),
    },
    { kind: "separator" },
    {
      kind: "action",
      id: "help.updates",
      label: messages.menu.checkForUpdates,
      icon: SystemUpdate01Icon,
      run: () => ctx.checkForUpdates(),
    },
    { kind: "separator" },
    {
      kind: "action",
      id: "help.about",
      label: messages.menu.about(ctx.version),
      icon: InformationCircleIcon,
      disabled: true,
      run: () => {},
    },
  ],
}
