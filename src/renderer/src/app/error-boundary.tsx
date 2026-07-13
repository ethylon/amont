/* Error boundary (AUDIT.md §5, item 8): before this component, a render throw blanked
   the entire window, only caught by main's full reload (render-process-gone).
   One per tab (around RepoView) and one around DetailPanel/DiffView — a panel that
   crashes no longer takes down the rest of the tab.

   React doesn't offer a way to "retry" a render that has already thrown without starting
   from a fresh subtree: true recovery is a `key` change on the caller's side, which unmounts
   and remounts everything — `onReset` triggers it. The click also clears local state as a
   fallback for boundaries that haven't wired up a `key` (the display retries, without guarantee). */

import { Component, type ErrorInfo, type ReactNode } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon } from "@hugeicons/core-free-icons"

import { messages } from "@/lib/messages"
import { captureException } from "@/lib/telemetry"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

type Props = {
  children: ReactNode
  /** recovery button label */
  label?: string
  /** clears a caught error when it changes (compared with Object.is): lets the caller
      recover the boundary on navigation (e.g. a new selection) without keying the whole
      subtree — healthy children keep updating in place */
  resetKey?: unknown
  onReset?(): void
}

type State = { error: unknown }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && !Object.is(prev.resetKey, this.props.resetKey)) this.setState({ error: null })
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack)
    /* React render throws never reach window.onerror: report them by hand, with the
       component stack (no-op unless crash reporting is enabled — cf. lib/telemetry.ts) */
    captureException(error, info.componentStack)
  }

  private reset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    if (!this.state.error) return this.props.children
    const message = this.state.error instanceof Error ? this.state.error.message : messages.app.unexpectedError
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>{messages.app.somethingWentWrong}</EmptyTitle>
          <EmptyDescription className="[overflow-wrap:anywhere]">{message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={this.reset}>{this.props.label ?? messages.app.reload}</Button>
        </EmptyContent>
      </Empty>
    )
  }
}
