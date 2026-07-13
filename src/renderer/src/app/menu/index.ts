/* The menu registry: the ordered list of top-level menus shown in the bar. To add a menu,
   write a descriptor under ./menus and drop it in here — nothing else changes. */

import type { MenuDescriptor } from "@/app/menu/types"
import { fileMenu } from "@/app/menu/menus/file"
import { viewMenu } from "@/app/menu/menus/view"
import { repositoryMenu } from "@/app/menu/menus/repository"
import { gitflowMenu } from "@/app/menu/menus/gitflow"
import { helpMenu } from "@/app/menu/menus/help"

/** Bar order, left to right. */
export const MENUS: MenuDescriptor[] = [fileMenu, viewMenu, repositoryMenu, gitflowMenu, helpMenu]

export type { MenuContext, MenuDescriptor, MenuNode } from "@/app/menu/types"
export { AppMenu } from "@/app/menu/app-menu"
