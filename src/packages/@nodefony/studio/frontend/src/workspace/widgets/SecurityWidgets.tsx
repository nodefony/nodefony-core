/**
 * Blocs « Sécurité » du catalogue de bureau. Catégorie `security` → visibilité
 * par défaut = administrateur Nodefony (cf `CATEGORY_ROLES` dans `registry.ts`).
 *
 * Réutilise les **types miroir** de la console auditeur (`routes/audit/auditModel`)
 * — même contrat JSON que la page Audit, jamais d'import du code serveur
 * (`@nodefony/security`). Source de vérité serveur :
 * `GET /nodefony/security/api/audit/events` (RBAC admin — le data plane referme
 * de toute façon, le filtrage du catalogue n'est qu'un confort d'affichage).
 */
import { Badge, Group, Stack, Text } from "@mantine/core";
import { IconShieldLock } from "@tabler/icons-react";
import { registerWidget } from "../registry";
import type { WidgetRenderProps } from "../types";
import {
  AUDIT_OUTCOMES,
  type AuditEvent,
  type AuditOutcome,
  type AuditQueryResult,
} from "../../routes/audit/auditModel";
import { BigMetric } from "./_kit";

/** Snapshot : les 100 derniers événements + le total (hors pagination). */
const AUDIT_EVENTS = "/nodefony/security/api/audit/events?limit=100";

/** Teinte Mantine d'une issue (réutilise la table de la console auditeur). */
function outcomeColor(o: AuditOutcome): string {
  return AUDIT_OUTCOMES.find((x) => x.value === o)?.color ?? "gray";
}

function AuditBody({ source }: WidgetRenderProps<AuditQueryResult>) {
  const data = source.data;
  if (!data) return null;
  const events = data.events ?? [];
  // Refus / échecs comptés sur la fenêtre chargée (les 100 derniers) — un refus
  // (`denied`) est le signal d'alerte auditeur, mis en rouge.
  const denied = events.filter((e) => e.outcome === "denied").length;
  const failed = events.filter((e) => e.outcome === "failure").length;
  return (
    <Stack gap="sm">
      <Group gap="xl" wrap="nowrap" align="flex-start">
        <BigMetric label="Événements" value={data.total} color="grape" />
        <BigMetric
          label="Refus"
          value={denied}
          color={denied > 0 ? "red" : "teal"}
          sub={`${failed} échec(s) récents`}
        />
      </Group>
      <Stack gap={4}>
        {events.slice(0, 5).map((e: AuditEvent) => (
          <Group key={e.id} justify="space-between" wrap="nowrap" gap="xs">
            <Text size="xs" ff="monospace" truncate style={{ minWidth: 0 }}>
              {e.action}
            </Text>
            <Badge size="xs" variant="light" color={outcomeColor(e.outcome)}>
              {e.outcome}
            </Badge>
          </Group>
        ))}
        {events.length === 0 ? (
          <Text size="xs" c="dimmed">
            Aucun événement d'audit sur la fenêtre.
          </Text>
        ) : null}
      </Stack>
    </Stack>
  );
}

registerWidget<AuditQueryResult>({
  id: "security.audit",
  title: "Activité de sécurité",
  description:
    "Journal d'audit : volume d'événements + refus récents (auth, RBAC, CSRF, WS…).",
  category: "security",
  icon: IconShieldLock,
  tags: ["securite", "kpi", "liste"],
  source: { kind: "snapshot", endpoint: AUDIT_EVENTS },
  defaultSpan: 5,
  minSpan: 4,
  render: AuditBody,
});
