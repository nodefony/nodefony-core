/**
 * Juge de la tâche « recevoir un fichier » — et il NOMME sa cause.
 *
 * Ce que ce juge refuse de faire : lire le code de l'agent. Il envoie de vrais
 * corps multipart et REGARDE où les octets atterrissent — c'est la seule
 * question qui compte, et la seule à laquelle une relecture de diff ne répond
 * pas.
 *
 * Quatre faits — trois qui jugent, et un filet :
 *
 * 1. **la route existe** et accepte un envoi multipart ;
 * 2. **le fichier est RANGÉ** là où l'énoncé le demande — pas seulement reçu ;
 * 3. **la réponse RESTITUE ce qu'elle a fait** — le nom sous lequel le fichier
 *    a atterri, et son nombre d'octets, LUS dans le document analysé et
 *    confrontés à ce que le juge a mesuré au disque. Sans elle, une application
 *    qui avale les fichiers en silence passerait pour correcte. Chercher un
 *    VOCABULAIRE (`/nom|size|taille/i`) ne mesurait pas ce comportement :
 *    « anonymous » et « nombre » suffisaient à passer ;
 * 4. **le nom envoyé par le client ne décide pas d'où le fichier atterrit.**
 *
 *    ⚠️ **Ce fait n'a PAS pu être vu rouge, et c'est une bonne nouvelle qu'il
 *    faut écrire plutôt que taire.** L'hypothèse de départ était qu'un agent
 *    écrivant `path.join(dossier, file.filename)` ouvrirait une traversée de
 *    chemin. Mesuré sur une application réelle, avec un controller ÉCRIT POUR
 *    être vulnérable et deux noms hostiles (`../../x`, `..\\..\\x`) : les deux
 *    fichiers atterrissent DANS le dossier de dépôt, sous leur dernier segment.
 *    Le nom est donc réduit AVANT d'atteindre l'application — le parser
 *    multipart ne transmet jamais de composante de chemin —, et la garde de
 *    `UploadedFile.move()` (`#safeTargetName`) est une seconde ligne, pas la
 *    première.
 *
 *    La sonde RESTE, comme filet : le jour où le parser change, où une option
 *    de configuration transmet le nom brut, ou où quelqu'un lit le nom depuis
 *    un champ de formulaire plutôt que depuis la part fichier, elle mordra. Un
 *    filet qui n'a jamais mordu ne prouve rien sur AUJOURD'HUI — il garde
 *    DEMAIN, et le dire est la seule façon de ne pas le prendre pour une preuve.
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
import {
  CookieJar,
  ensurePortFree,
  exit,
  request,
  semerJeton,
} from "./http-probe.mjs";
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
  "jeton-csrf-absent": 9,
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
 *   pourquoiMuette?: string, evasions: string[]}} faits
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
        "la réponse ne restitue pas ce qui a été rangé — l'appelant ne peut " +
        "pas savoir sous quel nom retrouver son fichier" +
        (faits.pourquoiMuette ? ` : ${faits.pourquoiMuette}` : ""),
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
 * Les fichiers présents sous le dossier de dépôt, avec leur taille.
 *
 * Le filtre par date d'écriture écarte les restes d'un run précédent : sans lui,
 * un vieux fichier suffirait à faire passer une réponse qui ne restitue rien de
 * l'envoi COURANT. Il retombe sur la liste entière quand il ne rend rien —
 * l'horodatage d'un système de fichiers n'est pas une garantie, et un juge qui
 * s'aveugle sur une seconde d'écart accuserait à tort.
 *
 * @param {string} racine - racine de l'application.
 * @param {number} [depuis] - instant (ms) avant l'envoi.
 * @returns {{nom: string, taille: number}[]}
 */
