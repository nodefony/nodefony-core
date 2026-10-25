/**
 * **Coup d'œil sur la configuration** — PUR (0 JSX), testé sans navigateur.
 *
 * Sur six cents réglages, une poignée décide de ce qu'on regarde d'abord devant
 * un déploiement : où l'application écoute, comment elle est protégée, et ce que
 * l'environnement a changé. Ce modèle les extrait de l'index de recherche (aucune
 * requête de plus), les nomme EN CLAIR, met leurs valeurs en forme (`900` →
 * « 15 min ») et porte un **verdict** sur chaque verrou de sécurité. Un réglage
 * absent de l'application n'apparaît simplement pas.
 *
 * Les verdicts sont des règles simples et dites : ils signalent ce qui mérite un
 * second regard, ils ne remplacent pas un audit.
 */
import type { ConfigSearchDoc } from "./configSearchEngine";

/** Niveau d'un verdict : en place, à vérifier, ou simple information. */
export type VerdictLevel = "ok" | "warn" | "info";

export interface Verdict {
  level: VerdictLevel;
  text: string;
}

/** Valeur mise en forme pour l'affichage. */
export type EssentialDisplay =
  | { kind: "bool"; on: boolean }
  | { kind: "list"; items: string[] }
  | { kind: "text"; text: string };

/** Une ligne du coup d'œil. */
export interface EssentialItem {
  doc: ConfigSearchDoc;
  /** Ce que règle la tuile, en quelques mots (le détail vit dans sa bulle ⓘ). */
  label: string;
  display: EssentialDisplay;
  verdict: Verdict | null;
}

/** Une adresse d'écoute, composée du domaine et d'un port. */
export interface Endpoint {
  /** `HTTP`, `HTTPS`, `HTTP/2 en clair`. */
  label: string;
  url: string;
  /** Écoute sur toutes les interfaces (`0.0.0.0`, `::`) : l'URL n'est pas à ouvrir telle quelle. */
  allInterfaces: boolean;
  /** Réglage du port (cible du clic). */
  doc: ConfigSearchDoc;
}

/** Contexte des verdicts : un même réglage ne se juge pas pareil en production. */
export interface GlanceContext {
  production: boolean;
}

/** Le coup d'œil complet. */
export interface GlanceView {
  endpoints: Endpoint[];
  network: EssentialItem[];
  security: EssentialItem[];
  env: EssentialItem[];
  /** Comptes des verdicts de sécurité. */
  summary: { ok: number; warn: number };
}

type Format = "auto" | "duration-s" | "list";

interface IRule {
  /** `"app"` pour le noyau, sinon le nom du paquet (`@nodefony/http`). */
  module: string;
  key: RegExp;
  label: string;
  format?: Format;
  check?: (value: unknown, ctx: GlanceContext) => Verdict | null;
}

// ── Mise en forme ────────────────────────────────────────────────────────────

const UNITS: readonly [number, string][] = [
  [86_400, "j"],
  [3_600, "h"],
  [60, "min"],
];

/**
 * Durée en secondes → texte lisible, dans la plus grande unité qui tombe juste.
 *
 * @example formatDurationS(900) // "15 min"
 * @example formatDurationS(604800) // "7 j"
 * @example formatDurationS(90) // "90 s"
 */
export function formatDurationS(s: number): string {
  if (s === 0) return "0 (désactivé)";
  for (const [size, unit] of UNITS) {
    if (s >= size && s % size === 0) return `${s / size} ${unit}`;
  }
  return `${s} s`;
}

function textOf(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "aucun";
  if (typeof v === "string") return v === "" ? "(vide)" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "—";
  }
}

/** Met une valeur en forme selon le format de la règle. */
export function displayOf(
  doc: ConfigSearchDoc,
  format: Format,
): EssentialDisplay {
  if (doc.field.secret) return { kind: "text", text: "•••••" };
  const v = doc.value;
  if (typeof v === "boolean") return { kind: "bool", on: v };
  if (format === "duration-s" && typeof v === "number") {
    return { kind: "text", text: formatDurationS(v) };
  }
  if (Array.isArray(v)) {
    return { kind: "list", items: v.map((x) => textOf(x)) };
  }
  return { kind: "text", text: textOf(v) };
}

// ── Règles ───────────────────────────────────────────────────────────────────

const on = (v: unknown): boolean => v === true;

