/**
 * Décor de la tâche « ajouter un champ à l'utilisateur d'une application en
 * service » — une application dont la table des comptes existe au schéma
 * PRÉCÉDENT, avec son historique, ses comptes, et un compte venu d'un
 * fournisseur externe.
 *
 * **Pourquoi ce décor est le seul qui mesure quelque chose.** Trois moitiés,
 * et chacune ferme une porte de sortie :
 *
 * 1. **le mode de production du schéma** (`ddl: "none"`). En développement, une
 *    application rattrape seule une colonne ajoutée qui accepte le vide :
 *    l'agent n'aurait rien à faire, et la tâche serait verte sans qu'aucune
 *    migration n'existe. Le décor emprunte donc {@link poserModeNone} au décor
 *    frère — une seule implémentation, jamais deux idées de ce que « mode de
 *    production » veut dire ;
 * 2. **un compte local semé une seule fois** ({@link COMPTE_ANCIEN}), créé par
 *    la commande du framework dans la prémisse et JAMAIS re-semé au démarrage.
 *    C'est la sonde anti-destruction : un agent qui efface et recrée la base
 *    obtient le bon schéma — et ce compte-là ne revient pas ;
 * 3. **un compte venu d'un fournisseur externe**, semé au démarrage par le code
 *    de l'application. Celui-ci est idempotent EXPRÈS : `provisionOAuthUser`
 *    commence par chercher le compte par son lien externe. Si ce chemin de
 *    recherche casse — c'est le risque nommé au ticket #143, une table renommée
 *    ou une casse changée fait échouer la recherche SANS erreur — le démarrage
 *    suivant crée un DOUBLON. Le juge n'a donc pas à croire l'agent sur parole :
 *    il compte.
 *
 * Le script échoue FORT si une ancre manque : mieux vaut une tâche non jouée
 * qu'une tâche jugée sur un décor à moitié posé — l'agent porterait le rouge
 * d'un trou qu'il n'a pas laissé.
 *
 * Éprouvable seul :
 *   node prepare-utilisateur-en-service.mjs --selftest
 *
 * @module
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { estApplicationTemoin, poserModeNone } from "./prepare-base-migree.mjs";

/**
 * Le champ que l'énoncé demande d'ajouter.
 *
 * Nommé ici plutôt que dans l'énoncé seul : le juge le cherche dans le schéma
 * d'une base vierge migrée, et deux écritures du même mot divergeraient au
 * premier renommage — le juge chercherait alors une colonne que l'énoncé ne
 * demande plus, et rendrait « absente » sur un travail juste.
 */
export const CHAMP_DEMANDE = "department";

/** Le fournisseur externe du compte semé — distinctif, jamais écrit par hasard. */
export const PROVIDER_PARTENAIRE = "bench-partenaire";

/** Son identifiant stable chez ce fournisseur. */
export const ID_PARTENAIRE = "ext-4711";

/**
 * L'identifiant local du compte externe.
 *
 * `provisionOAuthUser` prend l'email du fournisseur comme identifiant quand il
 * y en a un : cette valeur n'est donc pas un choix libre, c'est ce que le
 * produit DÉRIVE. La recopier ailleurs la ferait diverger le jour où le
 * produit change de règle.
 */
export const IDENTIFIANT_PARTENAIRE = "partenaire@bench.local";

/**
 * Le compte local semé AVANT le travail, et jamais re-semé.
 *
 * C'est la seule sonde qui distingue « a fait migrer la base » de « a effacé
 * et recommencé » : l'administrateur, lui, renaît à chaque démarrage.
 *
 * Sans espace ni caractère spécial : la ligne du gate les découpe en mots.
 */
export const COMPTE_ANCIEN = {
  username: "bench-compte-ancien",
  password: "AncienPassw0rd42x",
};

