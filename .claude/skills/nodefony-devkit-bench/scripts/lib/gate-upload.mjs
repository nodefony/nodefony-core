/**
 * Juge de la tâche « recevoir un fichier » — et il NOMME sa cause.
 *
 * Ce que ce juge refuse de faire : lire le code de l'agent. Il envoie de vrais
 * corps multipart et REGARDE où les octets atterrissent — c'est la seule
 * question qui compte, et la seule à laquelle une relecture de diff ne répond
 * pas.
 *
 * Quatre faits, et le quatrième est celui qui justifie la tâche :
 *
 * 1. **la route existe** et accepte un envoi multipart ;
 * 2. **le fichier est RANGÉ** là où l'énoncé le demande — pas seulement reçu ;
 * 3. **la réponse dit ce qu'elle a fait** (nom rangé, taille) : sans elle, une
 *    application qui avale les fichiers en silence passerait pour correcte ;
 * 4. 🔴 **le nom envoyé par le client ne décide pas d'où le fichier atterrit.**
 *    `originalFilename` est une donnée d'ATTAQUANT : `path.resolve` honore les
 *    `..`, et un client Windows envoie `..\\..\\x` que `path.basename` POSIX ne
 *    découpe pas. Le framework porte déjà la garde — `UploadedFile.move()` ne
 *    retient que le dernier segment (`#safeTargetName`) —, donc un agent qui
 *    emploie la façade est protégé SANS le savoir, et un agent qui écrit
 *    `fs.writeFile(path.join(dossier, file.filename))` ouvre une traversée de
 *    chemin. C'est exactement ce que ce banc existe pour mesurer : la façade
 *    n'est pas une préférence de style, elle porte une garde.
 *
 * | Sortie | Cause                 | Ce que ça dit                                          |
 * | -----: | --------------------- | ------------------------------------------------------ |
 * |    `0` | conforme              | le fichier est rangé, et le nom du client ne décide rien |
 * |    `1` | route-absente         | la route de l'énoncé n'est pas montée                  |
 * |    `2` | depot-refuse          | un envoi légitime est refusé                            |
 * |    `3` | fichier-introuvable   | la route répond, et rien n'est rangé                    |
 * |    `4` | traversee-de-chemin   | un nom hostile a fait écrire HORS du dossier           |
 * |    `5` | port-deja-tenu        | un serveur ÉTRANGER répondrait à sa place — DÉCOR      |
 * |    `6` | aucune-reponse        | l'application ne répond pas — DÉCOR                    |
 * |    `7` | identite-indisponible | pas de session d'administration — DÉCOR                |
 * |    `8` | reponse-muette        | 2xx sans dire ce qui a été rangé                       |
 *
 * Les causes `5`, `6` et `7` n'accusent PAS l'agent.
 *
 * @module
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { CookieJar, request, ensurePortFree, exit } from "./http-probe.mjs";
import { ADMIN, ouvrirSession } from "./identites.mjs";

/** La route que l'énoncé nomme — jamais devinée. */
export const ROUTE_DEPOT = "/api/depot";

/** Le dossier de dépôt que l'énoncé nomme, relatif à l'application. */
export const DOSSIER_DEPOT = path.join("var", "depots");

/**
 * Le nom HOSTILE, et les deux grammaires de séparateur.
 *
 * Un client Windows envoie des antislashs, que `path.basename` POSIX ne découpe
 * pas — c'est le cas qui passe entre les mailles d'une garde écrite pour un
 * seul système. Les deux sont envoyés.
 */
export const NOMS_HOSTILES = [
  "../../evade-nodefony-bench.txt",
  "..\\..\\evade-windows-bench.txt",
];

/** Les causes, telles que la table ci-dessus les fixe. */
export const CAUSES = {
  conforme: 0,
  "route-absente": 1,
  "depot-refuse": 2,
  "fichier-introuvable": 3,
  "traversee-de-chemin": 4,
  "port-deja-tenu": 5,
  "aucune-reponse": 6,
  "identite-indisponible": 7,
  "reponse-muette": 8,
};

/**
 * Le verdict, sur des faits déjà collectés.
 *
 * Séparé de la collecte pour être éprouvable sans application. L'ORDRE compte :
 * la traversée de chemin passe avant tout ce qui relève du confort, parce
 * qu'une application qui range bien les fichiers honnêtes ET laisse un client
 * écrire ailleurs est plus dangereuse qu'une application qui ne marche pas.
 *
 * @param {{statutDepot: number|string, rangeSousDepot: boolean, reponseNomme: boolean,
 *   evasions: string[]}} faits
 * @returns {{cause: string, code: number, detail: string}}
 */
