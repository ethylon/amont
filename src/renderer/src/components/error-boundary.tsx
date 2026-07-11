/* Frontière d'erreur (AUDIT.md §5, item 8) : avant ce composant, un throw de rendu blanchissait
   toute la fenêtre, rattrapé seulement par le reload complet du main (render-process-gone).
   Une par onglet (autour de RepoView) et une autour de DetailPanel/DiffView — un panneau qui
   plante n'emporte plus le reste de l'onglet.

   React n'offre pas de "réessayer" un rendu qui a déjà jeté sans repartir d'un sous-arbre
   neuf : la vraie récupération est un changement de `key` côté appelant, qui démonte et
   remonte tout — `onReset` le déclenche. Le clic vide aussi l'état local en secours pour les
   frontières qui n'auraient pas câblé de `key` (l'affichage réessaie, sans garantie). */

import { Component, type ErrorInfo, type ReactNode } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/primitives/empty"

type Props = {
  children: ReactNode
  /** libellé du bouton de récupération */
  label?: string
  onReset?(): void
}

type State = { error: unknown }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack)
  }

  private reset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    if (!this.state.error) return this.props.children
    const message = this.state.error instanceof Error ? this.state.error.message : "Erreur inattendue."
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>Un problème est survenu</EmptyTitle>
          <EmptyDescription className="[overflow-wrap:anywhere]">{message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={this.reset}>{this.props.label ?? "Recharger"}</Button>
        </EmptyContent>
      </Empty>
    )
  }
}
