/**
 * Les GRAMMAIRES de transcript des agents, et ce qu'on sait en tirer.
 *
 * Un banc qui lance des agents ne lit pas un format, il en lit SIX : chaque
 * harness écrit son propre journal, et le même fait — « l'agent a lancé cette
 * commande, elle a rendu ceci » — s'y dit autrement à chaque fois. Ce module
 * porte cette table, et rien d'autre : il ne lit aucun fichier, ne lance rien,
 * et ne connaît ni le décor du banc ni ses gates. C'est ce qui le rend
 * utilisable sur un transcript qu'on n'a PAS produit — une session réelle chez
 * un utilisateur, par exemple, qui est précisément le matériau le plus
 * instructif et que le banc ne savait pas lire.
 *
 * **Ce qu'il rend, et la raison de chaque sortie :**
 *
 * - {@link detecterDialecte} — le harness, reconnu au CONTENU. Jamais au nom de
 *   fichier ni à une option : un `events.jsonl` peut venir de n'importe où, et
 *   se tromper de grammaire rend « 0 tour, 0 appel » — le diagnostic faux que
 *   tout ceci existe pour ne plus produire.
 * - {@link lireReleve} — tours, durée, coût, appels MCP. **Chaque champ vaut
 *   `null` quand l'agent ne l'ÉMET pas** : compter à zéro une durée que Codex
 *   ne publie pas serait plus faux que de se taire.
 * - {@link lireTimeline} — le DÉROULÉ apparié, geste par geste : la commande,
 *   sa sortie, son code de retour. C'est la seule sortie qui montre ce qu'un
 *   relevé de sondes ne peut pas montrer — qu'un agent a interrogé le mauvais
 *   port pendant cinq minutes, ou qu'il s'est rabattu sur du code à la main
 *   après une recherche bredouille.
 *
 * 🔴 **Ce qu'on n'a pas observé n'est pas deviné.** Trois harness n'exposent
 * pas (ou pas encore, faute d'échantillon en main) la forme de leurs retours
 * d'outil. Leur entrée le DIT (`timeline: "partielle"` / `"non observée"`) et
 * la timeline rend ce qu'elle a, jamais un motif plausible : une mesure
 * inventée coûte plus cher qu'une mesure absente, parce qu'elle a l'air d'une
 * preuve.
 *
 * Module PUR : aucune I/O, aucune dépendance au décor. Les appelants lisent le
 * fichier et passent le texte.
 */

/**
 * Nom du serveur MCP dont on compte les appels. Les outils d'un serveur MCP
 * portent son nom en préfixe, mais la FORME du nom qualifié change d'un agent
 * à l'autre (`mcp__<serveur>__<outil>` chez Claude, `<serveur>_<outil>` chez
 * Gemini) — d'où le paramètre plutôt qu'une constante en dur.
 */
export const MCP_SERVEUR_DEFAUT = "nodefony";

/** Un geste normalisé, quelle que soit la grammaire d'origine. */
/**
 * @typedef {object} Geste
 * @property {number} seq - rang d'apparition dans le journal (0-based).
 * @property {string|null} t - horodatage ISO, `null` si l'agent n'en pose pas.
 * @property {"appel"|"retour"|"parole"|"user"} nature
 * @property {string|null} id - identifiant d'appel, pour apparier appel↔retour.
 * @property {string|null} outil - nom de l'outil appelé.
 * @property {string} arg - l'argument saillant (la commande, le chemin, le motif).
 * @property {string} texte - la sortie, ou la parole.
 * @property {boolean|null} ok - succès déclaré par le harness, `null` si muet.
 */

/**
 * Une ligne de journal appariée : le geste et ce qu'il a rendu.
 *
 * @typedef {object} Pas
 * @property {number} seq
 * @property {string|null} t
 * @property {string|null} outil
 * @property {string} arg
 * @property {string} sortie
 * @property {number|null} exit - code de retour, quand le harness le publie ou
 *   que la sortie le porte en clair.
 * @property {boolean|null} ok
 */

/** Le relevé d'effort d'un run. Un champ `null` = l'agent ne l'émet pas. */
/**
 * @typedef {object} Releve
 * @property {string} dialecte
 * @property {number|null} tours
 * @property {number|null} dureeMs
 * @property {number|null} coutUsd
 * @property {number} mcpCalls
 * @property {boolean} vu - au moins une observation ; sinon le relevé ne vaut rien.
 */