export function judge(faits) {
  const { statutDepot, rangeSousDepot, reponseNomme, evasions } = faits;

  if (statutDepot === 404) {
    return {
      cause: "route-absente",
      code: CAUSES["route-absente"],
      detail: `POST ${ROUTE_DEPOT} rend 404 : la route de l'énoncé n'est pas montée`,
    };
  }
  // 🔴 D'ABORD la traversée. Un dépôt qui marche et laisse écrire hors du
  // dossier est le pire des deux mondes : tout paraît juste.
  if (evasions.length > 0) {
    return {
      cause: "traversee-de-chemin",
      code: CAUSES["traversee-de-chemin"],
      detail:
        `le nom envoyé par le client a décidé de la destination : ` +
        `${evasions.join(", ")} — écrit HORS de ${DOSSIER_DEPOT}. ` +
        `« originalFilename » est une donnée d'attaquant ; la façade du ` +
        `framework (UploadedFile.move/moveAsync) n'en garde que le dernier segment`,
    };
  }
  if (
    typeof statutDepot !== "number" ||
    statutDepot < 200 ||
    statutDepot >= 300
  ) {
    return {
      cause: "depot-refuse",
      code: CAUSES["depot-refuse"],
      detail: `un envoi multipart légitime rend ${statutDepot} — le dépôt ne fonctionne pas`,
    };
  }
  if (!rangeSousDepot) {
    return {
      cause: "fichier-introuvable",
      code: CAUSES["fichier-introuvable"],
      detail:
        `la route répond ${statutDepot} et rien n'a été rangé dans ${DOSSIER_DEPOT} : ` +
        `recevoir un fichier n'est pas le conserver`,
    };
  }
  if (!reponseNomme) {
    return {
      cause: "reponse-muette",
      code: CAUSES["reponse-muette"],
      detail:
        "la réponse ne dit ni ce qui a été rangé ni sa taille — l'appelant ne " +
        "peut pas savoir sous quel nom retrouver son fichier",
    };
  }
  return {
    cause: "conforme",
    code: 0,
    detail:
      "le fichier est rangé, la réponse le nomme, et le nom envoyé par le " +
      "client ne décide pas de la destination",
  };
}

/**
 * Compose un corps `multipart/form-data` d'UNE part fichier.
 *
 * Écrit ici plutôt qu'emprunté : le socle HTTP des juges ne connaît que le
 * JSON, et lui apprendre le multipart pour un seul appelant serait un mauvais
 * échange. Ce qui est partagé reste partagé — la requête, le jar, la garde de
 * port viennent de `http-probe`.
 *
 * @param {string} champ - nom du champ de formulaire.
 * @param {string} nomFichier - nom déclaré par le client (la donnée d'attaquant).
 * @param {string} contenu - le contenu du fichier.
 * @returns {{corps: Buffer, contentType: string}}
 */
export function composerMultipart(champ, nomFichier, contenu) {
  const frontiere = `----nodefonybench${Date.now().toString(16)}`;
  // Le nom est posé TEL QUEL, sans échappement : c'est précisément ce qu'un
  // client hostile envoie, et l'échapper reviendrait à mesurer un client poli.
  const tete =
    `--${frontiere}\r\n` +
    `Content-Disposition: form-data; name="${champ}"; filename="${nomFichier}"\r\n` +
    `Content-Type: text/plain\r\n\r\n`;
  const pied = `\r\n--${frontiere}--\r\n`;
  return {
    corps: Buffer.concat([
      Buffer.from(tete, "utf8"),
      Buffer.from(contenu, "utf8"),
      Buffer.from(pied, "utf8"),
    ]),
    contentType: `multipart/form-data; boundary=${frontiere}`,
  };
}

/**
 * Cherche un nom de fichier AILLEURS que sous le dossier de dépôt.
 *
 * Balaye l'application sur quelques niveaux — assez pour attraper les
 * destinations qu'un `..` atteint depuis `var/depots` (la racine, `var/`, le
 * parent), pas assez pour parcourir `node_modules`, qui coûterait des minutes
 * et ne peut rien contenir d'intéressant ici.
 *
 * @param {string} racine - racine de l'application.
 * @param {string[]} noms - les derniers segments recherchés.
 * @returns {string[]} les chemins trouvés hors du dossier de dépôt.
 */