const NETWORK: readonly IRule[] = [
  { module: "app", key: /^domain$/, label: "Domaine" },
  {
    module: "app",
    key: /^domainAlias$/,
    label: "Autres domaines",
    format: "list",
  },
  {
    module: "@nodefony/http",
    key: /^trustProxy$/,
    label: "Proxy de confiance",
    check: (v) =>
      v === false
        ? {
            level: "info",
            text: "Non : l'adresse vue est celle du client qui se connecte.",
          }
        : {
            level: "info",
            text: "Oui : les en-têtes X-Forwarded-* du proxy sont crus.",
          },
  },
  {
    module: "@nodefony/http",
    key: /^trustedHosts$/,
    label: "Hôtes acceptés",
    format: "list",
  },
];

const SECURITY: readonly IRule[] = [
  {
    module: "@nodefony/http",
    key: /^session\.cookie\.secure$/,
    label: "Cookie de session HTTPS",
    check: (v) =>
      on(v)
        ? { level: "ok", text: "Il ne circule jamais en clair." }
        : {
            level: "warn",
            text: "Il peut circuler en clair sur HTTP : volable sur le réseau.",
          },
  },
  {
    module: "@nodefony/http",
    key: /^session\.idleTimeoutS$/,
    label: "Inactivité max.",
    format: "duration-s",
    check: (v) =>
      typeof v === "number" && (v === 0 || v > 86_400)
        ? {
            level: "warn",
            text: "Une session abandonnée reste ouverte longtemps.",
          }
        : { level: "ok", text: "Une session oubliée se ferme d'elle-même." },
  },
  {
    module: "@nodefony/security",
    key: /^csrf\.enabled$/,
    label: "Protection CSRF",
    check: (v) =>
      on(v)
        ? {
            level: "ok",
            text: "Un autre site ne peut pas agir à la place de l'utilisateur.",
          }
        : {
            level: "warn",
            text: "Coupée : un autre site peut déclencher des actions au nom de l'utilisateur connecté.",
          },
  },
  {
    module: "@nodefony/security",
    key: /^csrf\.sameSite$/,
    label: "Cookies SameSite",
    check: (v) =>
      typeof v === "string" && v.toLowerCase() === "none"
        ? {
            level: "warn",
            text: "« None » : les cookies partent aussi depuis les autres sites.",
          }
        : {
            level: "ok",
            text: "Les autres sites ne reçoivent pas les cookies.",
          },
  },
  {
    module: "@nodefony/security",
    key: /^cors\.origins$/,
    label: "Origines CORS",
    format: "list",
    check: (v) =>
      Array.isArray(v) && v.includes("*")
        ? {
            level: "warn",
            text: "« * » : n'importe quel site peut appeler l'API.",
          }
        : null,
  },
  {
    // L'en-tête est posé par @nodefony/http, à l'entrée de chaque réponse.
    // `security.headers.hsts` est une clé RÉSERVÉE, sans effet : la juger
    // affichait « en place » sur un verrou qui n'existait pas.
    module: "@nodefony/http",
    key: /^securityHeaders\.strictTransportSecurity(\.maxAge)?$/,
    label: "HTTPS imposé (HSTS)",
    format: "duration-s",
    check: (v, ctx) =>
      typeof v === "number" && v > 0
        ? { level: "ok", text: "Le navigateur refusera de revenir en HTTP." }
        : ctx.production
          ? {
              level: "warn",
              text: "Absent en production : une première visite peut passer en clair.",
            }
          : {
              level: "info",
              text: "Absent — sans conséquence en développement.",
            },
  },
  {
    module: "@nodefony/security",
    key: /^rateLimit\.enabled$/,
    label: "Anti force brute",
    check: (v) =>
      on(v)
        ? {
            level: "ok",
            text: "Deviner un mot de passe par essais répétés est ralenti.",
          }
        : {
            level: "warn",
            text: "Coupé : rien ne ralentit qui essaie des mots de passe en boucle.",
          },
  },
  {
    module: "@nodefony/http",
    key: /^rateLimit\.enabled$/,
    label: "Limite de requêtes",
    check: (v, ctx) =>
      on(v)
        ? { level: "ok", text: "Un client trop bavard est freiné." }
        : ctx.production
          ? {
              level: "warn",
              text: "Coupée en production : un seul client peut saturer le serveur.",
            }
          : { level: "info", text: "Coupée — habituel en développement." },
  },
  {
    module: "@nodefony/security",
    key: /^jwt\.accessTtlS$/,
    label: "Jeton d'accès",
    format: "duration-s",
    check: (v) =>
      typeof v === "number" && v > 3_600
        ? {
            level: "warn",
            text: "Plus d'une heure : un jeton volé reste utilisable longtemps.",
          }
        : { level: "ok", text: "Courte : un jeton volé expire vite." },
  },
  {
    module: "@nodefony/security",
    key: /^jwt\.refreshTtlS$/,
    label: "Jeton de rafraîchissement",
    format: "duration-s",
  },
];