// ───────────────────────────────────────────────────────────────────────────
//  Helpers purs
// ───────────────────────────────────────────────────────────────────────────

/**
 * Les objets d'un JSONL, les lignes illisibles ignorées.
 *
 * Une ligne tronquée n'est pas une erreur du lecteur : un agent tué en plein
 * écrit en laisse une, et jeter tout le journal pour elle perdrait la mesure
 * de tout ce qui l'a précédée.
 *
 * @param {string} texte
 * @returns {Array<{i: number, o: Record<string, unknown>, ligne: string}>}
 */
export function objetsJsonl(texte) {
  const out = [];
  const lignes = String(texte ?? "").split("\n");
  for (let i = 0; i < lignes.length; i += 1) {
    const ligne = lignes[i];
    if (!ligne || ligne.charCodeAt(0) !== 123 /* { */) continue;
    try {
      const o = JSON.parse(ligne);
      if (o && typeof o === "object") out.push({ i, o, ligne });
    } catch {
      /* ligne tronquée — cf TSDoc */
    }
  }
  return out;
}

/** Une valeur textuelle sûre, quelle que soit la forme reçue. */
const txt = (v) =>
  typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);

/**
 * L'argument SAILLANT d'un appel d'outil.
 *
 * Un appel porte souvent dix champs dont un seul se lit : la commande pour un
 * shell, le chemin pour une lecture, le motif pour une recherche. Les afficher
 * tous rendrait la timeline illisible, précisément là où elle doit se parcourir
 * d'un coup d'œil.
 *
 * @param {unknown} args - les arguments de l'appel, objet ou chaîne JSON.
 */
export function argSaillant(args) {
  let a = args;
  if (typeof a === "string") {
    try {
      a = JSON.parse(a);
    } catch {
      return a;
    }
  }
  if (!a || typeof a !== "object") return txt(a);
  const o = /** @type {Record<string, unknown>} */ (a);
  for (const cle of [
    "command",
    "cmd",
    "file_path",
    "path",
    "filePath",
    "pattern",
    "query",
    "url",
    "prompt",
  ]) {
    if (typeof o[cle] === "string" && o[cle])
      return /** @type {string} */ (o[cle]);
  }
  return JSON.stringify(o);
}

/**
 * Le code de retour lu DANS une sortie, quand le harness ne le publie pas.
 *
 * Plusieurs agents n'exposent aucun champ de statut mais laissent le shell
 * l'écrire dans le texte (`exit code: 1`, `Return code: 64`). Le lire là vaut
 * mieux que de rendre `null` : c'est un fait ÉMIS, pas une déduction.
 *
 * @param {string} sortie
 * @returns {number|null}
 */
export function exitDansTexte(sortie) {
  const m =
    /(?:completed with exit code|exit_code:|exit code:|Return code:|returncode:)\s*(-?\d{1,3})/iu.exec(
      String(sortie ?? ""),
    );
  return m ? Number(m[1]) : null;
}

// ───────────────────────────────────────────────────────────────────────────
//  §3 — Les six grammaires
// ───────────────────────────────────────────────────────────────────────────

/**
 * Ce qu'un dialecte doit savoir faire.
 *
 * `reconnait` vote sur UNE ligne (le vote majoritaire tranche, cf
 * {@link detecterDialecte}) ; `releve` accumule l'effort ; `gestes` rend les
 * événements normalisés d'une ligne.
 *
 * @typedef {object} Dialecte
 * @property {string} nom
 * @property {string} cli - comment on le lance, pour situer le lecteur.
 * @property {"complete"|"partielle"|"non observée"} timeline - ce qu'on sait
 *   reconstituer de son déroulé. Une valeur autre que `complete` est une
 *   LIMITE CONNUE, pas un défaut à masquer.
 * @property {(o: Record<string, any>) => boolean} reconnait
 * @property {(o: Record<string, any>, acc: Releve, opts: {mcp: string}) => void} releve
 * @property {(o: Record<string, any>, seq: number) => Geste[]} gestes
 */

