import type { IAuditEventDraft } from "../../contracts/IAuditEvent";

/** Réglages de l'agrégation des refus (section `security.audit.aggregate`). */
export interface IAuditAggregateOptions {
  /** Durée d'une fenêtre, en ms, ouverte au premier refus d'une clé. */
  windowMs: number;
  /** Refus d'une clé écrits tels quels par fenêtre ; les suivants sont comptés. */
  burst: number;
  /** Clés suivies au plus ; au-delà, les refus se regroupent sans l'IP. */
  maxKeys: number;
}

/** IP de la clé de repli, quand `maxKeys` est atteint. */
const OVERFLOW_IP = "*";
const SEP = "\u0001";

/**
 * Une clé suivie : le gabarit de la ligne de synthèse et les compteurs de la
 * fenêtre en cours. Champs déclarés au constructeur (forme stable).
 */
class RefusalBucket {
  start: number;
  count = 0;
  suppressed = 0;
  firstSuppressed = 0;
  lastSuppressed = 0;
  readonly category: IAuditEventDraft["category"];
  readonly action: string;
  readonly outcome: IAuditEventDraft["outcome"];
  readonly resource: string | null;
  readonly reason: string | null;
  readonly ip: string | null;

  constructor(draft: IAuditEventDraft, ip: string | null, now: number) {
    this.start = now;
    this.category = draft.category;
    this.action = draft.action;
    this.outcome = draft.outcome;
    this.resource = draft.resource ?? null;
    this.reason = draft.reason ?? null;
    this.ip = ip;
  }
}

/**
 * Agrège les REFUS du journal d'audit par source, pour qu'un flot ne se paie pas
 * d'une ligne par requête (OWASP Logging Cheat Sheet : la journalisation ne doit
 * pas épuiser les ressources ni le journal de la base).
 *
 * Clé : catégorie, action, motif, ressource et IP — l'IP résolue par le contexte
 * (`trustProxy`), donc non forgeable par le client. L'acteur n'entre PAS dans la
 * clé : un bourrage d'identifiants change d'acteur à chaque essai, c'est sa
 * source qui le trahit.
 *
 * Par clé et par fenêtre (ouverte au premier refus) : les `burst` premiers refus
 * sont écrits tels quels — l'enquêteur voit les premiers essais, acteur compris ;
 * les suivants sont seulement comptés, et la fenêtre close émet UNE ligne de
 * synthèse (`metadata.aggregated`). Mémoire bornée : au-delà de `maxKeys` clés,
 * les refus se regroupent sous l'IP `*`.
 *
 * Pur : l'horloge est passée à chaque appel, la synthèse part par `emit`. Les
 * succès n'y passent jamais (l'appelant les écarte).
 */
export class AuditRefusalAggregator {
  readonly #buckets = new Map<string, RefusalBucket>();
  readonly #options: IAuditAggregateOptions;
  readonly #emit: (draft: IAuditEventDraft) => void;

  /**
   * @param options - fenêtre, rafale écrite telle quelle, borne de clés.
   * @param emit - écrit une ligne de synthèse dans le journal.
   */
  constructor(
    options: IAuditAggregateOptions,
    emit: (draft: IAuditEventDraft) => void,
  ) {
    this.#options = options;
    this.#emit = emit;
  }

  /** Nombre de clés suivies (fenêtres ouvertes). */
  get size(): number {
    return this.#buckets.size;
  }

  /**
   * Compte un refus.
   *
   * @param draft - l'événement de refus.
   * @param now - horloge, en ms.
   * @returns `true` : l'écrire tel quel ; `false` : il est compté dans la synthèse.
   */
  admit(draft: IAuditEventDraft, now: number): boolean {
    const prefix =
      draft.category +
      SEP +
      draft.action +
      SEP +
      draft.outcome +
      SEP +
      (draft.reason ?? "") +
      SEP +
      (draft.resource ?? "") +
      SEP;
    const ip = draft.ip ?? null;
    let key = prefix + (ip ?? "");
    let bucket = this.#buckets.get(key);
    if (bucket === undefined) {
      let bucketIp = ip;
      if (this.#buckets.size >= this.#options.maxKeys) {
        key = prefix + OVERFLOW_IP;
        bucketIp = OVERFLOW_IP;
        bucket = this.#buckets.get(key);
      }
      if (bucket === undefined) {
        bucket = new RefusalBucket(draft, bucketIp, now);
        this.#buckets.set(key, bucket);
      }
    }
    if (now - bucket.start >= this.#options.windowMs) {
      this.#close(bucket);
      bucket.start = now;
      bucket.count = 0;
      bucket.suppressed = 0;
    }
    bucket.count += 1;
    if (bucket.count <= this.#options.burst) return true;
    if (bucket.suppressed === 0) bucket.firstSuppressed = now;
    bucket.suppressed += 1;
    bucket.lastSuppressed = now;
    return false;
  }

  /**
   * Ferme les fenêtres échues : émet leur synthèse et libère leurs clés.
   *
   * @param now - horloge, en ms.
   */
  sweep(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (now - bucket.start < this.#options.windowMs) continue;
      this.#close(bucket);
      this.#buckets.delete(key);
    }
  }

  /** Émet la synthèse de toutes les fenêtres ouvertes (arrêt) et vide la table. */
  flush(): void {
    for (const bucket of this.#buckets.values()) this.#close(bucket);
    this.#buckets.clear();
  }

  #close(bucket: RefusalBucket): void {
    if (bucket.suppressed === 0) return;
    this.#emit({
      category: bucket.category,
      action: bucket.action,
      outcome: bucket.outcome,
      actor: null,
      resource: bucket.resource,
      reason: bucket.reason,
      ip: bucket.ip,
      metadata: {
        aggregated: {
          count: bucket.suppressed,
          firstTs: bucket.firstSuppressed,
          lastTs: bucket.lastSuppressed,
          windowMs: this.#options.windowMs,
        },
      },
    });
  }
}