export function chercherHorsDepot(racine, noms) {
  const depot = path.resolve(racine, DOSSIER_DEPOT);
  const trouves = [];
  const ignores = new Set(["node_modules", ".git", "dist", ".turbo"]);
  const visiter = (dossier, profondeur) => {
    if (profondeur > 3 || !existsSync(dossier)) return;
    let entrees;
    try {
      entrees = readdirSync(dossier, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entrees) {
      const complet = path.join(dossier, e.name);
      if (e.isDirectory()) {
        if (ignores.has(e.name)) continue;
        // Sous le dossier de dépôt, tout est légitime : c'est la destination.
        if (path.resolve(complet) === depot) continue;
        visiter(complet, profondeur + 1);
        continue;
      }
      if (noms.includes(e.name)) trouves.push(complet);
    }
  };
  // Le parent de l'application aussi : c'est là qu'un `../..` atterrit, et ne
  // pas l'inspecter rendrait la sonde aveugle à l'évasion la plus courante.
  visiter(racine, 0);
  visiter(path.dirname(racine), 3);
  return trouves;
}

/**
 * Le dossier de dépôt contient-il au moins un fichier ?
 *
 * @param {string} racine - racine de l'application.
 * @returns {boolean}
 */
function depotNonVide(racine) {
  const depot = path.resolve(racine, DOSSIER_DEPOT);
  if (!existsSync(depot)) return false;
  try {
    return readdirSync(depot).some((n) =>
      statSync(path.join(depot, n)).isFile(),
    );
  } catch {
    return false;
  }
}

/**
 * Collecte les faits, puis rend le verdict.
 *
 * @returns {Promise<void>}
 */
async function principal() {
  if (process.argv.includes("--check-port-free")) {
    await ensurePortFree();
    process.exit(0);
  }
  await ensurePortFree();
  const racine = process.cwd();

  // Une session d'administration : la route peut légitimement être protégée ou
  // non, et poster en administrateur marche dans les DEUX cas. Sans elle, un
  // agent qui protège sa route verrait son travail compté comme un refus.
  const session = await ouvrirSession(ADMIN);
  if (session.injoignable) {
    exit(
      CAUSES["aucune-reponse"],
      `CAUSE=aucune-reponse — l'application ne répond pas : ${session.injoignable}`,
    );
  }
  if (session.echec) {
    exit(
      CAUSES["identite-indisponible"],
      `CAUSE=identite-indisponible — session « ${ADMIN.username} » impossible : ${session.echec}. ` +
        "C'est le DÉCOR du banc, pas le travail de l'agent. Verdict non rendu.",
    );
  }
  const admin = session.jar;

  // 1. Un envoi HONNÊTE.
  const contenu = `rapport de bench ${Date.now()}`;
  const legitime = composerMultipart("file", "rapport-bench.txt", contenu);
  const depot = await request("POST", ROUTE_DEPOT, admin, {
    raw: legitime.corps,
    csrfToken: admin.csrfToken(),
    headers: { "content-type": legitime.contentType },
  });
  if (depot.error !== undefined) {
    exit(
      CAUSES["aucune-reponse"],
      `CAUSE=aucune-reponse — ${ROUTE_DEPOT} ne répond pas : ${depot.error}`,
    );
  }

  // 2. Les envois HOSTILES — le nom du client ne doit décider de rien.
  for (const nom of NOMS_HOSTILES) {
    const hostile = composerMultipart("file", nom, "charge hostile");
    await request("POST", ROUTE_DEPOT, admin, {
      raw: hostile.corps,
      csrfToken: admin.csrfToken(),
      headers: { "content-type": hostile.contentType },
    });
  }

  const corpsReponse = String(depot.body ?? "");
  const faits = {
    statutDepot: depot.status ?? depot.error,
    rangeSousDepot: depotNonVide(racine),
    // La réponse doit NOMMER ce qu'elle a rangé : un `{}` poli ne dit rien à
    // l'appelant, qui ne saura pas sous quel nom retrouver son fichier.
    reponseNomme: /rapport-bench|stored|size|taille|nom/iu.test(corpsReponse),
    evasions: chercherHorsDepot(
      racine,
      NOMS_HOSTILES.map((n) => n.split(/[/\\]/).pop()),
    ),
  };
  const verdict = judge(faits);
  console.error(
    `collecte : POST ${faits.statutDepot} · dépôt non vide ${faits.rangeSousDepot} · ` +
      `réponse nomme ${faits.reponseNomme} · évasions ${faits.evasions.length}` +
      (faits.evasions.length ? ` [${faits.evasions.join(", ")}]` : "") +
      ` · corps ${corpsReponse.slice(0, 120)}`,
  );
  exit(verdict.code, `CAUSE=${verdict.cause} — ${verdict.detail}`);
}

// Ne s'exécute QUE lancé directement : l'auto-contrôle importe `judge` sans
// vouloir monter quoi que ce soit.
if (process.argv[1]?.endsWith("gate-upload.mjs")) {
  await principal();
}