/** @type {Dialecte[]} */
export const DIALECTES = [
  {
    nom: "claude",
    cli: "claude -p --output-format stream-json",
    timeline: "complete",
    reconnait: (o) =>
      (o.type === "assistant" && !!o.message) ||
      (o.type === "result" && typeof o.num_turns === "number") ||
      (o.type === "user" && !!o.message),
    releve: (o, acc, { mcp }) => {
      if (o.type === "result" && typeof o.num_turns === "number") {
        acc.tours = (acc.tours ?? 0) + o.num_turns;
        if (typeof o.duration_ms === "number")
          acc.dureeMs = (acc.dureeMs ?? 0) + o.duration_ms;
        if (typeof o.total_cost_usd === "number")
          acc.coutUsd = (acc.coutUsd ?? 0) + o.total_cost_usd;
        acc.vu = true;
      }
      // Les appels MCP se comptent sur les BLOCS `tool_use`, jamais sur le
      // texte : l'agent écrit volontiers `mcp__nodefony__…` dans du code ou de
      // la prose, et un compte qui lit le texte mesurerait ce qu'il DIT.
      if (o.type === "assistant" && Array.isArray(o.message?.content)) {
        for (const b of o.message.content) {
          if (
            b?.type === "tool_use" &&
            String(b.name ?? "").startsWith("mcp__")
          )
            acc.mcpCalls += 1;
        }
      }
      void mcp;
    },
    gestes: (o, seq) => {
      const out = [];
      const t = typeof o.timestamp === "string" ? o.timestamp : null;
      if (o.type === "assistant" && Array.isArray(o.message?.content)) {
        for (const b of o.message.content) {
          if (b?.type === "tool_use")
            out.push({
              seq,
              t,
              nature: "appel",
              id: b.id ?? null,
              outil: b.name ?? null,
              arg: argSaillant(b.input),
              texte: "",
              ok: null,
            });
          else if (b?.type === "text" && b.text)
            out.push({
              seq,
              t,
              nature: "parole",
              id: null,
              outil: null,
              arg: "",
              texte: b.text,
              ok: null,
            });
        }
      } else if (o.type === "user" && Array.isArray(o.message?.content)) {
        for (const b of o.message.content) {
          if (b?.type === "tool_result")
            out.push({
              seq,
              t,
              nature: "retour",
              id: b.tool_use_id ?? null,
              outil: null,
              arg: "",
              texte: txt(
                Array.isArray(b.content)
                  ? b.content.map((c) => c?.text ?? "").join("")
                  : b.content,
              ),
              ok:
                b.is_error === true
                  ? false
                  : b.is_error === false
                    ? true
                    : null,
            });
        }
      }
      return out;
    },
  },

  {
    // Copilot CLI — `~/.copilot/session-state/<id>/events.jsonl`. Sixième
    // grammaire, relevée sur une session RÉELLE : son journal est un flux
    // d'événements typés, pas une conversation, et l'appariement passe par
    // `toolCallId`.
    nom: "copilot",
    cli: "copilot (vscode-agent-host)",
    timeline: "complete",
    reconnait: (o) =>
      o.type === "tool.execution_start" ||
      o.type === "tool.execution_complete" ||
      o.type === "assistant.turn_start" ||
      o.type === "session.usage_checkpoint",
    releve: (o, acc, { mcp }) => {
      if (o.type === "assistant.turn_end") {
        acc.tours = (acc.tours ?? 0) + 1;
        acc.vu = true;
      }
      // La durée se prend aux BORNES du journal — Copilot ne publie aucune
      // durée agrégée. Le premier et le dernier horodatage la donnent, et
      // c'est un fait émis : deux horloges ne sont pas en jeu, c'est la même.
      if (typeof o.timestamp === "string") {
        const ms = Date.parse(o.timestamp);
        if (Number.isFinite(ms)) {
          acc._t0 = Math.min(acc._t0 ?? ms, ms);
          acc._t1 = Math.max(acc._t1 ?? ms, ms);
        }
      }
      // 🔴 Aucun coût en USD : Copilot compte en « premium requests » et en
      // nano-AIU, qui ne se convertissent pas en dollars sans un barème qu'on
      // n'a pas. Le laisser à `null` est la seule lecture honnête.
      if (
        o.type === "tool.execution_start" &&
        String(o.data?.toolName ?? "").startsWith(`${mcp}-`)
      )
        acc.mcpCalls += 1;
    },
    gestes: (o, seq) => {
      const t = typeof o.timestamp === "string" ? o.timestamp : null;
      if (o.type === "tool.execution_start")
        return [
          {
            seq,
            t,
            nature: "appel",
            id: o.data?.toolCallId ?? null,
            outil: o.data?.toolName ?? null,
            arg: argSaillant(o.data?.arguments),
            texte: "",
            ok: null,
          },
        ];
      if (o.type === "tool.execution_complete")
        return [
          {
            seq,
            t,
            nature: "retour",
            id: o.data?.toolCallId ?? null,
            outil: null,
            arg: "",
            texte: txt(
              o.data?.result?.content ?? o.data?.result?.detailedContent,
            ),
            ok: typeof o.data?.success === "boolean" ? o.data.success : null,
          },
        ];
      if (o.type === "user.message")
        return [
          {
            seq,
            t,
            nature: "user",
            id: null,
            outil: null,
            arg: "",
            texte: txt(o.data?.content ?? o.data?.message),
            ok: null,
          },
        ];
      return [];
    },
  },

  {
    // vibe — `~/.vibe/logs/session/<id>/messages.jsonl`, grammaire de type
    // conversation OpenAI : l'appel vit dans `tool_calls[]` du tour assistant,
    // le retour dans un message `role: "tool"` qui le rappelle par son id.
    nom: "vibe",
    cli: "vibe --output streaming --yolo --trust -p",
    timeline: "complete",
    reconnait: (o) =>
      (o.role === "assistant" &&
        (Array.isArray(o.tool_calls) || "injected" in o)) ||
      (o.role === "tool" && typeof o.tool_call_id === "string"),
    releve: (o, acc, { mcp }) => {
      if (o.role === "assistant") {
        acc.tours = (acc.tours ?? 0) + 1;
        acc.vu = true;
        for (const c of o.tool_calls ?? []) {
          if (String(c?.function?.name ?? "").startsWith(`${mcp}`))
            acc.mcpCalls += 1;
        }
      }
      // Ni durée ni coût dans son flux : rien à renseigner, et surtout pas un
      // zéro qui se lirait comme une mesure.
    },
    gestes: (o, seq) => {
      const out = [];
      if (o.role === "assistant") {
        if (typeof o.content === "string" && o.content)
          out.push({
            seq,
            t: null,
            nature: "parole",
            id: null,
            outil: null,
            arg: "",
            texte: o.content,
            ok: null,
          });
        for (const c of o.tool_calls ?? [])
          out.push({
            seq,
            t: null,
            nature: "appel",
            id: c?.id ?? null,
            outil: c?.function?.name ?? null,
            arg: argSaillant(c?.function?.arguments),
            texte: "",
            ok: null,
          });
      } else if (o.role === "tool") {
        const texte = txt(o.content);
        out.push({
          seq,
          t: null,
          nature: "retour",
          id: o.tool_call_id ?? null,
          outil: o.name ?? null,
          arg: "",
          texte,
          // `<tool_error>` est SA façon de dire l'échec — le seul signal de
          // statut qu'il émette.
          ok: texte.startsWith("<tool_error>") ? false : null,
        });
      } else if (o.role === "user") {
        out.push({
          seq,
          t: null,
          nature: "user",
          id: null,
          outil: null,
          arg: "",
          texte: txt(o.content),
          ok: null,
        });
      }
      return out;
    },
  },

  {
    nom: "codex",
    cli: "codex exec --json --skip-git-repo-check --approve-for-me",
    // Ses items d'exécution n'ont pas été observés en main : on lit ses tours
    // et ses appels MCP, on ne devine pas le reste.
    timeline: "non observée",
    reconnait: (o) =>
      o.type === "turn.completed" ||
      (o.type === "item.completed" && !!o.item?.type),
    releve: (o, acc) => {
      if (o.type === "turn.completed") {
        acc.tours = (acc.tours ?? 0) + 1;
        acc.vu = true;
      }
      // Un item est répété au fil de son cycle (`item.started` puis
      // `item.completed`) : ne compter que l'achèvement, sinon un appel vaut
      // deux.
      if (o.type === "item.completed" && o.item?.type === "mcp_tool_call")
        acc.mcpCalls += 1;
    },
    gestes: () => [],
  },

  {
    nom: "gemini",
    cli: "gemini --skip-trust -y -o stream-json -p",
    // Ses appels sont lisibles, leurs retours ne l'ont pas été : la timeline
    // porte les gestes sans leurs sorties, et le dit.
    timeline: "partielle",
    reconnait: (o) =>
      (o.type === "tool_use" && typeof o.tool_name === "string") ||
      (o.type === "result" && !!o.stats),
    releve: (o, acc, { mcp }) => {
      if (o.type === "result" && o.stats && typeof o.stats === "object") {
        // Sa durée est mesurée par LUI — ce qui vaut mieux que de la
        // chronométrer du dehors, où le boot de la CLI entrerait dans le
        // compte. Il n'émet en revanche aucun `num_turns`.
        if (typeof o.stats.duration_ms === "number")
          acc.dureeMs = (acc.dureeMs ?? 0) + o.stats.duration_ms;
        acc.vu = true;
      }
      if (
        o.type === "tool_use" &&
        String(o.tool_name ?? "").startsWith(`${mcp}_`)
      )
        acc.mcpCalls += 1;
    },
    gestes: (o, seq) =>
      o.type === "tool_use"
        ? [
            {
              seq,
              t: null,
              nature: "appel",
              id: o.call_id ?? null,
              outil: o.tool_name ?? null,
              arg: argSaillant(o.args ?? o.input),
              texte: "",
              ok: null,
            },
          ]
        : [],
  },

  {
    // Antigravity (`agy`) — sa clé d'enveloppe est `event`, pas `type`.
    //
    // 🛑 Il N'EST PAS une cible du banc, décision prise : l'authentifier
    // exigerait d'écrire la VALEUR d'un jeton en clair dans son foyer, quand
    // la table du cœur ne transporte que le NOM de la variable. Ce qui reste
    // ici est la seule chose qui vaille — savoir LIRE sa grammaire : un
    // transcript `agy` illisible rendrait « 0 tour, 0 appel MCP », le
    // diagnostic faux que ce compteur existe pour ne plus produire.
    nom: "agy",
    cli: "agy (antigravity) — hors cible du banc",
    timeline: "non observée",
    reconnait: (o) => o.event === "result" || o.event === "step_update",
    releve: (o, acc) => {
      if (o.event === "result" && o.result) {
        if (typeof o.result.num_turns === "number")
          acc.tours = (acc.tours ?? 0) + o.result.num_turns;
        // Durée en SECONDES chez lui, contrairement à tous les autres.
        if (typeof o.result.duration_seconds === "number")
          acc.dureeMs =
            (acc.dureeMs ?? 0) + Math.round(o.result.duration_seconds * 1000);
        acc.vu = true;
      }
    },
    gestes: () => [],
  },
];

