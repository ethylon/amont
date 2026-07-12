/* Query keys of the home screen, in their own module: the creation page (features/create)
   shares `repos` to read the same root — and a component file exporting constants would
   break Fast Refresh (react-refresh/only-export-components). */

export const homeKeys = {
  repos: ["home", "repos"] as const,
  scan: (root: string | null) => ["home", "scan", root] as const,
}
