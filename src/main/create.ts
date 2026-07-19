/* Repository creation (the "+" page): `git init`, `git init --bare`, `git clone`. Same
   threat model as state.ts `openable` — the renderer never supplies an arbitrary destination,
   only folders the user just picked through the system dialog (`create:chooseDir`) or the
   configured root. The name is a single path segment, validated here before it reaches git
   or the filesystem. */

import { existsSync } from "node:fs"
import { join } from "node:path"
import type { ChildProcess } from "node:child_process"

import { AppError } from "../shared/errors.ts"
import { createGitRunner, killAll } from "./git/exec.ts"
import { persisted } from "./state.ts"
import { addGitBreadcrumb } from "./telemetry.ts"

/** Destinations blessed by the system dialog this session; the root folder is always allowed. */
const chosenDirs = new Set<string>()

export function allowDir(dir: string): void {
  chosenDirs.add(dir)
}

function assertDir(dir: string): void {
  if (typeof dir !== "string" || !dir) throw new AppError("BAD_ARG", "dir")
  if (dir !== persisted.root && !chosenDirs.has(dir)) throw new AppError("NOT_ALLOWED", dir)
  if (!existsSync(dir)) throw new AppError("BAD_ARG", dir)
}

/* One path segment: no separators or traversal, nothing Windows refuses, nothing git could
   read as an option. `..` falls to the leading-dot rule. */
const NAME = /^[^\\/:*?"<>|\p{Cc}]{1,128}$/u
function assertName(name: string): void {
  if (typeof name !== "string" || !NAME.test(name.trim()) || /^[-.]/.test(name.trim()))
    throw new AppError("BAD_ARG", "name")
}

/* In-flight init/clone children, killed at window close like per-repo ones (cf. window.ts). */
const children = new Set<ChildProcess>()
export const killCreations = (): void => killAll(children)

/** A clone pulls over the network: minutes, not the 60s read default. */
const CLONE_TIMEOUT = 10 * 60_000

const runner = (dir: string) => createGitRunner({ path: dir, children, onFailure: addGitBreadcrumb })

/** `dir/name`, guaranteed fresh — git init would silently adopt an existing folder. */
function target(dir: string, name: string): string {
  const dest = join(dir, name)
  if (existsSync(dest)) throw new AppError("EXISTS", dest)
  return dest
}

export async function initRepo(dir: string, name: string): Promise<string> {
  assertDir(dir)
  assertName(name)
  const dest = target(dir, name.trim())
  await runner(dir).git(["init", "--", dest])
  return dest
}

export async function initBare(dir: string, name: string): Promise<string> {
  assertDir(dir)
  assertName(name)
  /* the `.git` suffix is the bare-repo naming convention; applied unless already there */
  const base = name.trim()
  const dest = target(dir, base.endsWith(".git") ? base : `${base}.git`)
  await runner(dir).git(["init", "--bare", "--", dest])
  return dest
}

export async function cloneRepo(dir: string, url: string, name: string): Promise<string> {
  assertDir(dir)
  assertName(name)
  /* the URL is free-form (https, ssh, local path) but must never look like an option */
  if (typeof url !== "string" || !url.trim() || url.trim().startsWith("-")) throw new AppError("BAD_ARG", "url")
  const dest = target(dir, name.trim())
  await runner(dir).git(["clone", "--", url.trim(), dest], { timeout: CLONE_TIMEOUT })
  return dest
}