/** La table, indexée par nom — pour qui sait déjà à qui il parle. */
export const PAR_NOM = Object.fromEntries(DIALECTES.map((d) => [d.nom, d]));

// ───────────────────────────────────────────────────────────────────────────
//  §4 — Reconnaissance
// ───────────────────────────────────────────────────────────────────────────

/**
 * Le dialecte d'un transcript, reconnu au CONTENU.
 *
 * Vote majoritaire sur les premières lignes plutôt que sur la première : un
 * journal commence souvent par des lignes de session qu'aucune grammaire ne
 * revendique, et plusieurs grammaires peuvent voter sur une même ligne
 * ambiguë. Le vote rend aussi l'écart entre le vainqueur et le suivant, qui
 * dit si la reconnaissance était FRANCHE — un écart faible est un avertissement
 * à afficher, pas un détail.
 *
 * @param {string} texte
 * @param {{echantillon?: number}} [opts] - lignes examinées (défaut : toutes).
 * @returns {{nom: string, votes: Record<string, number>, franc: boolean}|null}
 */
export function detecterDialecte(texte, opts = {}) {
  const objets = objetsJsonl(texte);
  const lot = opts.echantillon ? objets.slice(0, opts.echantillon) : objets;
  /** @type {Record<string, number>} */
  const votes = {};
  for (const { o } of lot) {
    for (const d of DIALECTES) {
      try {
        if (d.reconnait(o)) votes[d.nom] = (votes[d.nom] ?? 0) + 1;
      } catch {
        /* une grammaire ne doit jamais faire tomber la reconnaissance */
      }
    }
  }
  const classement = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  if (classement.length === 0) return null;
  const [nom, n] = classement[0];
  const suivant = classement[1]?.[1] ?? 0;
  return { nom, votes, franc: n >= Math.max(3, suivant * 2) };
}

