/* Parseur de `--name-status -z`, seul format sûr : sans `-z`, git C-quote les chemins
   non-ASCII (`"caf\303\251.txt"`) et un nom contenant tab ou saut de ligne pulvérise un
   split('\n')/split('\t'). En `-z`, chaque champ est terminé par NUL et les chemins sortent
   bruts. Un rename/copy occupe trois champs : `Rnn NUL ancien NUL nouveau NUL`.
   Module pur (zéro import Electron) : les scripts d'auto-contrôle l'exécutent sous Node. */

import type { FileChange } from '../shared/types';

export function parseNameStatus(out: string): FileChange[] {
  const files: FileChange[] = [];
  const parts = out.split('\0'); // NUL final : dernier élément vide, jamais consommé comme statut
  for (let i = 0; i < parts.length - 1; ) {
    const st = parts[i++];
    if (!st) break;
    /* R et C portent un score de similarité (R100) et un champ de plus : l'ancien chemin */
    const old = st[0] === 'R' || st[0] === 'C' ? parts[i++] : null;
    const path = parts[i++];
    if (path === undefined) break; // sortie tronquée : on rend ce qui est complet
    files.push({ st: st[0], path, old });
  }
  return files;
}
