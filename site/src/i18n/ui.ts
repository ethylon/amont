export type Locale = "en" | "fr"

export interface TourStop {
  title: string
  body: string
  shot: "worktree" | "diff" | "conflict"
  alt: string
}

export interface TrustPoint {
  title: string
  body: string
}

export interface Dict {
  meta: { title: string; description: string }
  nav: { graph: string; tour: string; download: string; theme: string }
  hero: {
    title: string
    lede: string
    ctaDownload: string
    ctaSource: string
    caption: string
    captionDemo: string
    demoTitle: string
    demoHint: string
    graphAlt: string
  }
  graph: {
    intro: string
    statValue: string
    statLabel: string
    statBody: string
    timeline: TrustPoint
    keyboard: TrustPoint
  }
  tour: { heading: string; stops: TourStop[] }
  trust: {
    heading: string
    intro: string
    points: TrustPoint[]
    consoleLabel: string
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
      title: "Amont — Git history you can actually read",
      description:
        "Amont is a free, open-source Git client for Windows built around one idea: a commit graph fast enough to be your workspace. Smooth at 100,000+ commits, keyboard-driven, and it shows every git command it runs.",
    },
    nav: { graph: "The graph", tour: "Tour", download: "Download", theme: "Toggle theme" },
    hero: {
      title: "Git history you can actually read.",
      lede: "Amont lays your repository out as one fast, readable commit graph: branches, merges, tags, stashes and ahead/behind status at a glance. Smooth at 100,000+ commits. Driven entirely from the keyboard if you want.",
      ctaDownload: "Download for Windows",
      ctaSource: "View the source",
      caption: "A real history: Amont browsing its own repository.",
      captionDemo: "Live demo: the real interface, in your browser, on a simulated repository.",
      demoTitle: "Interactive demo: the real Amont interface on a simulated repository",
      demoHint: "Click to explore",
      graphAlt:
        "Amont’s main window: the commit graph with branch lanes and ref chips, the branches sidebar, and the detail panel showing a commit’s message and file tree.",
    },
    graph: {
      intro:
        "Most Git clients treat history as a side panel. Amont is built the other way around: the graph is the workspace, so it has to stay fast and stay legible.",
      statValue: "100,000+",
      statLabel: "commits, no lag",
      statBody:
        "A purpose-built streaming engine keeps scrolling smooth on histories that make other clients give up. The screenshot above is a real repository of about 25,000 commits.",
      timeline: {
        title: "Everything on one timeline",
        body: "Branch lanes, merge curves, tags, stashes, ahead/behind counters and commit-type badges. You read state instead of reconstructing it.",
      },
      keyboard: {
        title: "Hands stay on the keyboard",
        body: "Graph, sidebar, file lists, menus, popovers: everything works without a mouse.",
      },
    },
    tour: {
      heading: "Everything happens in the graph.",
      stops: [
        {
          title: "Stage exactly what you mean",
          body: "Stage files, folders, hunks or single lines from a live diff, then commit or amend in place. The commit button shows the exact git command before you run it.",
          shot: "worktree",
          alt: "The staging panel: staged and unstaged file trees, a live side-by-side diff with per-hunk stage and discard actions, and the commit message box.",
        },
        {
          title: "Read any change",
          body: "Side-by-side or unified diffs with syntax highlighting, per file or for the whole commit. Search commits by message, author, hash, or through the contents of diffs.",
          shot: "diff",
          alt: "A side-by-side, syntax-highlighted diff of a TypeScript file, with the commit’s detail panel on the right.",
        },
        {
          title: "Merge without the fear",
          body: "Conflicts show both versions aligned. Take a whole side, one block or single lines, in any order, then edit the merged result by hand before marking it resolved.",
          shot: "conflict",
          alt: "The conflict resolution view: the ‘ours’ and ‘theirs’ versions of a file in two aligned, syntax-highlighted panes with per-side and per-line pickers, above an editable merged output.",
        },
      ],
    },
    trust: {
      heading: "It’s still git. You can watch.",
      intro:
        "GUIs lose your trust the first time they do something you didn’t ask for. Amont runs the git already installed on your machine, and proves it.",
      points: [
        {
          title: "The exact command, before you click",
          body: "Every mutation button shows the git command it will run. A read-only console logs every command executed.",
        },
        {
          title: "Your git, your repo",
          body: "No bundled binaries, no hidden state, no account.",
        },
        {
          title: "Free and open",
          body: "MIT-licensed, developed in the open on GitHub. Optional crash reports carry no repository contents and no personal data.",
        },
      ],
      consoleLabel: "Command log — read-only",
    },
    download: {
      heading: "Download Amont",
      body: "Grab the installer from the latest GitHub release. Amont keeps itself up to date from there: background download, install on quit or when you click “Restart now”.",
      cta: "Download for Windows",
      platform: "Windows only for now; macOS and Linux aren’t packaged yet.",
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
      title: "Amont — un historique Git enfin lisible",
      description:
        "Amont est un client Git libre et open source pour Windows, construit autour d’une idée : un graphe de commits assez rapide pour être votre espace de travail. Fluide à plus de 100 000 commits, pilotable au clavier, et il affiche chaque commande git exécutée.",
    },
    nav: { graph: "Le graphe", tour: "Visite", download: "Télécharger", theme: "Changer de thème" },
    hero: {
      title: "Un historique Git enfin lisible.",
      lede: "Amont déploie votre dépôt en un graphe de commits rapide et lisible : branches, merges, tags, stashs et divergence ahead/behind d’un coup d’œil. Fluide à plus de 100 000 commits. Pilotable entièrement au clavier si vous voulez.",
      ctaDownload: "Télécharger pour Windows",
      ctaSource: "Lire le code source",
      caption: "Un vrai historique : Amont sur son propre dépôt.",
      captionDemo: "Démo en direct : la vraie interface, dans votre navigateur, sur un dépôt simulé.",
      demoTitle: "Démo interactive : la vraie interface d'Amont sur un dépôt simulé",
      demoHint: "Cliquez pour explorer",
      graphAlt:
        "La fenêtre principale d’Amont : le graphe de commits avec ses lignes de branches et ses pastilles de refs, la barre latérale des branches, et le panneau de détail montrant le message et l’arborescence d’un commit.",
    },
    graph: {
      intro:
        "La plupart des clients Git traitent l’historique comme un panneau latéral. Amont est construit dans l’autre sens : le graphe est l’espace de travail, alors il doit rester rapide et rester lisible.",
      statValue: "100 000+",
      statLabel: "commits sans ralentir",
      statBody:
        "Un moteur de rendu en streaming conçu pour ça garde le défilement fluide sur des historiques qui font abandonner les autres clients. La capture ci-dessus est un vrai dépôt d’environ 25 000 commits.",
      timeline: {
        title: "Tout sur une seule timeline",
        body: "Lignes de branches, courbes de merge, tags, stashs, compteurs ahead/behind et badges de type de commit. L’état se lit, il ne se reconstitue pas.",
      },
      keyboard: {
        title: "Les mains sur le clavier",
        body: "Graphe, barre latérale, listes de fichiers, menus, popovers : tout fonctionne sans souris.",
      },
    },
    tour: {
      heading: "Tout se passe dans le graphe.",
      stops: [
        {
          title: "Stagez exactement ce que vous voulez dire",
          body: "Stagez fichiers, dossiers, hunks ou lignes seules depuis un diff en direct, puis commitez ou amendez sur place. Le bouton de commit affiche la commande git exacte avant de la lancer.",
          shot: "worktree",
          alt: "Le panneau de staging : arborescences des fichiers stagés et non stagés, diff côte à côte avec actions par hunk, et zone de message de commit.",
        },
        {
          title: "Lisez n’importe quel changement",
          body: "Diffs côte à côte ou unifiés avec coloration syntaxique, par fichier ou pour le commit entier. Recherchez les commits par message, auteur, hash, ou dans le contenu des diffs.",
          shot: "diff",
          alt: "Un diff côte à côte, coloré, d’un fichier TypeScript, avec le panneau de détail du commit à droite.",
        },
        {
          title: "Mergez sans la peur",
          body: "Les conflits montrent les deux versions alignées. Prenez un côté entier, un bloc ou des lignes seules, dans l’ordre voulu, puis retouchez le résultat à la main avant de le marquer résolu.",
          shot: "conflict",
          alt: "La vue de résolution de conflits : les versions « ours » et « theirs » d’un fichier dans deux panneaux alignés et colorés, avec sélecteurs par côté et par ligne, au-dessus d’une sortie fusionnée éditable.",
        },
      ],
    },
    trust: {
      heading: "C’est toujours git. Et ça se voit.",
      intro:
        "Une interface graphique perd votre confiance la première fois qu’elle fait quelque chose que vous n’avez pas demandé. Amont exécute le git déjà installé sur votre machine, et le prouve.",
      points: [
        {
          title: "La commande exacte, avant de cliquer",
          body: "Chaque bouton de mutation affiche la commande git qu’il va lancer. Une console en lecture seule retrace chaque commande exécutée.",
        },
        {
          title: "Votre git, votre dépôt",
          body: "Pas de binaire embarqué, pas d’état caché, pas de compte.",
        },
        {
          title: "Libre et ouvert",
          body: "Sous licence MIT, développé en public sur GitHub. Les rapports de crash optionnels ne contiennent ni contenu de dépôt ni donnée personnelle.",
        },
      ],
      consoleLabel: "Journal des commandes — lecture seule",
    },
    download: {
      heading: "Télécharger Amont",
      body: "Téléchargez l’installeur depuis la dernière release GitHub. Amont se tient ensuite à jour tout seul : téléchargement en arrière-plan, installation à la fermeture ou dès que vous cliquez « Redémarrer maintenant ».",
      cta: "Télécharger pour Windows",
      platform: "Windows uniquement pour l’instant ; macOS et Linux ne sont pas encore packagés.",
      smartscreenTitle: "À propos de l’avertissement SmartScreen",
      smartscreen:
        "Les binaires publiés ne sont pas encore signés : Windows affiche un avertissement « éditeur inconnu » au lancement de l’installeur. C’est attendu. L’intégrité des mises à jour repose sur HTTPS vers GitHub et le sha512 de latest.yml.",
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
