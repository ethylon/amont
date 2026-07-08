import { useEffect, useState } from "react"

type Async<T> = { data?: T; error?: boolean }

/** Charge une valeur et invalide les réponses en vol quand `key` change. */
export function useAsync<T>(load: () => Promise<T>, key: string): Async<T> {
  const [state, setState] = useState<Async<T>>({})

  useEffect(() => {
    let stale = false
    setState({})
    load().then(
      (data) => !stale && setState({ data }),
      () => !stale && setState({ error: true })
    )
    return () => {
      stale = true
    }
    // `load` est recréée à chaque rendu : `key` est la seule identité qui compte.
  }, [key])

  return state
}