/**
 * L'ancre du semis : le dernier geste de provisionnement du gabarit.
 *
 * Elle apparaît DEUX fois — une par branche de dépôt (SQL, et le repli en
 * mémoire) — et les deux sont traitées : le décor doit valoir quelle que soit
 * la branche prise, sinon il se poserait à moitié selon une condition qu'il ne
 * contrôle pas.
 */
const ANCRE_SEED = "await seedAdmin(users, module);";

/** Ce que le décor ajoute au corps de `provisionUsers`. */
const APPEL_SEMIS = "await seedPartenaire(users, module);";

/**
 * La fonction de semis, ajoutée en fin de fichier.
 *
 * Écrite comme une application réelle l'écrirait — par la porte publique du
 * service, jamais par un accès direct à la base : ce que le décor pose doit
 * être du code que l'utilisateur pourrait avoir écrit, sinon on mesure un
 * agent placé devant une situation qui n'arrive à personne.
 */
const FONCTION_SEMIS = `
/**
 * Décor du banc : un compte venu d'un fournisseur externe, semé au démarrage.
 *
 * Idempotent par construction — \`provisionOAuthUser\` cherche d'abord le compte
 * par son lien externe et rend celui qui existe. Un second compte apparaîtrait
 * donc seulement si cette recherche cessait de trouver.
 *
 * @param users - service utilisateur branché sur son dépôt.
 * @param module - module applicatif (logs).
 */
async function seedPartenaire(users: UserService, module: Module): Promise<void> {
  await users.provisionOAuthUser(
    {
      provider: "${PROVIDER_PARTENAIRE}",
      providerId: "${ID_PARTENAIRE}",
      email: "${IDENTIFIANT_PARTENAIRE}",
      emailVerified: true,
      name: "Compte partenaire",
      raw: {},
    },
    { allowSignup: true, defaultRoles: ["ROLE_USER"] },
  );
  module.log(
    \`Compte externe \${"${PROVIDER_PARTENAIRE}"} présent (semis idempotent).\`,
    "INFO",
    LOG_CTX,
  );
}
`;

/**
 * `--ancien-args` : rend les arguments de création du compte semé.
 *
 * Le gate doit le créer AVANT de booter, avec la commande du framework. S'il
 * recopiait identifiant et mot de passe dans sa ligne de commande, la valeur
 * vivrait à deux endroits et divergerait au premier changement — le juge
 * échouerait alors à trouver un compte pourtant créé, et accuserait l'agent
 * d'une destruction qui n'a pas eu lieu. Une seule source : celle-ci.
 *
 * @returns {void} sort du processus si le drapeau est présent.
 */
export const repondreArgsAncien = () => {
  if (!process.argv.includes("--ancien-args")) return;
  console.log(`${COMPTE_ANCIEN.username} --password ${COMPTE_ANCIEN.password}`);
  process.exit(0);
};

/**
 * Ajoute le semis du compte externe au provisionnement de l'application.
 *
 * @param {string} source - contenu de `nodefony/security/provisionUsers.ts`.
 * @returns {string} le fichier modifié.
 * @throws Si l'ancre est absente — le gabarit a changé de forme, décor non posé.
 */
export function poserSemisPartenaire(source) {
  if (source.includes("seedPartenaire")) {
    return source;
  }
  if (!source.includes(ANCRE_SEED)) {
    throw new Error(
      "ancre introuvable dans nodefony/security/provisionUsers.ts : le geste " +
        `« ${ANCRE_SEED} » n'y figure plus — le gabarit a changé de forme, ` +
        "décor NON posé (mieux vaut une tâche non jouée qu'un rouge imputé à tort)",
    );
  }
  return (
    source.split(ANCRE_SEED).join(`${ANCRE_SEED}\n  ${APPEL_SEMIS}`) +
    FONCTION_SEMIS
  );
}

/**
 * Applique le décor sur une application déjà générée.
 *
 * @param {string} racine - racine de l'application témoin.
 * @returns {void}
 */
