/**
 * Section **Statistiques d'authentification** de la console Firewall — dérivées
 * du **journal d'audit déjà livré** (P6.14) : la boucle se referme (l'audit
 * alimente les stats du firewall). Comptes exacts côté serveur (`total` par
 * filtre) via `GET .../api/audit/events`. Réutilise les badges de la console
 * d'audit (DRY cross-page).
 */
import { useCallback, useState } from "react";
import { observer } from "mobx-react-lite";
import {
  Stack,
  Grid,
  Group,
  Text,
  SegmentedControl,
  Button,
  Alert,
} from "@mantine/core";
import { Link } from "react-router-dom";
import {
  IconCheck,
  IconX,
  IconBan,
  IconHistory,
  IconInfoCircle,
} from "@tabler/icons-react";

import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import {
  StatCard,
  DataState,
  DataGrid,
  DocHint,
  type DataGridColumn,
} from "../../components/ui";
import {
  AUDIT_ENDPOINT,
  FIREWALL_DOC,
  describeFirewallError,
} from "./firewallModel";
import {
  type AuditEvent,
  type AuditPage,
  type AuditPeriod,
  periodSince,
} from "../audit/auditModel";
import {
  OutcomeBadge,
  EventTime,
  ActorText,
  outcomeLabel,
} from "../audit/auditFormat";

/** Agrégat d'authentification sur la fenêtre choisie. */
interface AuthStats {
  success: number;
  failure: number;
  denied: number;
  recentDenied: AuditEvent[];
}

const PERIODS: { value: AuditPeriod; label: string }[] = [
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 j" },
  { value: "all", label: "Tout" },
];

export const FirewallAuthStats = observer(() => {
  const store = useStore();
  const [period, setPeriod] = useState<AuditPeriod>("7d");

  const fetcher = useCallback(async (): Promise<AuthStats> => {
    const since = periodSince(period, Date.now());
    const sinceQs = since !== undefined ? `&since=${since}` : "";
    const url = (outcome: string, limit: number) =>
      `${AUDIT_ENDPOINT}?category=auth&outcome=${outcome}&limit=${limit}${sinceQs}`;
    try {
      // 3 requêtes parallèles : compteur exact (total filtré) par issue ; la
      // requête « denied » ramène en plus les 20 derniers refus (liste).
      const [success, failure, denied] = await Promise.all([
        store.api.getAbsolute<AuditPage>(url("success", 1)),
        store.api.getAbsolute<AuditPage>(url("failure", 1)),
        store.api.getAbsolute<AuditPage>(url("denied", 20)),
      ]);
      return {
        success: success.total ?? 0,
        failure: failure.total ?? 0,
        denied: denied.total ?? 0,
        recentDenied: denied.items,
      };
    } catch (e) {
      // Message FR honnête (401 mock Studio, 403, 503…) plutôt que le brut.
      throw new Error(describeFirewallError(e));
    }
  }, [store, period]);

  const { data, loading, error, reload } = useResource(fetcher);

  const columns: DataGridColumn<AuditEvent>[] = [
    {
      key: "ts",
      header: "Heure",
      value: (r) => r.ts,
      render: (r) => <EventTime ts={r.ts} />,
      size: 95,
    },
    {
      key: "action",
      header: "Action",
      value: (r) => r.action,
      render: (r) => (
        <Text size="sm" ff="monospace">
          {r.action}
        </Text>
      ),
      size: 160,
    },
    {
      key: "outcome",
      header: "Issue",
      value: (r) => r.outcome,
      render: (r) => <OutcomeBadge outcome={r.outcome} />,
      size: 110,
    },
    {
      key: "actor",
      header: "Acteur",
      value: (r) => r.actor ?? "anonyme",
      render: (r) => <ActorText actor={r.actor} />,
      size: 150,
    },
    {
      key: "reason",
      header: "Raison",
      value: (r) => r.reason ?? "",
      render: (r) => (
        <Text size="sm" ff="monospace" c={r.reason ? undefined : "dimmed"}>
          {r.reason ?? "—"}
        </Text>
      ),
      size: 160,
    },
    {
      key: "resource",
      header: "Zone / ressource",
      value: (r) => r.resource ?? "",
      render: (r) => (
        <Text size="sm" c={r.resource ? undefined : "dimmed"}>
          {r.resource ?? "—"}
        </Text>
      ),
      size: 150,
    },
  ];

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            Événements d'authentification sur la période.
          </Text>
          <DocHint
            title="Statistiques d'authentification"
            version={FIREWALL_DOC}
            summary="Dérivées du journal d'audit de sécurité (catégorie « auth »). La boucle se referme : ce que le firewall journalise alimente ces compteurs."
            sections={[
              {
                label: "Issues",
                body: "Réussites = login validé. Échecs = preuve présentée mais invalide (mot de passe, signature). Refus = Zero Trust (aucune preuve dans une zone protégée).",
              },
              {
                label: "Exactitude",
                body: "Les compteurs sont comptés côté serveur (total exact par filtre, pas un échantillon).",
              },
            ]}
          />
        </Group>
        <Group gap="sm">
          <SegmentedControl
            size="xs"
            value={period}
            onChange={(v) => setPeriod(v as AuditPeriod)}
            data={PERIODS}
          />
          <Button
            component={Link}
            to="/nodefony/audit"
            variant="subtle"
            size="xs"
            leftSection={<IconHistory size={15} />}
          >
            Journal complet
          </Button>
        </Group>
      </Group>

      <DataState loading={loading && !data} error={error} onRetry={reload}>
        <Grid>
          <StatCard
            label="Réussites"
            icon={<IconCheck size={20} color="var(--mantine-color-teal-6)" />}
            hint="Authentifications réussies (login validé) sur la période."
            span={{ base: 12, sm: 4 }}
          >
            <Text
              fz={30}
              fw={700}
              c="teal"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {data?.success ?? "—"}
            </Text>
          </StatCard>
          <StatCard
            label="Échecs"
            icon={<IconX size={20} color="var(--mantine-color-orange-6)" />}
            hint="Credential présenté mais invalide (mot de passe/signature erroné)."
            span={{ base: 12, sm: 4 }}
          >
            <Text
              fz={30}
              fw={700}
              c="orange"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {data?.failure ?? "—"}
            </Text>
          </StatCard>
          <StatCard
            label="Refus (Zero Trust)"
            icon={<IconBan size={20} color="var(--mantine-color-red-6)" />}
            hint="Aucune preuve présentée dans une zone protégée — le signal d'alerte de l'auditeur."
            span={{ base: 12, sm: 4 }}
          >
            <Text
              fz={30}
              fw={700}
              c="red"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {data?.denied ?? "—"}
            </Text>
          </StatCard>
        </Grid>

        <Stack gap="xs" mt="md">
          <Text fw={600} size="sm">
            Derniers refus ({outcomeLabel("denied").toLowerCase()})
          </Text>
          {data && data.recentDenied.length === 0 ? (
            <Alert
              variant="light"
              color="teal"
              icon={<IconInfoCircle size={18} />}
            >
              Aucun refus d'authentification sur la période — rien à signaler.
            </Alert>
          ) : (
            <DataGrid
              mode="client"
              data={data?.recentDenied ?? []}
              columns={columns}
              getRowId={(r) => r.id}
              initialSort={{ key: "ts", dir: "desc" }}
              pageSize={10}
              height={360}
              emptyMessage="Aucun refus."
            />
          )}
        </Stack>
      </DataState>
    </Stack>
  );
});
