/* Small utilities used across main, too short to deserve their own dedicated module. */

export const basename = (p: string): string => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p
