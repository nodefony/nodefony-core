/**
 * Section **Zones de sécurité** de la console Firewall — LE cœur (« quelles URL
 * sont protégées, et comment ? »). Table des `SecuredArea` montées + fiche détail
 * (Modal centré, jamais drawer). Données issues de `GET .../api/firewall`.
 */
import { useMemo, useState } from "react";
import {
  Stack,
  Group,
  Code,
  Text,
  Modal,
  Badge,
  Alert,
  Box,
} from "@mantine/core";
import { IconShieldOff, IconInfoCircle } from "@tabler/icons-react";

import { DataGrid, DocHint, type DataGridColumn } from "../../components/ui";
import { FIREWALL_DOC, type FirewallZone } from "./firewallModel";
import {
  ZoneSecurityBadge,
  StatelessBadge,
  ModeBadge,
  AuthenticatorChip,
} from "./firewallFormat";

/** Une ligne label → valeur (la valeur peut être un nœud riche : badge…). */
function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xl" align="flex-start">
      <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
        {k}
      </Text>
      <Box style={{ textAlign: "right", minWidth: 0 }}>{children}</Box>
    </Group>
  );
}

/** Liste de chips d'authenticators (ou « aucun »). */
function AuthChips({ names }: { names: string[] }) {
  if (names.length === 0) {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        aucun
      </Text>
    );
  }
  return (
    <Group gap={4} justify="flex-end" wrap="wrap">
      {names.map((n) => (
        <AuthenticatorChip key={n} name={n} />
      ))}
    </Group>
  );
}

