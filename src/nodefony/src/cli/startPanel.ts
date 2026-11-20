/**
 * Le bloc « Pour commencer » qui FERME la sortie de `create app` — PURE.
 *
 * Une génération écrit une trentaine de lignes : installation, build,
 * migration, licences, skills, câblage MCP, état de l'application. Les trois
 * gestes qui comptent pour la personne devant son terminal — démarrer, se
 * connecter, brancher son agent — s'y perdaient : le mot de passe vivait en
 * commentaire au milieu d'une ligne, la porte MCP en dernière ligne d'outils,
 * et la démo n'était nommée nulle part une fois la question passée.
 *
 * Ce bloc est donc la DERNIÈRE chose écrite, numérotée, et chaque étape tient
 * en une commande et sa raison. Il n'a pas de bord droit : une destination ou
 * un mot de passe plus longs que prévu ne le déforment jamais.
 */
import type { packageManagerCommandLines } from "./packageManager";

/** Les lignes de commande dans la syntaxe du gestionnaire de l'application. */
export type StartPanelCommands = ReturnType<typeof packageManagerCommandLines>;

/** Où en est la porte MCP de l'application après la génération. */
export type StartPanelAgent =
  /** Aucun agent choisi, ou app non construite : le geste se NOMME. */
  | { readonly kind: "to-wire" }
  /** Porte câblée chez les agents choisis, jeton posé dans `.env`. */
  | { readonly kind: "wired" }
  /** Porte câblée, jeton NON posé (base injoignable, émission ratée). */
  | { readonly kind: "token-missing" };

/** Ce que le bloc affiche — tout est déjà décidé par l'appelant. */
export interface IStartPanelInput {
  /** Dossier de l'application, relatif au répertoire courant (`.` sur place). */
  readonly relDest: string;
  readonly commands: StartPanelCommands;
  /** `false` : l'installation reste à faire (`--no-install`, échec). */
  readonly installed: boolean;
  /** `false` : le build reste à faire. */
  readonly built: boolean;
  /** Base docker à lancer avant le premier démarrage, sinon `null`. */
  readonly infra: string | null;
  /** La migration initiale reste à écrire ET à appliquer. */
  readonly migrationPending: boolean;
  /** Le compte de développement (préset complet), sinon `null`. */
  readonly admin: { readonly user: string; readonly password: string } | null;
  /**
   * Les moteurs que `create front` sait poser, quand l'app n'a pas
   * d'interface web ; `null` sinon.
   */
  readonly addFrontend: readonly string[] | null;
  readonly agent: StartPanelAgent;
  /**
   * La démo : son adresse quand elle est installée, sinon la commande d'une
   * application JETABLE qui la porte — elle sert à apprendre, pas à rester.
   */
  readonly demo:
    | { readonly installed: true }
    | { readonly installed: false; readonly command: string };
}

/** Largeur du filet : tient dans un terminal de 80 colonnes. */
const RULE_WIDTH = 64;
/** Colonne où commence le contenu d'une étape. */
const LABEL_WIDTH = 15;
/** L'adresse annoncée : le port peut changer, le démarrage dit le vrai. */
const DEV_ORIGIN = "https://127.0.0.1:5152";

/**
 * Rend le bloc « Pour commencer ».
 *
 * @param input - l'état de l'application générée
 * @param bold - mise en relief du titre et des intitulés (identité par
 *   défaut : la sortie reste lisible sans couleur, et testable)
 * @returns le bloc, filets compris, terminé par un saut de ligne
 */
export function renderStartPanel(
  input: IStartPanelInput,
  bold: (text: string) => string = (text) => text,
): string {
  const { commands } = input;
  const nodefony = commands.exec("nodefony");
  const steps: { label: string; lines: string[] }[] = [];

  const start: string[] = [];
  // Créée sur place (`create app .`), l'application EST le dossier courant.
  if (input.relDest !== ".") start.push(`cd ${input.relDest}`);
  if (!input.installed) start.push(commands.install);
  if (!input.built) start.push(commands.run("build"));
  if (input.infra !== null) {
    start.push(
      `${commands.run("infra:up")}   # docker : ${input.infra} + Redis`,
    );
  }
  // Les DEUX gestes, dans l'ordre qui marche : écrire la migration ne crée
  // aucune table.
  if (input.migrationPending) {
    start.push(`${nodefony} orm:generate --name init`);
    start.push(`${nodefony} orm:migrate`);
  }
  start.push(commands.run("dev"));
  start.push(`→ ${DEV_ORIGIN} (port réel : voir le démarrage)`);
  steps.push({ label: "Démarrer", lines: start });

  if (input.admin !== null) {
    steps.push({
      label: "Se connecter",
      lines: [
        `${input.admin.user} / ${input.admin.password}   (développement seulement)`,
        "console d'administration : /nodefony",
        "défini dans nodefony/security/provisionUsers.ts",
      ],
    });
  }

  if (input.addFrontend !== null) {
    steps.push({
      label: "Une page web",
      lines: [
        `${nodefony} create front --frontend <moteur>`,
        `moteur : ${input.addFrontend.join(" · ")}`,
        "page, connexion, temps réel LIVRÉS — ne les écris pas",
      ],
    });
  }

  steps.push({
    label: "Ton agent IA",
    lines:
      input.agent.kind === "wired"
        ? [
            "porte MCP câblée, jeton posé dans .env (NF_MCP_TOKEN)",
            "app démarrée, agent relancé ; il lit AGENTS.md d'abord",
          ]
        : input.agent.kind === "token-missing"
          ? [
              `${nodefony} security:mcp:token --write`,
              "porte câblée, jeton à poser — la base doit répondre",
            ]
          : [
              `${nodefony} ai:mcp`,
              "porte MCP + jeton ; il lit AGENTS.md d'abord",
            ],
  });

  steps.push({
    label: "Apprendre",
    lines: input.demo.installed
      ? [`${DEV_ORIGIN}/demo`, "chaque démo montre le code qui la fait tourner"]
      : [input.demo.command, "une app jetable avec les démos commentées"],
  });

  const pad = " ".repeat(LABEL_WIDTH + 4);
  const title = " Pour commencer ";
  const out: string[] = [
    "",
    `──${bold(title)}${"─".repeat(RULE_WIDTH - title.length - 2)}`,
  ];
  steps.forEach((step, index) => {
    out.push("");
    step.lines.forEach((line, i) => {
      out.push(
        i === 0
          ? ` ${String(index + 1)}  ${bold(step.label.padEnd(LABEL_WIDTH))}${line}`
          : `${pad}${line}`,
      );
    });
  });
  out.push("", "─".repeat(RULE_WIDTH), "");
  return out.join("\n");
}