function fichiersDeposes(racine, depuis) {
  const depot = path.resolve(racine, DOSSIER_DEPOT);
  if (!existsSync(depot)) return [];
  let tous = [];
  try {
    tous = readdirSync(depot)
      .map((nom) => ({ nom, st: statSync(path.join(depot, nom)) }))
      .filter((e) => e.st.isFile())
      .map((e) => ({ nom: e.nom, taille: e.st.size, mtime: e.st.mtimeMs }));
  } catch {
    return [];
  }
  if (depuis === undefined) return tous;
  const recents = tous.filter((e) => e.mtime >= depuis - 2000);
  return recents.length ? recents : tous;
}

/** Le dernier segment d'un chemin, quelle que soit la grammaire de séparateur. */
const dernierSegment = (v) => String(v).split(/[/\\]/).pop();

/**
 * Toutes les valeurs terminales d'un document analysé, à plat.
 *
 * @param {unknown} noeud - le document, ou un sous-arbre.
 * @param {unknown[]} [out] - accumulateur.
 * @returns {unknown[]}
 */
function valeursTerminales(noeud, out = []) {
  if (noeud === null || noeud === undefined) return out;
  if (Array.isArray(noeud)) {
    for (const v of noeud) valeursTerminales(v, out);
    return out;
  }
  if (typeof noeud === "object") {
    for (const v of Object.values(noeud)) valeursTerminales(v, out);
    return out;
  }
  out.push(noeud);
  return out;
}

/**
 * La réponse RESTITUE-t-elle ce qui a été rangé ?
 *
 * 🔴 **Un juge qui cherche un MOT ne mesure pas un comportement, il mesure un
 * vocabulaire.** La version précédente testait
 * `/rapport-bench|stored|size|taille|nom/iu` sur le texte brut : sans frontière
 * de mot et sans casse, « anonymous », « nombre » et « nommé » passaient, et
 * `size` passe dans presque toute réponse structurée. Une application qui range
 * correctement et une qui ne dit rien de ce qu'elle a fait rendaient le même
 * verdict — or c'est la seconde que cette sonde existe pour attraper.
 *
 * Le FAIT, lui, est vérifiable : le juge connaît le nom sous lequel le fichier a
 * atterri et le nombre d'octets qu'il a envoyés. Il demande donc que le document
 * les PORTE, à n'importe quelle profondeur et sous n'importe quelle clé — juger
 * le nom d'une clé serait retomber dans le vocabulaire.
 *
 * Deux lectures honnêtes de « la taille » coexistent — celle des octets envoyés
 * et celle du fichier tel qu'il a atterri — et le juge n'a pas à trancher entre
 * elles : il accepte l'une OU l'autre, et refuse tout le reste. Les tailles
 * nulles sont écartées : un `0` se trouve par hasard dans n'importe quel
 * document, et l'accepter rendrait la sonde borgne.
 *
 * @param {string} corpsBrut - le corps de la réponse, tel que reçu.
 * @param {{nomsRanges: string[], tailles: number[]}} attendu - ce qui a réellement été rangé.
 * @returns {{estJson: boolean, nomTrouve: boolean, tailleTrouvee: boolean}}
 */
