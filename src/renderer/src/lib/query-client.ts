/* Single QueryClient instance (AUDIT.md §5, "renderer state" workstream). Server state —
   status, refs, worktree, flow, files, message body, diff — goes entirely through
   TanStack Query: keys are scoped by repo (see `queryKeys` in lib/queries.ts), and
   mutations and git events (`onChanged`/`onOp`) invalidate those keys instead of copying
   state by hand. `placeholderData: keepPreviousData` (set per query, not here) keeps the
   previous render displayed while a new response comes in — no more `useAsync` flash. */

import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /* git doesn't notify anything on its own: it's `onChanged`/`onOp` that invalidate, not
         polling or a refetch on window focus — a focus event already triggers `refreshWorktree`
         via its own effect (see repo-view.tsx). */
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
})