// ───────────────────────────────────────────────────────────────────────────
//  §5 — Relevé d'effort
// ───────────────────────────────────────────────────────────────────────────

/**
 * Tours, durée, coût et appels MCP d'un transcript.
 *
 * 🔴 **Un champ `null` veut dire « l'agent ne l'émet pas », jamais « zéro ».**
 * La distinction n'est pas cosmétique : un rapport qui affiche « 0,00 $ » pour
 * Codex laisserait croire qu'un run n'a rien coûté, et surtout il se
 * comparerait à un run Claude — deux mesures que rien ne relie.
 *
 * @param {string} texte - le JSONL brut.
 * @param {{dialecte?: string, mcp?: string}} [opts]
 * @returns {Releve|null} `null` si rien n'a été observé — ni tour, ni appel.
 */
export function lireReleve(texte, opts = {}) {
  const nom = opts.dialecte ?? detecterDialecte(texte)?.nom ?? null;
  if (!nom || !PAR_NOM[nom]) return null;
  const d = PAR_NOM[nom];
  const mcp = opts.mcp ?? MCP_SERVEUR_DEFAUT;
  /** @type {Releve & {_t0?: number, _t1?: number}} */
  const acc = {
    dialecte: nom,
    tours: null,
    dureeMs: null,
    coutUsd: null,
    mcpCalls: 0,
    vu: false,
  };
  for (const { o } of objetsJsonl(texte)) {
    try {
      d.releve(o, acc, { mcp });
    } catch {
      /* une ligne inattendue ne fait pas tomber le relevé */
    }
  }
  // Durée déduite des bornes (Copilot) : posée seulement si la grammaire n'en
  // a publié aucune, pour qu'une durée ÉMISE l'emporte toujours.
  if (acc.dureeMs == null && acc._t0 != null && acc._t1 != null)
    acc.dureeMs = acc._t1 - acc._t0;
  delete acc._t0;
  delete acc._t1;
  // Un appel MCP compté EST une observation, et il vaut à lui seul un relevé :
  // un agent tué après son premier outil n'émet aucun tour achevé, et un
  // rapport dirait « aucun appel MCP » d'un agent qui venait de s'en servir.
  return acc.vu || acc.mcpCalls > 0 ? acc : null;
}

