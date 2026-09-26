/**
 * Le JUGE du banc de première impression — fonctions pures, zéro accès disque.
 *
 * Ce que ce banc mesure, et qu'aucun autre ne mesure. Les autres bancs jugent ce
 * que le générateur PRODUIT. Celui-ci juge ce que le dépôt fait CROIRE : on donne
 * à un agent exactement ce qu'un lecteur du web atteint — la page d'accueil, la
 * carte d'entrée, le plan du site, les pages publiées — et on lit ce qu'il en
 * conclut.
 *
 * 🔴 LE PIÈGE D'INTERPRÉTATION, à écrire avant tout le reste : le but n'est PAS
 * d'obtenir un avis favorable. Un refus fondé sur un fait vrai — préversion, une
 * seule personne, pas de rétroportage — est un SUCCÈS : le projet a été honnête
 * et l'évaluateur a décidé en connaissance de cause. Ce que ce banc traque, c'est
 * le motif FAUX : celui qui attribue au produit ce qui n'appartient qu'au dépôt de
 * développement. Un banc qui noterait le sens du verdict pousserait à taire les
 * réserves, c'est-à-dire à obtenir un bon score en mentant.
 *
 * Origine mesurée : un agent grand public a conseillé d'écarter le framework au
 * motif qu'on « hériterait du monorepo, de la migration, du Studio, de
 * l'outillage IA ». Une application minimale installe quatre paquets.
 */

/**
 * Ce que l'accueil doit faire passer, une entrée par question fermée.
 *
 * Chaque attendu est un FAIT vérifiable dans le corpus donné à l'agent — jamais
 * un jugement. C'est ce qui rend ce juge reproductible.
 */
export const ATTENDUS = [
  {
    cle: "q1",
    quoi: "ce que fait le framework — HTTP et WebSocket dans le même pipeline",
    motif:
      /(websocket|ws)[^.]{0,80}(m[êe]me|partag|premi[èe]re classe)|(m[êe]me|partag)[^.]{0,80}(websocket|ws)/iu,
  },
  {
    cle: "q2",
    quoi: "ce qu'une application installe — quatre dépendances de production",
    motif:
      /\b(quatre|4)\b[^.]{0,60}d[ée]pendances|d[ée]pendances[^.]{0,30}\b(quatre|4)\b/iu,
  },
  {
    cle: "q3",
    quoi: "où lire le reste-à-faire et ce qui peut casser",
    motif: /jalon|milestone|compatibilit[ée]/iu,
  },
];

/**
 * Les motifs FAUX — ce qu'un évaluateur ne peut conclure QU'EN prenant le dépôt
 * de développement pour le produit, ou en jugeant absente une capacité qui existe.
 *
 * Chacun porte une `cause`, sur le modèle des autres juges du banc : c'est elle
 * qu'on compte, jamais une note globale.
 */