export function FirewallZones({ zones }: { zones: FirewallZone[] }) {
  const [selected, setSelected] = useState<FirewallZone | null>(null);

  const columns = useMemo<DataGridColumn<FirewallZone>[]>(
    () => [
      {
        key: "name",
        header: "Zone",
        sortable: true,
        value: (r) => r.name,
        render: (r) => (
          <Text fw={600} size="sm">
            {r.name}
          </Text>
        ),
        size: 160,
      },
      {
        key: "pattern",
        header: "Pattern d'URL",
        value: (r) => r.pattern,
        render: (r) => <Code>{r.pattern}</Code>,
        size: 230,
      },
      {
        key: "host",
        header: "Hôte",
        value: (r) => r.host ?? "",
        render: (r) =>
          r.host ? (
            <Code>{r.host}</Code>
          ) : (
            <Text size="sm" c="dimmed">
              tous
            </Text>
          ),
        size: 130,
      },
      {
        key: "security",
        header: "Accès",
        filterable: true,
        filterType: "select",
        value: (r) => (r.security ? "Protégée" : "Publique"),
        render: (r) => <ZoneSecurityBadge security={r.security} />,
        size: 120,
      },
      {
        key: "mode",
        header: "Mode",
        filterable: true,
        filterType: "select",
        value: (r) => r.mode,
        render: (r) => <ModeBadge mode={r.mode} />,
        size: 110,
      },
      {
        key: "identity",
        header: "Identité",
        value: (r) => (r.stateless ? "Stateless" : "Session BFF"),
        render: (r) => <StatelessBadge stateless={r.stateless} />,
        size: 130,
      },
      {
        key: "authenticators",
        header: "Authenticators",
        value: (r) => r.authenticators.join(", "),
        render: (r) => <AuthChips names={r.authenticators} />,
        size: 260,
      },
      {
        key: "realtime",
        header: "WS",
        align: "right",
        value: (r) => (r.realtime ? "1" : "0"),
        render: (r) => (
          <Badge
            variant="dot"
            color={r.realtime ? "teal" : "gray"}
            style={{ textTransform: "none" }}
          >
            {r.realtime ? "oui" : "non"}
          </Badge>
        ),
        size: 90,
      },
    ],
    [],
  );

  return (
    <Stack gap="md">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          {zones.length} zone(s) montée(s), triées par spécificité (pattern le
          plus long d'abord).
        </Text>
        <DocHint
          title="Zones de sécurité (SecuredArea)"
          version={FIREWALL_DOC}
          summary="Une zone = un pattern d'URL + sa chaîne d'authenticators. Le firewall teste les zones par spécificité ; la première dont le pattern matche capture la requête."
          sections={[
            {
              label: "Comment lire",
              body: "« Protégée » = Zero Trust (preuve requise, 401 sinon). « Publique » = accès libre explicite. Le mode décrit la chaîne d'authenticators (first = le premier qui reconnaît ; all = MFA).",
            },
            {
              label: "WebSocket",
              body: "« WS oui » = la zone gouverne AUSSI les frames temps réel (api.request + subscribe) : invariant api.request {path} ≤ GET {path}.",
            },
            {
              label: "Si vide",
              body: "Aucune zone = aucune URL protégée (le firewall court-circuite, 0 coût). Déclaration via defineSecurityConfig({ areas }).",
            },
          ]}
        />
      </Group>

      {zones.length === 0 && (
        <Alert
          variant="light"
          color="orange"
          icon={<IconShieldOff size={18} />}
          title="Aucune zone configurée"
        >
          Aucune zone de sécurité n'est montée : le firewall laisse passer
          toutes les requêtes (court-circuit hot-path). Déclarez des zones via{" "}
          <Code>defineSecurityConfig(&#123; areas &#125;)</Code>.
        </Alert>
      )}

      <DataGrid
        mode="client"
        data={zones}
        columns={columns}
        getRowId={(r) => r.name}
        onRowClick={(r) => setSelected(r)}
        initialSort={{ key: "name", dir: "asc" }}
        searchable
        searchPlaceholder="Rechercher une zone (nom, pattern, hôte…)"
        pageSize={25}
        height={460}
        persist={{ key: "studio.firewall.zones", storage: "session" }}
        emptyMessage="Aucune zone."
      />

      <Modal
        opened={selected !== null}
        onClose={() => setSelected(null)}
        title={
          selected ? (
            <Group gap="xs">
              <Text fw={700}>Zone « {selected.name} »</Text>
              <ZoneSecurityBadge security={selected.security} />
            </Group>
          ) : (
            ""
          )
        }
        centered
        size="lg"
      >
        {selected && (
          <Stack gap="sm">
            <Field k="Pattern d'URL">
              <Code>{selected.pattern}</Code>
            </Field>
            <Field k="Hôte / vhost">
              {selected.host ? (
                <Code>{selected.host}</Code>
              ) : (
                <Text size="sm" c="dimmed">
                  tous domaines
                </Text>
              )}
            </Field>
            <Field k="Accès">
              <ZoneSecurityBadge security={selected.security} />
            </Field>
            <Field k="Mode de chaîne">
              <ModeBadge mode={selected.mode} />
            </Field>
            <Field k="Stratégie d'identité">
              <StatelessBadge stateless={selected.stateless} />
            </Field>
            <Field k="Anonyme autorisé">
              <Badge
                variant="light"
                color={selected.allowsAnonymous ? "orange" : "gray"}
                style={{ textTransform: "none" }}
              >
                {selected.allowsAnonymous ? "oui (explicite)" : "non"}
              </Badge>
            </Field>
            <Field k="Frames WebSocket">
              <Badge
                variant="dot"
                color={selected.realtime ? "teal" : "gray"}
                style={{ textTransform: "none" }}
              >
                {selected.realtime ? "gouvernées" : "exclues (HTTP only)"}
              </Badge>
            </Field>
            <Field k="Authenticators">
              <AuthChips names={selected.authenticators} />
            </Field>

            <Alert
              variant="light"
              color="gray"
              icon={<IconInfoCircle size={16} />}
              mt="xs"
            >
              <Text size="xs">
                Ordre d'exécution : les authenticators sont essayés dans l'ordre
                listé. En mode <Code>first</Code>, le premier qui reconnaît la
                requête authentifie ; en mode <Code>all</Code>, tous doivent
                passer (le dernier porte l'identité).
              </Text>
            </Alert>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
