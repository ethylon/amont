/* invalidateRepo must include the stashes key: a stash push/pop/drop has to refresh the
   sidebar's stash list the same way it refreshes status/refs/flow, otherwise the list keeps
   showing cached data while the graph reloads. QueryClient is pure JS, so this runs under the
   Node test env. */
import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"

import { invalidateRepo, queryKeys } from "./queries.ts"

describe("invalidateRepo (2.1)", () => {
  it("invalidates the stashes key alongside status/refs/flow", () => {
    const client = new QueryClient()
    const id = 7
    // Seed cache entries so each key has a live query to invalidate.
    client.setQueryData(queryKeys.status(id), { branch: "main" })
    client.setQueryData(queryKeys.refs(id), [])
    client.setQueryData(queryKeys.stashes(id), [])
    client.setQueryData(queryKeys.flow(id), null)

    invalidateRepo(client, id)

    expect(client.getQueryState(queryKeys.stashes(id))?.isInvalidated).toBe(true)
    expect(client.getQueryState(queryKeys.status(id))?.isInvalidated).toBe(true)
  })
})