export function lireFaitDeLaReponse(corpsBrut, attendu) {
  const { nomsRanges = [], tailles = [] } = attendu ?? {};
  const attendues = new Set(
    tailles.filter((t) => typeof t === "number" && t > 0),
  );
  let doc;
  try {
    doc = JSON.parse(String(corpsBrut ?? ""));
  } catch {
    return { estJson: false, nomTrouve: false, tailleTrouvee: false };
  }
  const plates = valeursTerminales(doc);
  const cibles = new Set(nomsRanges.map(dernierSegment));
  const nomTrouve =
    cibles.size > 0 &&
    plates.some((v) => typeof v === "string" && cibles.has(dernierSegment(v)));
  const tailleTrouvee =
    attendues.size > 0 &&
    plates.some(
      (v) =>
        (typeof v === "number" && attendues.has(v)) ||
        (typeof v === "string" &&
          /^\d+$/u.test(v.trim()) &&
          attendues.has(Number(v.trim()))),
    );
  return { estJson: true, nomTrouve, tailleTrouvee };
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

  // 🔴 Se munir du jeton anti-rejeu AVANT d'écrire. Le framework ne l'émet que
  // sur une requête SÛRE vers une route `@CsrfProtect` : sans ce GET, toute
  // route correctement protégée rend 403 au juge, qui accuserait alors le
  // dépôt de « ne pas fonctionner » — et validerait la seule route qui ne
  // résiste pas, celle qui n'est pas protégée. Mesuré : un agent ayant suivi
  // l'`AGENTS.md` (« toute action qui ÉCRIT porte @CsrfProtect ») a été mis en
  // défaut ici, quand deux agents qui ne l'avaient pas protégée passaient.
  await semerJeton(admin, ROUTE_DEPOT);

  // 1. Un envoi HONNÊTE.
  const contenu = `rapport de bench ${Date.now()}`;
  const octetsEnvoyes = Buffer.byteLength(contenu);
  const avantEnvoi = Date.now();
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

  // Un 403 SANS jeton en poche ne dit rien du dépôt : il dit que le juge n'a
  // pas pu se munir. S'abstenir est le seul verdict honnête — accuser ici, ce
  // serait reprocher à l'agent d'avoir protégé sa route.
  if (depot.status === 403 && admin.csrfToken() === null) {
    exit(
      CAUSES["jeton-csrf-absent"],
      `CAUSE=jeton-csrf-absent — ${ROUTE_DEPOT} rend 403 et le juge n'a AUCUN ` +
        `jeton : un GET sur cette route n'a pas semé le cookie « csrf-token ». ` +
        `Le dépôt n'est pas en cause — l'instrument ne s'est pas muni.`,
    );
  }

  const corpsReponse = String(depot.body ?? "");
  // Ce qui a RÉELLEMENT atterri : c'est contre ce fait que la réponse est lue,
  // jamais contre un vocabulaire.
  const deposes = fichiersDeposes(racine, avantEnvoi);
  const lecture = lireFaitDeLaReponse(corpsReponse, {
    nomsRanges: deposes.map((f) => f.nom),
    tailles: [octetsEnvoyes, ...deposes.map((f) => f.taille)],
  });
  const faits = {
    statutDepot: depot.status ?? depot.error,
    rangeSousDepot: depotNonVide(racine),
    // La réponse doit RESTITUER ce qu'elle a rangé : un `{}` poli ne dit rien à
    // l'appelant, qui ne saura pas sous quel nom retrouver son fichier.
    reponseNomme: lecture.nomTrouve && lecture.tailleTrouvee,
    pourquoiMuette: !lecture.estJson
      ? "le corps n'est pas du JSON analysable — le fait ne peut pas s'y lire"
      : !lecture.nomTrouve && !lecture.tailleTrouvee
        ? `le corps ne porte ni le nom rangé (${deposes.map((f) => f.nom).join(", ") || "aucun fichier trouvé"}) ni la taille (${octetsEnvoyes})`
        : !lecture.nomTrouve
          ? `le corps porte la taille mais pas le nom rangé (${deposes.map((f) => f.nom).join(", ") || "aucun fichier trouvé"})`
          : `le corps porte le nom rangé mais aucune taille exacte (${[octetsEnvoyes, ...deposes.map((f) => f.taille)].join(" ou ")} octets)`,
    evasions: chercherHorsDepot(
      racine,
      NOMS_HOSTILES.map((n) => n.split(/[/\\]/).pop()),
    ),
  };
  const verdict = judge(faits);
  console.error(
    `collecte : POST ${faits.statutDepot} · dépôt non vide ${faits.rangeSousDepot} · ` +
      `réponse restitue le fait ${faits.reponseNomme} ` +
      `(json ${lecture.estJson} · nom ${lecture.nomTrouve} · taille ${lecture.tailleTrouvee}) · ` +
      `rangés [${deposes.map((f) => `${f.nom}:${f.taille}`).join(", ")}] · ` +
      `évasions ${faits.evasions.length}` +
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