// ───────────────────────────────────────────────────────────────────────────
//  §6 — Déroulé apparié
// ───────────────────────────────────────────────────────────────────────────

/**
 * Le DÉROULÉ d'un run : chaque geste avec la sortie qu'il a rendue.
 *
 * L'appariement se fait par l'identifiant d'appel du harness, jamais par
 * proximité : les agents lancent des outils en parallèle, et apparier « le
 * retour suivant » attribuerait la sortie d'une commande à une autre — une
 * timeline fausse qui se lit exactement comme une vraie. Un appel sans retour
 * reste dans la liste, sortie vide : c'est le cas de l'agent coupé en vol, et
 * c'est une information.
 *
 * @param {string} texte
 * @param {{dialecte?: string, garderParole?: boolean}} [opts]
 * @returns {{dialecte: string, timeline: string, pas: Pas[], paroles: Geste[]}|null}
 */
export function lireTimeline(texte, opts = {}) {
  const nom = opts.dialecte ?? detecterDialecte(texte)?.nom ?? null;
  if (!nom || !PAR_NOM[nom]) return null;
  const d = PAR_NOM[nom];
  /** @type {Geste[]} */
  const gestes = [];
  let seq = 0;
  for (const { o } of objetsJsonl(texte)) {
    try {
      for (const g of d.gestes(o, seq)) {
        gestes.push(g);
        seq += 1;
      }
    } catch {
      /* idem : une ligne inattendue ne fait pas tomber le déroulé */
    }
  }
  /** @type {Map<string, Geste>} */
  const retours = new Map();
  for (const g of gestes)
    if (g.nature === "retour" && g.id) retours.set(g.id, g);
  /** @type {Pas[]} */
  const pas = [];
  for (const g of gestes) {
    if (g.nature !== "appel") continue;
    const r = g.id ? retours.get(g.id) : undefined;
    const sortie = r?.texte ?? "";
    pas.push({
      seq: g.seq,
      t: g.t,
      outil: g.outil,
      arg: g.arg,
      sortie,
      exit: exitDansTexte(sortie),
      ok: r?.ok ?? null,
    });
  }
  return {
    dialecte: nom,
    timeline: d.timeline,
    pas,
    paroles: opts.garderParole
      ? gestes.filter((g) => g.nature === "parole" || g.nature === "user")
      : gestes.filter((g) => g.nature === "user"),
  };
}
