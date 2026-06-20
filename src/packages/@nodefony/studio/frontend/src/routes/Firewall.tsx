/**
 * Console **Firewall** (P6.15) — la pièce centrale, la plus pédagogique de la
 * section Sécurité : « quelles URL sont protégées, et comment ? ». Introspection
 * de l'état RUNTIME du firewall de `@nodefony/security` via le data plane
 * `GET /nodefony/security/api/firewall` (+ `/roleHierarchy`, RBAC
 * `ROLE_NODEFONY_ADMIN`). Secrets exclus côté serveur (présence, jamais valeur).
 *
 * 5 onglets (divulgation progressive) : Zones (le cœur) · Authenticators ·
 * Défenses (CSRF/CORS/en-têtes/throttle) · Rôles · Statistiques (dérivées du
 * journal d'audit → la boucle se referme).
 */
import { useCallback, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import {
  Stack,
  Grid,
  Group,
  Tabs,
  Text,
  Badge,
  Button,
  Alert,
  Card,
  ThemeIcon,
} from "@mantine/core";
import {
  IconShieldLock,
  IconShieldCheck,
  IconShieldOff,
  IconRefresh,
  IconRoute,
  IconLogin2,
  IconUsersGroup,
  IconChartBar,
  IconAlertTriangle,
} from "@tabler/icons-react";

import { useStore } from "../stores";
import { useResource } from "../hooks";
import { PageHeader, StatCard, DataState, DocHint } from "../components/ui";
import {
  FIREWALL_ENDPOINT,
  FIREWALL_DOC,
  AUTHENTICATOR_META,
  activeDefenseCount,
  describeFirewallError,
  type FirewallDescription,
  type FirewallAuthenticator,
} from "./firewall/firewallModel";
import { AuthenticatorChip, MountedBadge } from "./firewall/firewallFormat";
import { FirewallZones } from "./firewall/FirewallZones";
import { FirewallDefenses } from "./firewall/FirewallDefenses";
import { FirewallRoles } from "./firewall/FirewallRoles";
import { FirewallAuthStats } from "./firewall/FirewallAuthStats";

/** Panneau « Authenticators » — registre ∪ montés (badges + rôle court). */
function AuthenticatorsPanel({
  authenticators,
}: {
  authenticators: FirewallAuthenticator[];
}) {
  return (
    <Stack gap="md">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          {authenticators.filter((a) => a.mounted).length} monté(s) sur{" "}
          {authenticators.length} disponible(s).
        </Text>
        <DocHint
          title="Authenticators"
          version={FIREWALL_DOC}
          summary="Une façon de prouver son identité (pattern IAuthenticator). « Monté » = référencé par ≥1 zone (actif sur le pipeline) ; « Disponible » = utilisable en config mais non référencé."
          sections={[
            {
              label: "Challenge",
              body: "Un authenticator « avec challenge » fournit l'en-tête WWW-Authenticate (RFC 7235) du 401 de sa zone.",
            },
          ]}
        />
      </Group>
      <Grid>
        {authenticators.map((a) => (
          <Grid.Col key={a.name} span={{ base: 12, sm: 6, lg: 4 }}>
            <Card
              withBorder
              radius="md"
              p="md"
              h="100%"
              style={{ opacity: a.mounted ? 1 : 0.7 }}
            >
              <Group justify="space-between" wrap="nowrap" mb={6}>
                <AuthenticatorChip name={a.name} />
                <MountedBadge mounted={a.mounted} />
              </Group>
              <Text size="xs" c="dimmed">
                {AUTHENTICATOR_META[a.name]?.blurb ??
                  "Authenticator enregistré (plugin)."}
              </Text>
              {a.challenge && (
                <Badge
                  mt="xs"
                  size="xs"
                  variant="outline"
                  color="gray"
                  style={{ textTransform: "none" }}
                >
                  challenge WWW-Authenticate
                </Badge>
              )}
            </Card>
          </Grid.Col>
        ))}
      </Grid>
    </Stack>
  );
}

export const Firewall = observer(() => {
  const store = useStore();
  const [tab, setTab] = useState<string>("zones");

  const fetcher = useCallback(async (): Promise<FirewallDescription> => {
    try {
      return await store.api.getAbsolute<FirewallDescription>(
        FIREWALL_ENDPOINT,
      );
    } catch (e) {
      throw new Error(describeFirewallError(e));
    }
  }, [store]);

  const { data, loading, error, reload } = useResource(fetcher);

  const kpis = useMemo(() => {
    const zones = data?.zones ?? [];
    return {
      zones: zones.length,
      protected: zones.filter((z) => z.security).length,
      mounted: (data?.authenticators ?? []).filter((a) => a.mounted).length,
      defenses: activeDefenseCount(data?.defenses ?? null),
    };
  }, [data]);

  const configValid = data?.configValid ?? true;

  const subtitle = data
    ? `${kpis.zones} zone(s) · ${kpis.mounted} authenticator(s) monté(s) · ${kpis.defenses}/4 défenses actives`
    : "Introspection du firewall";

  return (
    <Stack gap="md">
      <PageHeader
        title="Firewall"
        subtitle={subtitle}
        icon={<IconShieldLock size={26} />}
        sticky
        actions={
          <Group gap="sm" wrap="nowrap">
            {data && (
              <Badge
                size="lg"
                variant="light"
                color={configValid ? "teal" : "red"}
                leftSection={
                  configValid ? (
                    <IconShieldCheck size={14} />
                  ) : (
                    <IconShieldOff size={14} />
                  )
                }
                style={{ textTransform: "none" }}
              >
                {configValid ? "Config valide" : "Fail-closed"}
              </Badge>
            )}
            <Button
              variant="light"
              leftSection={<IconRefresh size={16} />}
              loading={loading}
              onClick={reload}
            >
              Recharger
            </Button>
          </Group>
        }
      />

      <DataState loading={loading && !data} error={error} onRetry={reload}>
        {data && (
          <>
            {!configValid && (
              <Alert
                variant="light"
                color="red"
                icon={<IconAlertTriangle size={18} />}
                title="Firewall fail-closed — configuration invalide"
              >
                {data.configError ??
                  "La configuration de sécurité est invalide : toutes les requêtes sont rejetées (401) jusqu'à correction."}
              </Alert>
            )}

            <Grid>
              <StatCard
                label="Zones"
                icon={
                  <IconRoute size={20} color="var(--mantine-color-brand-5)" />
                }
                hint="Zones de sécurité montées (patterns d'URL capturés par le firewall)."
              >
                <Text
                  fz={28}
                  fw={700}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {kpis.zones}
                </Text>
              </StatCard>
              <StatCard
                label="Zones protégées"
                icon={
                  <IconShieldLock
                    size={20}
                    color="var(--mantine-color-teal-6)"
                  />
                }
                hint="Zones en Zero Trust (preuve d'identité requise, 401 sinon). Les autres sont publiques explicites."
              >
                <Text
                  fz={28}
                  fw={700}
                  c="teal"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {kpis.protected}
                </Text>
              </StatCard>
              <StatCard
                label="Authenticators montés"
                icon={
                  <IconLogin2 size={20} color="var(--mantine-color-grape-6)" />
                }
                hint="Authenticators instanciés car référencés par ≥1 zone (actifs sur le pipeline)."
              >
                <Text
                  fz={28}
                  fw={700}
                  c="grape"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {kpis.mounted}
                </Text>
              </StatCard>
              <StatCard
                label="Défenses actives"
                icon={
                  <IconShieldCheck
                    size={20}
                    color="var(--mantine-color-blue-6)"
                  />
                }
                hint="Défenses transverses activées sur 4 : CSRF, CORS, en-têtes de sécurité, throttle de login."
              >
                <Text
                  fz={28}
                  fw={700}
                  c="blue"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {kpis.defenses}
                  <Text span fz={16} c="dimmed">
                    {" "}
                    / 4
                  </Text>
                </Text>
              </StatCard>
            </Grid>

            <Tabs value={tab} onChange={(v) => v && setTab(v)} mt="xs">
              <Tabs.List>
                <Tabs.Tab value="zones" leftSection={<IconRoute size={15} />}>
                  Zones
                </Tabs.Tab>
                <Tabs.Tab
                  value="authenticators"
                  leftSection={<IconLogin2 size={15} />}
                >
                  Authenticators
                </Tabs.Tab>
                <Tabs.Tab
                  value="defenses"
                  leftSection={<IconShieldCheck size={15} />}
                >
                  Défenses
                </Tabs.Tab>
                <Tabs.Tab
                  value="roles"
                  leftSection={<IconUsersGroup size={15} />}
                >
                  Rôles
                </Tabs.Tab>
                <Tabs.Tab
                  value="stats"
                  leftSection={<IconChartBar size={15} />}
                >
                  Statistiques
                </Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="zones" pt="md">
                <FirewallZones zones={data.zones} />
              </Tabs.Panel>
              <Tabs.Panel value="authenticators" pt="md">
                <AuthenticatorsPanel authenticators={data.authenticators} />
              </Tabs.Panel>
              <Tabs.Panel value="defenses" pt="md">
                <FirewallDefenses defenses={data.defenses} />
              </Tabs.Panel>
              <Tabs.Panel value="roles" pt="md">
                {/* Monté seulement à l'ouverture de l'onglet (fetch à la demande). */}
                {tab === "roles" && <FirewallRoles />}
              </Tabs.Panel>
              <Tabs.Panel value="stats" pt="md">
                {tab === "stats" && <FirewallAuthStats />}
              </Tabs.Panel>
            </Tabs>
          </>
        )}
      </DataState>
    </Stack>
  );
});

export default Firewall;