export function poserDecor(racine) {
  // 🔴 JAMAIS le dépôt du framework — même garde, même motif que le décor
  // frère : ce script réécrit un manifeste et du code de provisionnement.
  if (!estApplicationTemoin(racine)) {
    throw new Error(
      `refus de poser le décor dans « ${racine} » : ce n'est pas une ` +
        "application témoin de banc mais le dépôt du framework (ou une racine " +
        "qui lui ressemble). Passer la racine de l'application générée.",
    );
  }
  const manifeste = path.join(racine, "nodefony.config.ts");
  const avantConfig = readFileSync(manifeste, "utf8");
  const apresConfig = poserModeNone(avantConfig);
  if (apresConfig !== avantConfig) {
    writeFileSync(manifeste, apresConfig);
  }

  const provision = path.join(
    racine,
    "nodefony",
    "security",
    "provisionUsers.ts",
  );
  const avantSemis = readFileSync(provision, "utf8");
  const apresSemis = poserSemisPartenaire(avantSemis);
  if (apresSemis !== avantSemis) {
    writeFileSync(provision, apresSemis);
  }
}

/**
 * Auto-contrôle : la pose, l'idempotence, le refus, et les DEUX branches.
 *
 * @returns {void}
 */
function selftest() {
  const gabarit =
    'import type { Module } from "nodefony";\n' +
    'const LOG_CTX = "USERS";\n' +
    "export async function provisionUsers(module: Module): Promise<void> {\n" +
    "  if (!orm) {\n" +
    "    const users = new UserService(new InMemoryUserRepository([]), encoder);\n" +
    `    ${ANCRE_SEED}\n` +
    "    return;\n" +
    "  }\n" +
    "  const users = new UserService(DrizzleUserRepository.from(orm), encoder);\n" +
    `  ${ANCRE_SEED}\n` +
    "}\n";

  const pose = poserSemisPartenaire(gabarit);
  // Les DEUX branches reçoivent le semis : le décor ne doit pas dépendre du
  // dépôt effectivement retenu au démarrage.
  const appels = pose.split(APPEL_SEMIS).length - 1;
  if (appels !== 2) {
    throw new Error(
      `les deux branches de provisionnement doivent recevoir le semis (${appels} trouvé(s))`,
    );
  }
  if (!pose.includes("async function seedPartenaire")) {
    throw new Error("la fonction de semis n'a pas été ajoutée");
  }
  if (!pose.includes(PROVIDER_PARTENAIRE) || !pose.includes(ID_PARTENAIRE)) {
    throw new Error("le semis ne porte pas le fournisseur mesuré");
  }
  if (poserSemisPartenaire(pose) !== pose) {
    throw new Error("poser deux fois doit être sans effet (idempotence)");
  }

  let refuse = false;
  try {
    poserSemisPartenaire("export async function provisionUsers() {}\n");
  } catch {
    refuse = true;
  }
  if (!refuse) {
    throw new Error("un gabarit SANS l'ancre doit faire échouer le décor");
  }

  // La garde de périmètre est celle du décor frère — on vérifie qu'elle est
  // bien CELLE-LÀ, et non une seconde idée du même refus.
  const depot = () =>
    JSON.stringify({ name: "nodefony-core", workspaces: ["src/*"] });
  if (estApplicationTemoin("/peu-importe", depot)) {
    throw new Error("le dépôt du framework doit être REFUSÉ comme cible");
  }

  // Le mode de production vient bien du décor frère, appliqué ici.
  const config =
    'export default defineConfig({\n  modules: [use("@nodefony/drizzle", {})],\n});\n';
  if (!/ddl:\s*"none"/u.test(poserModeNone(config))) {
    throw new Error("le mode de production du schéma n'est pas posé");
  }

  console.log(
    "✓ prepare-utilisateur-en-service : semis (2 branches), idempotence, refus, périmètre, mode none",
  );
}

repondreArgsAncien();

if (process.argv.includes("--selftest")) {
  selftest();
} else if (process.argv[1]?.endsWith("prepare-utilisateur-en-service.mjs")) {
  poserDecor(process.cwd());
}
