export type Locale = "en" | "fr"

export interface Feature {
  emoji: string
  title: string
  body: string
}

export interface TourStop {
  title: string
  body: string
  shot: "graph" | "diff" | "worktree" | "conflict"
  alt: string
}

export interface Dict {
  meta: { title: string; description: string }
  nav: { features: string; tour: string; download: string; theme: string }
  hero: {
    badge: string
    title: string
    lede: string
    ctaDownload: string
    ctaGithub: string
    caption: string
    graphAlt: string
  }
  features: { heading: string; sub: string; items: Feature[] }
  tour: { heading: string; stops: TourStop[] }
  open: {
    heading: string
    items: { title: string; body: string }[]
    cta: string
  }
  download: {
    heading: string
    body: string
    cta: string
    platform: string
    smartscreenTitle: string
    smartscreen: string
  }
  footer: { license: string }
}

export const dict: Record<Locale, Dict> = {
  en: {
    meta: {
      title: "Amont — a fast Git client for Windows",
      description:
        "Amont is a fast, open-source Git client for Windows: commit graph, commit search, syntax-highlighted diffs, line-level staging, side-by-side conflict resolution, worktrees and git-flow.",
    },
    nav: { features: "Features", tour: "Screenshots", download: "Download", theme: "Toggle theme" },
    hero: {
      badge: "Windows · Open source · MIT",
      title: "A fast Git client for Windows.",
      lede: "Amont displays a repository's history as a commit graph and lets you work directly from it: search commits, read diffs, stage down to the line, resolve merge conflicts. It runs the git installed on your machine and shows every command it executes.",
      ctaDownload: "Download for Windows",
      ctaGithub: "View on GitHub",
      caption: "Screenshots on this page show Amont on its own repository.",
      graphAlt:
        "Amont's main window: the commit graph with branch lanes and ref chips, the branches sidebar, and the detail panel showing a commit's message and file tree.",
    },
    features: {
      heading: "Features",
      sub: "The everyday Git workflow — history, diffs, staging, conflicts, branches, remotes — in one window.",
      items: [
        {
          emoji: "🚇",
          title: "Commit graph",
          body: "Branches, merges, tags, stashes and ahead/behind status in one scrollable view. Stays fast on histories of 100,000+ commits.",
        },
        {
          emoji: "🔍",
          title: "Commit search",
          body: "Search by message, author or hash prefix — or through the contents of diffs.",
        },
        {
          emoji: "🎨",
          title: "Diffs",
          body: "Syntax-highlighted, unified or side-by-side, per file or for the whole commit. Images are shown in an image viewer.",
        },
        {
          emoji: "🧬",
          title: "Staging",
          body: "Stage, unstage or discard files, folders, hunks or single lines from an interactive diff. Commit and amend from the same panel.",
        },
        {
          emoji: "🧩",
          title: "Merge conflicts",
          body: "Both versions side by side: take a whole side, one block or single lines, in any order, then edit the result before marking the file resolved.",
        },
        {
          emoji: "🌳",
          title: "Worktrees",
          body: "Create, open, reveal or remove linked worktrees from the sidebar or the graph.",
        },
        {
          emoji: "🌊",
          title: "git-flow",
          body: "Start, publish and finish feature, release and hotfix branches from the UI.",
        },
        {
          emoji: "⚡",
          title: "Remote operations",
          body: "Fetch, pull and push with live progress; optional periodic auto-fetch keeps the graph up to date.",
        },
        {
          emoji: "🔎",
          title: "Command transparency",
          body: "Buttons show the exact git command they will run, and a read-only console logs every command the app executes.",
        },
        {
          emoji: "⌨️",
          title: "Keyboard support",
          body: "The graph, file lists, sidebar, menus and popovers all work without a mouse.",
        },
        {
          emoji: "🎛️",
          title: "Customization",
          body: "Light and dark themes, English and French UI, custom branch-prefix colors, configurable diff highlighting.",
        },
        {
          emoji: "🔄",
          title: "Auto-update",
          body: "Checks GitHub Releases at startup, downloads in the background, installs on quit or on “Restart now”.",
        },
      ],
    },
    tour: {
      heading: "Screenshots",
      stops: [
        {
          title: "The commit graph",
          body: "A history of about 25,000 commits in a single timeline: branch lanes, merge curves, tags, stashes, ahead/behind status, and type badges on commit subjects. Selecting a commit opens its full message, co-authors and changed files.",
          shot: "graph",
          alt: "The commit graph and detail panel.",
        },
        {
          title: "Diffs",
          body: "Unified or side-by-side, one file or the whole commit, with syntax highlighting throughout. The two panes scroll together; images are shown in an image viewer.",
          shot: "diff",
          alt: "A side-by-side, syntax-highlighted diff of a TypeScript file, with the commit's detail panel on the right.",
        },
        {
          title: "Staging",
          body: "Stage files, folders, hunks or single lines from a live diff, then commit or amend. The commit button shows the exact git command before you run it.",
          shot: "worktree",
          alt: "The staging panel: staged and unstaged file trees, a live side-by-side diff with per-hunk stage/discard actions, and the commit message box.",
        },
        {
          title: "Merge conflicts",
          body: "Both versions in aligned panes. Take a whole side, one block or single lines, in the order you choose; the merged output is a regular editor, so picks and hand edits can be combined before marking the file resolved.",
          shot: "conflict",
          alt: "The conflict resolution view: the 'ours' and 'theirs' versions of a file in two aligned, syntax-highlighted panes with per-side and per-line pickers, above an editable merged output.",
        },
      ],
    },
    open: {
      heading: "Open source",
      items: [
        {
          title: "MIT license",
          body: "Developed in the open on GitHub — issues, pull requests and releases.",
        },
        {
          title: "Private by default",
          body: "Crash reports contain no repository contents and no personal data, and can be disabled in the app. Builds from source send nothing.",
        },
        {
          title: "Transparent",
          body: "Every mutation button shows the git command it will run; a read-only console logs every command executed.",
        },
      ],
      cta: "Read the source",
    },
    download: {
      heading: "Download",
      body: "Download the installer from the latest GitHub release and run it. Amont then keeps itself up to date: it checks at startup, downloads in the background, and installs on quit or when you click “Restart now”.",
      cta: "Download the latest release",
      platform: "Windows only for now — macOS and Linux are not packaged yet.",
      smartscreenTitle: "About the SmartScreen warning",
      smartscreen:
        "Released binaries are not code-signed yet, so Windows shows an “unknown publisher” warning when you run the installer. This is expected. Update integrity relies on HTTPS to GitHub and the sha512 checksum in latest.yml.",
    },
    footer: {
      license: "MIT © Mathieu Guey",
    },
  },
  fr: {
    meta: {
      title: "Amont — un client Git rapide pour Windows",
      description:
        "Amont est un client Git open source et rapide pour Windows : graphe de commits, recherche de commits, diffs colorés, staging à la ligne, résolution de conflits côte à côte, worktrees et git-flow.",
    },
    nav: {
      features: "Fonctionnalités",
      tour: "Captures d'écran",
      download: "Télécharger",
      theme: "Changer de thème",
    },
    hero: {
      badge: "Windows · Open source · MIT",
      title: "Un client Git rapide pour Windows.",
      lede: "Amont affiche l'historique d'un dépôt sous forme de graphe de commits et permet d'y travailler directement : rechercher des commits, lire les diffs, stager à la ligne près, résoudre les conflits de merge. Il utilise le git installé sur votre machine et affiche chaque commande qu'il exécute.",
      ctaDownload: "Télécharger pour Windows",
      ctaGithub: "Voir sur GitHub",
      caption: "Les captures de cette page montrent Amont sur son propre dépôt.",
      graphAlt:
        "La fenêtre principale d'Amont : le graphe de commits avec ses lignes de branches et ses pastilles de refs, la barre latérale des branches, et le panneau de détail montrant le message et l'arborescence d'un commit.",
    },
    features: {
      heading: "Fonctionnalités",
      sub: "Le quotidien de Git — historique, diffs, staging, conflits, branches, remotes — dans une seule fenêtre.",
      items: [
        {
          emoji: "🚇",
          title: "Graphe de commits",
          body: "Branches, merges, tags, stashs et divergence ahead/behind dans une seule vue. Reste rapide sur des historiques de plus de 100 000 commits.",
        },
        {
          emoji: "🔍",
          title: "Recherche de commits",
          body: "Par message, auteur ou préfixe de hash — ou dans le contenu des diffs.",
        },
        {
          emoji: "🎨",
          title: "Diffs",
          body: "Coloration syntaxique, vue unifiée ou côte à côte, par fichier ou pour le commit entier. Les images s'affichent dans un visualiseur.",
        },
        {
          emoji: "🧬",
          title: "Staging",
          body: "Stagez, retirez ou annulez fichiers, dossiers, hunks ou lignes seules depuis un diff interactif. Commit et amend depuis le même panneau.",
        },
        {
          emoji: "🧩",
          title: "Conflits de merge",
          body: "Les deux versions côte à côte : prenez un côté entier, un bloc ou des lignes seules, dans l'ordre voulu, puis retouchez le résultat avant de marquer le fichier résolu.",
        },
        {
          emoji: "🌳",
          title: "Worktrees",
          body: "Créez, ouvrez, révélez ou supprimez des worktrees liés depuis la barre latérale ou le graphe.",
        },
        {
          emoji: "🌊",
          title: "git-flow",
          body: "Démarrez, publiez et terminez les branches feature, release et hotfix depuis l'interface.",
        },
        {
          emoji: "⚡",
          title: "Opérations distantes",
          body: "Fetch, pull et push avec progression en direct ; l'auto-fetch périodique (optionnel) garde le graphe à jour.",
        },
        {
          emoji: "🔎",
          title: "Commandes transparentes",
          body: "Les boutons affichent la commande git exacte qu'ils vont lancer, et une console en lecture seule retrace chaque commande exécutée.",
        },
        {
          emoji: "⌨️",
          title: "Au clavier",
          body: "Le graphe, les listes de fichiers, la barre latérale, les menus et les popovers se pilotent sans souris.",
        },
        {
          emoji: "🎛️",
          title: "Personnalisation",
          body: "Thèmes clair et sombre, interface en français ou en anglais, couleurs de préfixes de branches, coloration des diffs configurable.",
        },
        {
          emoji: "🔄",
          title: "Mises à jour automatiques",
          body: "Vérification au démarrage sur les GitHub Releases, téléchargement en arrière-plan, installation à la fermeture ou sur « Redémarrer maintenant ».",
        },
      ],
    },
    tour: {
      heading: "Captures d'écran",
      stops: [
        {
          title: "Le graphe de commits",
          body: "Un historique d'environ 25 000 commits dans une seule timeline : lignes de branches, courbes de merge, tags, stashs, divergence ahead/behind, et badges de type sur les sujets de commit. Sélectionner un commit ouvre son message complet, ses co-auteurs et ses fichiers modifiés.",
          shot: "graph",
          alt: "Le graphe de commits et le panneau de détail.",
        },
        {
          title: "Les diffs",
          body: "Vue unifiée ou côte à côte, un fichier ou le commit entier, avec coloration syntaxique. Les deux panneaux défilent ensemble ; les images s'affichent dans un visualiseur.",
          shot: "diff",
          alt: "Un diff côte à côte, coloré, d'un fichier TypeScript, avec le panneau de détail du commit à droite.",
        },
        {
          title: "Le staging",
          body: "Stagez fichiers, dossiers, hunks ou lignes seules depuis un diff en direct, puis commitez ou amendez. Le bouton de commit affiche la commande git exacte avant de la lancer.",
          shot: "worktree",
          alt: "Le panneau de staging : arborescences des fichiers stagés et non stagés, diff côte à côte avec actions par hunk, et zone de message de commit.",
        },
        {
          title: "Les conflits de merge",
          body: "Les deux versions dans des panneaux alignés. Prenez un côté entier, un bloc ou des lignes seules, dans l'ordre que vous voulez ; la sortie fusionnée est un éditeur normal, où choix et retouches à la main se combinent avant de marquer le fichier résolu.",
          shot: "conflict",
          alt: "La vue de résolution de conflits : les versions « ours » et « theirs » d'un fichier dans deux panneaux alignés et colorés, avec sélecteurs par côté et par ligne, au-dessus d'une sortie fusionnée éditable.",
        },
      ],
    },
    open: {
      heading: "Open source",
      items: [
        {
          title: "Licence MIT",
          body: "Développé en public sur GitHub — issues, pull requests et releases.",
        },
        {
          title: "Privé par défaut",
          body: "Les rapports de crash ne contiennent ni contenu de dépôt ni donnée personnelle, et se désactivent dans l'application. Un build depuis les sources n'envoie rien.",
        },
        {
          title: "Transparent",
          body: "Chaque bouton de mutation affiche la commande git qu'il va lancer ; une console en lecture seule retrace chaque commande exécutée.",
        },
      ],
      cta: "Lire le code source",
    },
    download: {
      heading: "Télécharger",
      body: "Téléchargez l'installeur depuis la dernière release GitHub et lancez-le. Amont se tient ensuite à jour tout seul : vérification au démarrage, téléchargement en arrière-plan, installation à la fermeture ou dès que vous cliquez « Redémarrer maintenant ».",
      cta: "Télécharger la dernière release",
      platform: "Windows uniquement pour l'instant — macOS et Linux ne sont pas encore packagés.",
      smartscreenTitle: "À propos de l'avertissement SmartScreen",
      smartscreen:
        "Les binaires publiés ne sont pas encore signés : Windows affiche un avertissement « éditeur inconnu » au lancement de l'installeur. C'est attendu. L'intégrité des mises à jour repose sur HTTPS vers GitHub et le sha512 de latest.yml.",
    },
    footer: {
      license: "MIT © Mathieu Guey",
    },
  },
}

export const REPO_URL = "https://github.com/ethylon/amont"
export const DOWNLOAD_URL = `${REPO_URL}/releases/latest`

export function localePath(locale: Locale): string {
  return locale === "en" ? "/" : "/fr/"
}
