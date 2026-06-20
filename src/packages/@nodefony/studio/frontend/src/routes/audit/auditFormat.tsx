/**
 * Helpers de RENDU de la console auditeur — badges catégorie/issue (icône +
 * couleur + texte, jamais la couleur seule = a11y WCAG), format d'horodatage.
 * Données non maîtrisées (acteur, IP…) rendues en TEXTE, jamais en HTML.
 */
import type { ReactNode } from "react";
import { Badge, Text, Tooltip } from "@mantine/core";
import {
  IconLogin,
  IconShieldCheck,
  IconKey,
  IconClockHour4,
  IconWorldWww,
  IconFingerprint,
  IconShieldLock,
  IconWorld,
  IconPlugConnected,
  IconCheck,
  IconX,
  IconBan,
  type Icon,
} from "@tabler/icons-react";

import {
  AUDIT_CATEGORIES,
  AUDIT_OUTCOMES,
  type AuditCategory,
  type AuditOutcome,
} from "./auditModel";

const CATEGORY_ICON: Record<AuditCategory, Icon> = {
  auth: IconLogin,
  authz: IconShieldCheck,
  token: IconKey,
  session: IconClockHour4,
  oauth: IconWorldWww,
  webauthn: IconFingerprint,
  csrf: IconShieldLock,
  cors: IconWorld,
  ws: IconPlugConnected,
};

const OUTCOME_ICON: Record<AuditOutcome, Icon> = {
  success: IconCheck,
  failure: IconX,
  denied: IconBan,
};

const CATEGORY_META = new Map(AUDIT_CATEGORIES.map((c) => [c.value, c]));
const OUTCOME_META = new Map(AUDIT_OUTCOMES.map((o) => [o.value, o]));

/** Label FR d'une catégorie (ou la valeur brute si inconnue — string ouverte). */
export function categoryLabel(category: string): string {
  return CATEGORY_META.get(category as AuditCategory)?.label ?? category;
}

/** Label FR d'une issue (ou la valeur brute). */
export function outcomeLabel(outcome: string): string {
  return OUTCOME_META.get(outcome as AuditOutcome)?.label ?? outcome;
}

/** Badge de catégorie (icône + teinte + libellé FR). */
export function CategoryBadge({ category }: { category: string }): ReactNode {
  const meta = CATEGORY_META.get(category as AuditCategory);
  const Ico = CATEGORY_ICON[category as AuditCategory] ?? IconShieldCheck;
  return (
    <Badge
      variant="light"
      color={meta?.color ?? "gray"}
      leftSection={<Ico size={12} />}
      style={{ textTransform: "none" }}
    >
      {meta?.label ?? category}
    </Badge>
  );
}

/**
 * Badge d'issue. `denied`/`failure` en variant plein (signal fort), `success`
 * en variant discret (le succès n'est pas un événement à alarmer).
 */
export function OutcomeBadge({ outcome }: { outcome: string }): ReactNode {
  const meta = OUTCOME_META.get(outcome as AuditOutcome);
  const Ico = OUTCOME_ICON[outcome as AuditOutcome] ?? IconCheck;
  const strong = outcome === "denied" || outcome === "failure";
  return (
    <Badge
      variant={strong ? "filled" : "light"}
      color={meta?.color ?? "gray"}
      leftSection={<Ico size={12} />}
      style={{ textTransform: "none" }}
    >
      {meta?.label ?? outcome}
    </Badge>
  );
}

const TIME_FMT = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const DATE_FMT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "medium",
});

/** Heure HH:MM:SS pour le tableau ; date complète au survol (tooltip). */
export function EventTime({ ts }: { ts: number }): ReactNode {
  const d = new Date(ts);
  return (
    <Tooltip label={DATE_FMT.format(d)} openDelay={300} withinPortal>
      <Text size="sm" ff="monospace" style={{ whiteSpace: "nowrap" }}>
        {TIME_FMT.format(d)}
      </Text>
    </Tooltip>
  );
}

/** Date + heure complètes (fiche détail). */
export function formatDateTime(ts: number): string {
  return DATE_FMT.format(new Date(ts));
}

/** Acteur lisible : l'identité, ou « anonyme » en gris si `null`. */
export function ActorText({ actor }: { actor: string | null }): ReactNode {
  if (!actor) {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        anonyme
      </Text>
    );
  }
  return (
    <Text size="sm" ff="monospace">
      {actor}
    </Text>
  );
}