/** La règle retient-elle ce réglage ? */
function matches(r: IRule, doc: ConfigSearchDoc): boolean {
  return (
    r.module === (doc.isApp ? "app" : doc.moduleName) &&
    r.key.test(doc.field.key)
  );
}

/** Rang de la première règle qui retient ce réglage (-1 : aucune). */
function ruleOf(doc: ConfigSearchDoc, rules: readonly IRule[]): number {
  return rules.findIndex((r) => matches(r, doc));
}

/**
 * Juge un réglage. Une clé RÉSERVÉE n'est jamais jugée sur sa valeur : elle n'a
 * aucun effet, et la croire « en place » serait le pire des faux verts. Un
 * secret non plus : sa valeur n'est jamais lue.
 */
function judge(
  doc: ConfigSearchDoc,
  rule: IRule | undefined,
  ctx: GlanceContext,
): Verdict | null {
  if (doc.field.reserved) {
    return {
      level: "info",
      text: "Clé réservée : posée, elle n'a aucun effet aujourd'hui.",
    };
  }
  if (!rule?.check || doc.field.secret) return null;
  return rule.check(doc.value, ctx);
}

function itemsFor(
  index: readonly ConfigSearchDoc[],
  rules: readonly IRule[],
  ctx: GlanceContext,
): EssentialItem[] {
  return index
    .filter((doc) => !doc.field.reserved)
    .map((doc) => ({ doc, r: ruleOf(doc, rules) }))
    .filter(({ r }) => r >= 0)
    .sort((a, b) => a.r - b.r)
    .map(({ doc, r }) => {
      const rule = rules[r];
      return {
        doc,
        label: rule?.label ?? doc.field.key,
        display: displayOf(doc, rule?.format ?? "auto"),
        verdict: judge(doc, rule, ctx),
      };
    });
}

/** Emplacement lisible d'un réglage (`security › csrf.enabled`, `noyau › domain`). */
export function locationOf(doc: ConfigSearchDoc): string {
  return doc.isApp
    ? `noyau › ${doc.field.key}`
    : `${doc.moduleName.replace(/^@nodefony\//, "")} › ${doc.field.key}`;
}

/** Adresses d'écoute : le domaine composé avec chaque port déclaré et allumé. */
function endpointsOf(index: readonly ConfigSearchDoc[]): Endpoint[] {
  const app = index.filter((d) => d.isApp);
  const get = (k: string) => app.find((d) => d.field.key === k);
  const domain = get("domain")?.value;
  const host = typeof domain === "string" && domain ? domain : "localhost";
  const allInterfaces = host === "0.0.0.0" || host === "::";
  const out: Endpoint[] = [];
  const add = (label: string, scheme: string, server: string) => {
    const port = get(`servers.${server}.port`);
    if (!port || typeof port.value !== "number") return;
    if (get(`servers.${server}.enabled`)?.value === false) return;
    out.push({
      label,
      url: `${scheme}://${host}:${port.value}`,
      allInterfaces,
      doc: port,
    });
  };
  add("HTTP", "http", "http");
  add("HTTPS", "https", "https");
  add("HTTP/2 en clair", "http", "h2c");
  return out;
}

/**
 * Compose le coup d'œil : adresses d'écoute, réseau, verrous de sécurité avec
 * leur verdict, et réglages que l'environnement a changés.
 *
 * @param index - index de recherche de la page (`buildConfigSearchIndex`).
 * @param ctx - contexte des verdicts (mode production ou non).
 * @returns la vue, groupes toujours présents (éventuellement vides).
 */
export function buildGlance(
  index: readonly ConfigSearchDoc[],
  ctx: GlanceContext,
): GlanceView {
  const security = itemsFor(index, SECURITY, ctx);
  return {
    endpoints: endpointsOf(index),
    network: itemsFor(index, NETWORK, ctx),
    security,
    // Une variable posée qui touche un verrou porte le MÊME verdict que la
    // colonne Sécurité : c'est souvent là qu'un déploiement a coupé quelque
    // chose sans le savoir. Les points à vérifier remontent en tête.
    env: index
      .filter((d) => d.field.source === "env")
      .map((doc): EssentialItem => {
        const rule = [...SECURITY, ...NETWORK].find((r) => matches(r, doc));
        return {
          doc,
          label: rule?.label ?? locationOf(doc),
          display: displayOf(doc, rule?.format ?? "auto"),
          verdict: judge(doc, rule, ctx),
        };
      })
      .sort(
        (a, b) =>
          Number(b.verdict?.level === "warn") -
          Number(a.verdict?.level === "warn"),
      ),
    summary: {
      ok: security.filter((i) => i.verdict?.level === "ok").length,
      warn: security.filter((i) => i.verdict?.level === "warn").length,
    },
  };
}