export const MOTIFS_FAUX = [
  {
    cause: "herite-du-depot",
    dit: "attribue au produit la complexité du dépôt de développement",
    motif:
      /h[ée]rit\w*[^.]{0,120}(monorepo|migration|studio|outillage)|(monorepo|migration 10|branche dev|outillage (IA|d'agent|agentique))[^.]{0,80}(complexit|co[ûu]t|lourd|usine)/iu,
  },
  {
    cause: "trop-de-dependances",
    dit: "croit qu'une application installe une pile entière",
    motif:
      /(trop|beaucoup|nombreuses?|vingt|20)\s+(de\s+)?(d[ée]pendances|paquets)[^.]{0,60}(install|app)|app[^.]{0,40}(vingt|20)\s+paquets/iu,
  },
  {
    cause: "doc-inatteignable",
    dit: "juge la documentation indisponible hors ligne alors qu'elle part dans les paquets",
    motif:
      /doc\w*[^.]{0,80}(pas|non)\s+(disponible\s+)?hors\s+ligne|d[ée]pend\w*[^.]{0,40}github[^.]{0,40}doc/iu,
  },
  {
    cause: "calendrier-absent",
    dit: "conclut qu'aucun calendrier n'est publié alors que les jalons le portent",
    motif:
      /(aucun|pas de|sans)\s+(calendrier|feuille de route|roadmap|jalon)|aucune\s+(visibilit[ée]|indication)[^.]{0,40}(sortie|stable)/iu,
  },
];

/**
 * Les motifs VRAIS, écrits volontairement dans l'accueil.
 *
 * Ils ne rapportent aucun point et n'en retirent aucun : ils servent à DIRE, dans
 * le rapport, que le refus est fondé. Sans eux on ne distinguerait pas un agent
 * qui a lu d'un agent qui refuse par défaut.
 */
/*
 * ⚠️ Ces entrées portent `constat:` et non `cause:`, à dessein. La table
 * d'imputation du banc classe les causes d'ÉCHEC — agent, décor, indéterminé —
 * et son contrôle d'exhaustivité exige que chacune y figure. Un motif vrai ne
 * provoque aucun échec : il enrichit le rapport en disant que le refus est
 * fondé. L'y inscrire obligerait à lui donner une imputation qui n'a pas de
 * sens, et brouillerait la table pour tous les autres juges.
 */
export const MOTIFS_VRAIS = [
  {
    constat: "preversion",
    motif: /pr[ée]version|alpha|instabilit[ée]|breaking/iu,
  },
  {
    constat: "auteur-unique",
    motif: /une seule personne|solo|b[ée]n[ée]vole|bus factor|risque bus/iu,
  },
  {
    constat: "pas-de-retroportage",
    motif: /r[ée]troportage|derni[èe]re majeure|ne re[çc]oit plus/iu,
  },
  {
    constat: "pas-de-retours-usage",
    motif:
      /(aucun|pas de|sans)[^.]{0,40}(retour d'usage|t[ée]moignage|production|adoption)/iu,
  },
];

/**
 * Le bloc JSON que l'agent est invité à rendre, s'il en a rendu un.
 *
 * Tolérant par construction : un modèle léger oublie les clôtures, ou rend le
 * JSON au fil du texte. On prend le DERNIER objet équilibré du texte — le
 * premier est souvent un exemple recopié de la consigne.
 *
 * @param {string} texte - la réponse brute de l'agent.
 * @returns {object|null} l'objet, ou null si rien d'exploitable.
 */
export function extraireJson(texte) {
  const candidats = [];
  for (let i = 0; i < texte.length; i += 1) {
    if (texte[i] !== "{") continue;
    let profondeur = 0;
    for (let j = i; j < texte.length; j += 1) {
      if (texte[j] === "{") profondeur += 1;
      else if (texte[j] === "}") {
        profondeur -= 1;
        if (profondeur === 0) {
          candidats.push(texte.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  for (const brut of candidats.reverse()) {
    try {
      const objet = JSON.parse(brut);
      if (objet && typeof objet === "object" && !Array.isArray(objet))
        return objet;
    } catch {
      /* candidat suivant */
    }
  }
  return null;
}

/**
 * Le texte sur lequel une question se juge.
 *
 * Un agent qui n'a pas rendu de JSON a quand même répondu : on juge alors le
 * texte ENTIER. Ne juger que le JSON ferait compter comme « n'a pas trouvé » un
 * agent qui a trouvé et l'a écrit en prose — le défaut symétrique de la
 * troncature, et il fait conclure faux dans le sens qui accuse le produit.
 *
 * @param {object|null} json - le bloc rendu, s'il y en a un.
 * @param {string} texte - la réponse brute.
 * @param {string} cle - la question.
 * @returns {string} le texte à confronter.
 */
export function zoneDeLecture(json, texte, cle) {
  if (!json) return texte;
  const part = json[cle];
  if (part === undefined) return texte;
  return typeof part === "string" ? part : JSON.stringify(part);
}

/**
 * Le verdict du banc, depuis la réponse brute d'un agent.
 *
 * @param {string} reponse - tout ce que l'agent a écrit.
 * @returns {{exactitude: {sur: number, points: number, manques: string[]},
 *   faux: {cause: string, dit: string}[], vrais: string[],
 *   verdict: "oui"|"non"|"indetermine", juste: boolean}}
 *   `juste` est LE résultat : aucun motif faux.
 */
export function juger(reponse) {
  const texte = reponse ?? "";
  const json = extraireJson(texte);

  const manques = [];
  let points = 0;
  for (const attendu of ATTENDUS) {
    const zone = zoneDeLecture(json, texte, attendu.cle);
    if (attendu.motif.test(zone)) points += 1;
    else manques.push(attendu.quoi);
  }

  // Les motifs se cherchent sur le texte ENTIER : un agent range rarement son
  // argument là où on l'attend, et un motif faux compte où qu'il soit écrit.
  const faux = MOTIFS_FAUX.filter((m) => m.motif.test(texte)).map(
    ({ cause, dit }) => ({
      cause,
      dit,
    }),
  );
  const vrais = MOTIFS_VRAIS.filter((m) => m.motif.test(texte)).map(
    (m) => m.constat,
  );

  return {
    exactitude: { sur: ATTENDUS.length, points, manques },
    faux,
    vrais,
    verdict: lireVerdict(json, texte),
    juste: faux.length === 0,
  };
}

/**
 * Le sens du verdict — informatif, jamais un critère.
 *
 * @param {object|null} json - le bloc rendu.
 * @param {string} texte - la réponse brute.
 * @returns {"oui"|"non"|"indetermine"} ce que l'agent a recommandé.
 */
export function lireVerdict(json, texte) {
  const zone = zoneDeLecture(json, texte, "q4");
  if (
    /\bnon\b|\bno\b|d[ée]conseill|[ée]cart|pas (retenir|recommand)/iu.test(zone)
  )
    return "non";
  if (/\boui\b|\byes\b|recommand|[ée]valuer/iu.test(zone)) return "oui";
  return "indetermine";
}

/**
 * Le banc MESURE-T-IL quelque chose ? La comparaison d'un décor sain et d'un
 * décor dégradé.
 *
 * Un banc qui rend le même verdict quoi qu'on donne à lire ne mesure rien. La
 * dégradation attendue est donc une EXIGENCE du banc, pas une curiosité : on
 * remet l'état de publication en tête de la carte d'entrée et on retire le plan
 * du site, puis on exige que la justesse tombe ou que l'exactitude baisse.
 *
 * @param {{juste: boolean, exactitude: {points: number}}} sain - verdict du décor normal.
 * @param {{juste: boolean, exactitude: {points: number}}} degrade - verdict du décor dégradé.
 * @returns {{mord: boolean, pourquoi: string}} le constat.
 */
export function mordSurLeDecor(sain, degrade) {
  if (!sain.juste)
    return {
      mord: false,
      pourquoi:
        "le décor SAIN produit déjà un motif faux — rien à comparer, corriger l'accueil d'abord",
    };
  if (!degrade.juste)
    return {
      mord: true,
      pourquoi: "le décor dégradé fait apparaître un motif faux",
    };
  if (degrade.exactitude.points < sain.exactitude.points)
    return {
      mord: true,
      pourquoi: `l'exactitude tombe de ${sain.exactitude.points} à ${degrade.exactitude.points}`,
    };
  return {
    mord: false,
    pourquoi:
      "même verdict sur un décor dégradé : le banc ne mesure pas l'accueil, il mesure l'agent",
  };
}

/**
 * Le décor D'AVANT : l'accueil tel qu'il était quand il a produit le faux verdict.
 *
 * 🔴 CE QUI A ÉTÉ MESURÉ, et qui a corrigé cette fonction. Elle se contentait
 * d'abord de REMONTER la section « État » en tête. Joué pour de vrai, le banc n'a
 * rien vu bouger : l'agent retrouvait les mêmes faits dans le README et concluait
 * juste — la seule différence était le sens de son verdict, qui n'est pas un
 * critère. Une contre-épreuve qui RÉORDONNE ne prouve rien ; il faut RETIRER
 * l'information, parce que c'est exactement ce que le dépôt faisait avant : la
 * distinction entre le dépôt et le produit n'était écrite NULLE PART.
 *
 * Elle retire donc la section qui porte cette distinction, puis remonte l'état.
 * Le plan du site, lui, est retiré par l'appelant — il n'existait pas non plus.
 *
 * @param {string} accueil - le contenu d'`AGENTS.md`.
 * @returns {string} l'accueil d'avant les correctifs.
 */
export function decorDAvant(accueil) {
  return remettreLEtatEnTete(retirerLaDistinction(accueil));
}

/**
 * Retire la section qui distingue le dépôt de ce qu'une application installe.
 *
 * Reconnue par son SUJET, jamais par son titre exact : un titre se réécrit, et
 * une contre-épreuve qui ne mute plus rien rend un verdict de complaisance.
 * Si rien n'est trouvé, on le DIT en rendant l'entrée inchangée — l'auto-contrôle
 * fait alors tomber le banc.
 *
 * @param {string} accueil - le contenu d'`AGENTS.md`.
 * @returns {string} le même, sans cette section.
 */
export function retirerLaDistinction(accueil) {
  const sections = accueil.split(/^## /mu);
  const gardees = sections.filter(
    (s, i) =>
      i === 0 ||
      !/d[ée]pendances de production|n'est pas ce qu'une application/iu.test(s),
  );
  return gardees.length === sections.length
    ? accueil
    : gardees.map((s, i) => (i === 0 ? s : `## ${s}`)).join("");
}

/**
 * Remonte la section « État » avant tout le reste.
 *
 * Second volet de la contre-épreuve : c'est l'ORDRE qui faisait qu'un agent
 * lisant trente lignes n'avait vu que des réserves.
 *
 * @param {string} accueil - le contenu d'`AGENTS.md`.
 * @returns {string} le même, l'état ramené en tête.
 */
export function remettreLEtatEnTete(accueil) {
  const debut = accueil.indexOf("## État");
  if (debut === -1) return accueil;
  const fin = accueil.indexOf("\n## ", debut + 1);
  const etat = accueil.slice(debut, fin === -1 ? accueil.length : fin);
  const reste =
    accueil.slice(0, debut) + accueil.slice(fin === -1 ? accueil.length : fin);
  const titre = reste.indexOf("\n---\n");
  return titre === -1
    ? etat + reste
    : reste.slice(0, titre + 5) + "\n" + etat + reste.slice(titre + 5);
}
