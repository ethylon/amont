/* Petits utilitaires transverses au main, trop courts pour mériter leur propre module dédié. */

export const basename = (p: string): string => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p
