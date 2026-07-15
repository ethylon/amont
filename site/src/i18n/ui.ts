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
  footer: { license: string; tagline: string }
}

export const dict: Record<Locale, Dict> = {
  en: {
    meta: {
      title: "Amont — Git history you can actually read",
      description:
        "A fast, keyboard-first Git client for Windows that renders any repository as a metro map: virtualized graph, syntax-highlighted diffs, line-level staging, click-to-resolve conflicts.",
    },
    nav: { features: "Features", tour: "Tour", download: "Download", theme: "Toggle theme" },
    hero: {
      badge: "Windows · Open source · MIT",
      title: "Git history you can actually read.",
      lede: "Amont renders any repository — including six-figure-commit monsters — as a metro map: branches as lanes, merges as curves, refs as chips. Scroll it, search it, stage from it, resolve conflicts in it. Fast, keyboard-first, built for Windows.",
      ctaDownload: "Download for Windows",
      ctaGithub: "View on GitHub",
      caption: "Every screenshot on this page is Amont browsing its own repository. Turtles all the way down.",
      graphAlt:
        "Amont's main window: the commit graph with branch lanes and ref chips, the branches sidebar, and the detail panel showing a commit's message and file tree.",
    },
    features: {
      heading: "Everything you'd expect. A few things you wouldn't.",
      sub: "The whole point of Amont is that nothing about your history should be opaque — not its shape, not its diffs, not the commands run on it.",
      items: [
        {
          emoji: "🚇",
          title: "A graph built for scale",
          body: "Layout and DOM are both virtualized: only the visible window of commits is laid out and mounted, pages are fetched as you scroll and evicted when you leave. 100,000 commits scroll like 100.",
        },
        {
          emoji: "🎨",
          title: "Diffs that read like code",
          body: "Syntax-highlighted by Shiki — the same grammars as VS Code. Unified or side-by-side, per file or whole commit. Images get a real viewer instead of “Binary files differ”.",
        },
        {
          emoji: "🧬",
          title: "Stage exactly what you mean",
          body: "Stage, unstage or discard a file, a folder, a hunk, or a single line, straight from a live interactive diff. Amend included, live commit progress included.",
        },
        {
          emoji: "🧩",
          title: "Conflicts, resolved by clicking",
          body: "Aligned A/B panes: take a whole side, one chunk, or one line at a time — in the order you click. Picks and hand edits coexist in an editable, highlighted output.",
        },
        {
          emoji: "🔍",
          title: "Full-text commit search",
          body: "Message, author, hash prefix, and (optionally) diff content via git's pickaxe. Long-distance jumps land instantly, virtualization included.",
        },
        {
          emoji: "🌊",
          title: "git-flow, first-class",
          body: "Feature, release and hotfix branches get a context banner, a tinted one-click finish, start/publish from their own menu, and a start-branch picker.",
        },
        {
          emoji: "🌳",
          title: "Linked worktrees",
          body: "A sidebar section, graph chips and context menus make git worktree a one-click affair: create, open as a tab, reveal, or remove.",
        },
        {
          emoji: "⚡",
          title: "Live operations",
          body: "Fetch, pull and push stream their progress into a unified status feed; background auto-fetch (with --prune) keeps the graph fresh on a timer you control.",
        },
        {
          emoji: "🔎",
          title: "Nothing up its sleeve",
          body: "Mutation buttons preview the exact git command they will run, and a read-only console traces every command the app executes.",
        },
        {
          emoji: "⌨️",
          title: "Keyboard-first",
          body: "The graph, file lists, sidebar, menus and popovers are all fully operable without a mouse.",
        },
        {
          emoji: "🔒",
          title: "Sandboxed by design",
          body: "The UI runs with the Chromium sandbox on and a strict CSP; only the main process touches git, your disk, or the network.",
        },
        {
          emoji: "🔄",
          title: "Updates itself",
          body: "Silent startup check against GitHub Releases, background download, installs on quit or on “Restart now”.",
        },
      ],
    },
    tour: {
      heading: "The tour",
      stops: [
        {
          title: "Built for big histories",
          body: "This is a ~25,000-commit timeline — Amont scrolls it without loading it. Branch lanes, merge curves, tags, stashes and ahead/behind divergence fold into one timeline, and commit subjects carry type badges so the shape of the work reads at a glance. Selecting a commit opens its full message, co-authors and changed files.",
          shot: "graph",
          alt: "The commit graph and detail panel.",
        },
        {
          title: "Diffs that read like code",
          body: "Unified or side-by-side, one file or the whole commit — the two panes scroll together, and Shiki highlights everything with the same grammars VS Code uses. Binary images render in a proper viewer.",
          shot: "diff",
          alt: "A side-by-side, syntax-highlighted diff of a TypeScript file, with the commit's detail panel on the right.",
        },
        {
          title: "Stage exactly what you mean",
          body: "The staging panel stages files, folders, hunks or single lines from a live split diff. Review everything, then commit or amend — with the exact git command shown on the button before you run it.",
          shot: "worktree",
          alt: "The staging panel: staged and unstaged file trees, a live side-by-side diff with per-hunk stage/discard actions, and the commit message box.",
        },
        {
          title: "Merge conflicts, resolved on your terms",
          body: "Both versions laid out in aligned, syntax-highlighted panes. A checkbox per pane takes a whole side, per-chunk checkboxes take one side of one conflict, per-line +/− buttons take single lines — landing in the merged output in the order you click. The output is a normal editor: picks and hand edits coexist.",
          shot: "conflict",
          alt: "The conflict resolution view: the 'ours' and 'theirs' versions of a file in two aligned, syntax-highlighted panes with per-side and per-line pickers, above an editable merged output.",
        },
      ],
    },
    open: {
      heading: "Honest software",
      items: [
        {
          title: "Open source, MIT",
          body: "Developed in the open on GitHub — issues, pull requests and the release pipeline included.",
        },
        {
          title: "Private by default",
          body: "Crash reports carry no repository contents and no PII, and are opt-out at runtime. A build from source sends nothing at all.",
        },
        {
          title: "Transparent",
          body: "Every mutation button previews the exact git command it will run, and a read-only console traces everything.",
        },
      ],
      cta: "Read the source",
    },
    download: {
      heading: "Get Amont",
      body: "Download the installer from the latest GitHub release and run it. From then on, Amont keeps itself up to date: it checks at startup, downloads in the background, and installs on quit — or when you click “Restart now”.",
      cta: "Download the latest release",
      platform: "Windows only for 1.0 — macOS and Linux aren't packaged yet.",
      smartscreenTitle: "About the SmartScreen warning",
      smartscreen:
        "Released binaries are not code-signed yet, so Windows shows an “unknown publisher” warning when you run the installer — expected, not a sign of tampering. Update integrity relies on HTTPS to GitHub plus the sha512 in latest.yml.",
    },
    footer: {
      license: "MIT © Mathieu Guey",
      tagline: "Amont — upstream, where the history comes from.",
    },
  },
  fr: {
    meta: {
      title: "Amont — Un historique Git enfin lisible",
      description:
        "Un client Git rapide et pensé pour le clavier, sous Windows, qui affiche n'importe quel dépôt comme un plan de métro : graphe virtualisé, diffs colorés, staging à la ligne, conflits résolus au clic.",
    },
    nav: { features: "Fonctionnalités", tour: "Visite guidée", download: "Télécharger", theme: "Changer de thème" },
    hero: {
      badge: "Windows · Open source · MIT",
      title: "Un historique Git enfin lisible.",
      lede: "Amont affiche n'importe quel dépôt — y compris les monstres à six chiffres de commits — comme un plan de métro : les branches en lignes, les merges en courbes, les refs en pastilles. Faites-le défiler, cherchez dedans, stagez depuis le graphe, résolvez-y vos conflits. Rapide, pensé pour le clavier, conçu pour Windows.",
      ctaDownload: "Télécharger pour Windows",
      ctaGithub: "Voir sur GitHub",
      caption:
        "Chaque capture d'écran de cette page, c'est Amont en train de parcourir son propre dépôt. Des tortues jusqu'en bas.",
      graphAlt:
        "La fenêtre principale d'Amont : le graphe de commits avec ses lignes de branches et ses pastilles de refs, la barre latérale des branches, et le panneau de détail montrant le message et l'arborescence d'un commit.",
    },
    features: {
      heading: "Tout ce que vous attendez. Et quelques surprises.",
      sub: "Le principe d'Amont : rien de votre historique ne doit rester opaque — ni sa forme, ni ses diffs, ni les commandes qu'on lui applique.",
      items: [
        {
          emoji: "🚇",
          title: "Un graphe taillé pour l'échelle",
          body: "Le layout et le DOM sont tous deux virtualisés : seule la fenêtre visible de commits est calculée et montée, les pages se chargent au défilement et s'évincent derrière vous. 100 000 commits défilent comme 100.",
        },
        {
          emoji: "🎨",
          title: "Des diffs qui se lisent comme du code",
          body: "Coloration syntaxique par Shiki — les mêmes grammaires que VS Code. Vue unifiée ou côte à côte, par fichier ou par commit entier. Les images ont droit à un vrai visualiseur plutôt qu'à « Binary files differ ».",
        },
        {
          emoji: "🧬",
          title: "Stagez exactement ce que vous voulez",
          body: "Stagez, retirez ou annulez un fichier, un dossier, un hunk ou une seule ligne, directement depuis un diff interactif. Amend compris, progression du commit en direct comprise.",
        },
        {
          emoji: "🧩",
          title: "Des conflits qui se résolvent au clic",
          body: "Deux panneaux A/B alignés : prenez un côté entier, un bloc, ou une ligne à la fois — dans l'ordre où vous cliquez. Vos choix et vos éditions à la main coexistent dans une sortie éditable et colorée.",
        },
        {
          emoji: "🔍",
          title: "Recherche plein texte des commits",
          body: "Message, auteur, préfixe de hash, et même le contenu des diffs via le pickaxe de git. Les sauts lointains atterrissent instantanément, virtualisation comprise.",
        },
        {
          emoji: "🌊",
          title: "git-flow, citoyen de première classe",
          body: "Les branches feature, release et hotfix ont leur bannière de contexte, un finish teinté en un clic, start/publish dans leur propre menu, et un sélecteur de branche de départ.",
        },
        {
          emoji: "🌳",
          title: "Worktrees liés",
          body: "Une section dans la barre latérale, des pastilles dans le graphe et des menus contextuels : git worktree en un clic — créer, ouvrir dans un onglet, révéler, supprimer.",
        },
        {
          emoji: "⚡",
          title: "Opérations en direct",
          body: "Fetch, pull et push diffusent leur progression dans un fil d'état unifié ; l'auto-fetch en arrière-plan (avec --prune) garde le graphe à jour, à la fréquence que vous choisissez.",
        },
        {
          emoji: "🔎",
          title: "Rien dans les manches",
          body: "Les boutons de mutation prévisualisent la commande git exacte qu'ils vont lancer, et une console en lecture seule retrace chaque commande exécutée par l'application.",
        },
        {
          emoji: "⌨️",
          title: "Le clavier d'abord",
          body: "Le graphe, les listes de fichiers, la barre latérale, les menus et les popovers se pilotent entièrement sans souris.",
        },
        {
          emoji: "🔒",
          title: "Sandboxé par conception",
          body: "L'interface tourne avec le sandbox Chromium activé et une CSP stricte ; seul le process principal touche à git, à votre disque ou au réseau.",
        },
        {
          emoji: "🔄",
          title: "Se met à jour tout seul",
          body: "Vérification silencieuse au démarrage sur les GitHub Releases, téléchargement en arrière-plan, installation à la fermeture ou sur « Redémarrer maintenant ».",
        },
      ],
    },
    tour: {
      heading: "La visite guidée",
      stops: [
        {
          title: "Taillé pour les grands historiques",
          body: "Voici une timeline d'environ 25 000 commits — Amont la fait défiler sans la charger. Lignes de branches, courbes de merge, tags, stashs et divergence ahead/behind se replient dans une seule timeline, et les sujets de commit portent des badges de type : la forme du travail se lit d'un coup d'œil. Sélectionner un commit ouvre son message complet, ses co-auteurs et ses fichiers modifiés.",
          shot: "graph",
          alt: "Le graphe de commits et le panneau de détail.",
        },
        {
          title: "Des diffs qui se lisent comme du code",
          body: "Vue unifiée ou côte à côte, un fichier ou le commit entier — les deux panneaux défilent ensemble, et Shiki colore tout avec les grammaires de VS Code. Les images binaires s'affichent dans un vrai visualiseur.",
          shot: "diff",
          alt: "Un diff côte à côte, coloré, d'un fichier TypeScript, avec le panneau de détail du commit à droite.",
        },
        {
          title: "Stagez exactement ce que vous voulez",
          body: "Le panneau de staging stage fichiers, dossiers, hunks ou lignes seules depuis un diff scindé et vivant. Relisez tout, puis commitez ou amendez — la commande git exacte s'affiche sur le bouton avant que vous ne la lanciez.",
          shot: "worktree",
          alt: "Le panneau de staging : arborescences des fichiers stagés et non stagés, diff côte à côte avec actions par hunk, et zone de message de commit.",
        },
        {
          title: "Les conflits, résolus à vos conditions",
          body: "Les deux versions posées dans des panneaux alignés et colorés. Une case par panneau prend un côté entier, une case par bloc prend un côté d'un conflit, les boutons +/− par ligne prennent des lignes seules — le tout atterrit dans la sortie fusionnée dans l'ordre où vous cliquez. La sortie est un éditeur normal : choix et retouches à la main coexistent.",
          shot: "conflict",
          alt: "La vue de résolution de conflits : les versions « ours » et « theirs » d'un fichier dans deux panneaux alignés et colorés, avec sélecteurs par côté et par ligne, au-dessus d'une sortie fusionnée éditable.",
        },
      ],
    },
    open: {
      heading: "Un logiciel honnête",
      items: [
        {
          title: "Open source, MIT",
          body: "Développé en public sur GitHub — issues, pull requests et pipeline de release compris.",
        },
        {
          title: "Privé par défaut",
          body: "Les rapports de crash ne contiennent ni contenu de dépôt ni donnée personnelle, et se désactivent d'un clic. Un build depuis les sources n'envoie rien du tout.",
        },
        {
          title: "Transparent",
          body: "Chaque bouton de mutation prévisualise la commande git exacte qu'il va lancer, et une console en lecture seule retrace tout.",
        },
      ],
      cta: "Lire le code source",
    },
    download: {
      heading: "Installer Amont",
      body: "Téléchargez l'installeur depuis la dernière release GitHub et lancez-le. Ensuite, Amont se tient à jour tout seul : vérification au démarrage, téléchargement en arrière-plan, installation à la fermeture — ou dès que vous cliquez « Redémarrer maintenant ».",
      cta: "Télécharger la dernière release",
      platform: "Windows uniquement pour la 1.0 — macOS et Linux ne sont pas encore packagés.",
      smartscreenTitle: "À propos de l'avertissement SmartScreen",
      smartscreen:
        "Les binaires publiés ne sont pas encore signés : Windows affiche un avertissement « éditeur inconnu » au lancement de l'installeur — c'est attendu, pas un signe de compromission. L'intégrité des mises à jour repose sur HTTPS vers GitHub et le sha512 de latest.yml.",
    },
    footer: {
      license: "MIT © Mathieu Guey",
      tagline: "Amont — là d'où vient l'historique.",
    },
  },
}

export const REPO_URL = "https://github.com/ethylon/amont"
export const DOWNLOAD_URL = `${REPO_URL}/releases/latest`

export function localePath(locale: Locale): string {
  return locale === "en" ? "/" : "/fr/"
}
