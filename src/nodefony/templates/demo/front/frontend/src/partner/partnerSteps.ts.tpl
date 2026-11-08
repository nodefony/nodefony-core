import type { ILessonDecorator, ILessonStep } from "../chat/lessonSteps";

/**
 * Les étapes de la page « API entre programmes » et le code qui fait chacune
 * — CITÉ des vrais fichiers du module (mêmes règles que le chat : régions
 * `// #region`, vérifiées par le test du module).
 *
 * Doc : `@nodefony/security/docs/obtenir-un-jeton.md`.
 */

const SECURITY = "nodefony/config/security.ts";
const API = "nodefony/controllers/PartnerController.ts";
const DESK = "nodefony/controllers/PartnerTokenController.ts";
const ISSUER = "nodefony/service/PartnerTokenService.ts";
const COMMAND = "nodefony/command/PartnerCallCommand.ts";
const PAGE = "frontend/src/partner/usePartnerLab.ts";

/** Les cinq étapes, dans l'ordre où un jeton vit. */
export const PARTNER_LESSON_STEPS = [
  {
    step: 1,
    title: "Le firewall",
    summary:
      "Le firewall de `@nodefony/security` découpe l'application en zones (`areas`). La zone `demo-partner` couvre `/demo/api/partner` : elle n'accepte qu'un jeton d'accès, vérifié AVANT le contrôleur — signature, expiration, audience.",
    status: "ready",
    excerpts: [
      {
        file: SECURITY,
        region: "partner-area",
        note: "`stateless` : aucune session n'est lue ni créée. `resource` est l'audience que le jeton doit porter ; `ephemeral` admet un appelant sans compte ici, avec les seuls `ephemeralRoles`.",
      },
    ],
  },
  {
    step: 2,
    title: "L'API du programme",
    summary:
      "Le contrôleur ne contient AUCUN contrôle d'accès : quand l'action s'exécute, le firewall a déjà prouvé qui appelle.",
    status: "ready",
    excerpts: [
      {
        file: API,
        region: "partner-class",
        note: "`@controller` place toute la classe sous le chemin de la zone ; `@Inject` fournit un service par son nom.",
      },
      {
        file: API,
        region: "partner-whoami",
        note: "`this.user` : l'identité établie par le jeton. L'émetteur (`iss`) dit QUI l'a prouvée — cette application, ou Keycloak.",
      },
    ],
  },
  {
    step: 3,
    title: "Émettre un jeton",
    summary:
      "Cette application signe elle-même un jeton pour un de ses comptes, valable cinq minutes, pour la seule API partenaire. La page et la commande passent par le même service.",
    status: "ready",
    excerpts: [
      {
        file: ISSUER,
        region: "partner-service",
        note: "`@injectable` : un service du conteneur, que la commande et le contrôleur obtiennent par son nom.",
      },
      {
        file: ISSUER,
        region: "partner-issue",
        note: "L'audience vient de la config VALIDÉE du firewall, jamais d'une URL recopiée : un jeton émis ici n'ouvre rien d'autre.",
      },
      {
        file: DESK,
        region: "partner-token-route",
        note: "Le guichet de la page : `@IsGranted` refuse le visiteur anonyme (403) avant l'action, et le compte vient de la session — jamais d'un champ envoyé.",
      },
    ],
  },
  {
    step: 4,
    title: "Présenter le jeton",
    summary:
      "Le programme met le jeton dans `Authorization: Bearer …` (RFC 6750). Un refus est un 401 accompagné de `WWW-Authenticate: Bearer`, qui dit au programme quel schéma présenter.",
    status: "ready",
    excerpts: [
      {
        file: PAGE,
        region: "partner-fetch-client",
        note: "L'appel de cette page : le cookie de session part aussi, et la zone l'ignore — sans jeton, 401, même connecté.",
      },
      {
        file: COMMAND,
        region: "partner-call",
        note: "Le même appel depuis la ligne de commande (`npx nodefony demo:partner:call`), avec un geste de réparation pour chaque refus.",
      },
    ],
  },
  {
    step: 5,
    title: "Un vrai partenaire : Keycloak",
    summary:
      "Un partenaire n'a pas les clés de l'application : il obtient son jeton chez un serveur d'identité, par le flux `client_credentials` (RFC 6749 §4.4), sans utilisateur ni navigateur.",
    status: "ready",
    excerpts: [
      {
        file: COMMAND,
        region: "partner-keycloak",
        note: "Le point de jeton est DÉCOUVERT depuis l'émetteur (RFC 8414) ; le secret du client vient de la config du module, lue dans `NF_KEYCLOAK_MACHINE_SECRET`.",
      },
    ],
  },
] as const satisfies readonly ILessonStep[];

/**
 * TOUS les décorateurs des fichiers serveur de la démo partenaire — le test
 * du module exige que la liste soit complète.
 */
export const PARTNER_DECORATORS = [
  {
    name: "controller",
    file: API,
    from: "@nodefony/framework",
    role: "Place toute la classe sous un chemin — ici celui que couvre la zone `demo-partner` du firewall.",
    step: 2,
    region: "partner-class",
  },
  {
    name: "Inject",
    file: API,
    from: "nodefony",
    role: "Fournit un service par son nom au constructeur.",
    step: 2,
    region: "partner-class",
  },
  {
    name: "route",
    file: API,
    from: "@nodefony/framework",
    role: "Une route : son nom, son chemin et sa méthode HTTP.",
    step: 2,
    region: "partner-whoami",
  },
  {
    name: "injectable",
    file: ISSUER,
    from: "nodefony",
    role: "Déclare un service du conteneur : un exemplaire, partagé par tous ceux qui le demandent.",
    step: 3,
    region: "partner-service",
  },
  {
    name: "IsGranted",
    file: DESK,
    from: "@nodefony/framework",
    role: "Exige des rôles avant d'entrer dans l'action : 401 sans identité, 403 quand l'identité ne les porte pas — l'anonyme d'une zone `anonymous` compris.",
    step: 3,
    region: "partner-token-route",
  },
] as const satisfies readonly ILessonDecorator[];

/** Les fichiers dont la liste des décorateurs doit être complète. */
export const PARTNER_DECORATED_FILES = [API, DESK, ISSUER] as const;
