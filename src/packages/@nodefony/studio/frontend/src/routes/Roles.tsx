/**
 * Page **Rôles** (P6.15) — hiérarchie RBAC, niveau A de l'autorisation
 * (`RoleHierarchyWalker`). Introspection runtime via
 * `GET /nodefony/security/api/roleHierarchy`.
 *
 * Distincte de l'onglet *Firewall › Rôles* (qui ne montre que la closure
 * transitive en cartes plates) : onglets **Hiérarchie** (KPIs + déclaration
 * directe vs résolution transitive) et **Graphe** (DAG d'héritage plein
 * viewport). À venir : explorateur inverse (« qui possède ce rôle »).
 *
 * Structure = `PageLayout` (topbar figée garantie) + `StickyTabsList` (barre
 * d'onglets figée sous le header) — le layout commun à toutes les pages. Les
 * KPIs vivent dans l'onglet Hiérarchie pour laisser le Graphe occuper toute la
 * hauteur.
 */
import { useCallback, useState } from "react";
import { observer } from "mobx-react-lite";
import {
  Stack,
  Button,
  Grid,
  Card,
  Group,
  Code,
  Badge,
  Text,
  ThemeIcon,
  Tabs,
} from "@mantine/core";
import {
  IconRefresh,
  IconUsersGroup,
  IconArrowRight,
  IconHierarchy2,
  IconList,
  IconSitemap,
} from "@tabler/icons-react";

import { useStore } from "../stores";
import { useResource } from "../hooks";
import {
  PageLayout,
  StickyTabsList,
  DataState,
  KpiCard,
  DocHint,
} from "../components/ui";
import {
  ROLES_ENDPOINT,
  ROLES_DOC,
  describeRolesError,
  type RoleHierarchy,
} from "./roles/rolesModel";
import { RolesGraph } from "./roles/RolesGraph";

/** Message d'état vide partagé (aucune hiérarchie déclarée). */
const EMPTY_HINT =
  "Aucune hiérarchie de rôles déclarée — chaque rôle ne couvre que lui-même. " +
  "Déclaration via defineSecurityConfig({ roleHierarchy }).";

export const Roles = observer(() => {
  const store = useStore();
  const [tab, setTab] = useState<string | null>("hierarchie");

  const fetcher = useCallback(async (): Promise<RoleHierarchy> => {
    try {
      return await store.api.getAbsolute<RoleHierarchy>(ROLES_ENDPOINT);
    } catch (e) {
      throw new Error(describeRolesError(e), { cause: e });
    }
  }, [store]);

  const { data, loading, error, reload } = useResource(fetcher);
  const roles = data?.roles ?? [];
  const hierarchy = data?.hierarchy ?? {};

  // KPIs dérivés de la fenêtre courante (pas de valeur en dur).
  const declared = roles.length;
  const withInheritance = roles.filter((r) => r.inherits.length > 0).length;
  const maxCoverage = roles.reduce((m, r) => Math.max(m, r.inherits.length), 0);

  return (
    <PageLayout
      title="Rôles"
      subtitle={`${declared} rôle(s) déclaré(s) — hiérarchie RBAC (niveau A)`}
      icon={<IconUsersGroup size={22} />}
      actions={
        <Group gap="sm" wrap="nowrap">
          {tab === "graphe" && (
            <DocHint
              title="Graphe d'héritage"
              version={ROLES_DOC}
              summary="DAG des rôles : un lien A → B = « A hérite de B ». La transitivité se lit comme un chemin (A → B → C ⇒ A couvre C)."
              sections={[
                {
                  label: "Comment lire",
                  body: "De haut en bas : les sommets (mis en avant) ne sont hérités par personne = les rôles d'entrée les plus puissants ; les rôles de base (ROLE_USER…) sont en bas.",
                },
              ]}
            />
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
    >
      <DataState loading={loading && !data} error={error} onRetry={reload}>
        <Tabs value={tab} onChange={setTab}>
          <StickyTabsList>
            <Tabs.Tab value="hierarchie" leftSection={<IconList size={15} />}>
              Hiérarchie
            </Tabs.Tab>
            <Tabs.Tab value="graphe" leftSection={<IconSitemap size={15} />}>
              Graphe
            </Tabs.Tab>
          </StickyTabsList>

          <Tabs.Panel value="hierarchie" pt="md">
            <Stack gap="md">
              <Grid>
                <KpiCard
                  icon={<IconUsersGroup size={20} />}
                  label="Rôles déclarés"
                  value={declared}
                  accent="indigo"
                  info={
                    <DocHint
                      title="Rôles déclarés"
                      version={ROLES_DOC}
                      summary={`${declared} rôle(s) clés de la hiérarchie (defineSecurityConfig.roleHierarchy).`}
                      sections={[
                        {
                          label: "Si 0",
                          body: "Aucune hiérarchie déclarée : tous les rôles sont plats (chacun ne couvre que lui-même).",
                        },
                      ]}
                    />
                  }
                />
                <KpiCard
                  icon={<IconHierarchy2 size={20} />}
                  label="Avec héritage"
                  value={withInheritance}
                  accent="blue"
                  info={
                    <DocHint
                      title="Rôles avec héritage"
                      version={ROLES_DOC}
                      summary={`${withInheritance} rôle(s) héritent d'au moins un autre rôle (transitif inclus).`}
                      sections={[
                        {
                          label: "Lecture",
                          body: "Un rôle « avec héritage » couvre les droits d'autres rôles ; les rôles sans héritage sont des feuilles (ex. ROLE_USER).",
                        },
                      ]}
                    />
                  }
                />
                <KpiCard
                  icon={<IconArrowRight size={20} />}
                  label="Couverture max"
                  value={maxCoverage}
                  accent="grape"
                  info={
                    <DocHint
                      title="Couverture maximale"
                      version={ROLES_DOC}
                      summary={`Le rôle le plus puissant couvre ${maxCoverage} autre(s) rôle(s) par transitivité.`}
                      sections={[
                        {
                          label: "Technique",
                          body: "Taille maximale de la closure transitive (resolveRoles) parmi tous les rôles déclarés.",
                        },
                      ]}
                    />
                  }
                />
              </Grid>

              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  Déclaration directe et résolution transitive de chaque rôle.
                </Text>
                <DocHint
                  title="Hiérarchie de rôles (RBAC)"
                  version={ROLES_DOC}
                  summary="Un rôle hérite des droits des rôles qu'il déclare. La résolution est transitive et précalculée au boot (les cycles sont détectés → erreur)."
                  sections={[
                    {
                      label: "Directe vs transitive",
                      body: "« Hérite directement » = ce qui est écrit dans la config. « Couvre aussi » = les rôles gagnés par transitivité (un rôle hérité hérite lui-même d'autres rôles).",
                    },
                    {
                      label: "Si vide",
                      body: "Aucun héritage déclaré : chaque rôle ne couvre que lui-même. Déclaration via defineSecurityConfig({ roleHierarchy }).",
                    },
                  ]}
                />
              </Group>

              {roles.length === 0 ? (
                <Text size="sm" c="dimmed" fs="italic">
                  {EMPTY_HINT}
                </Text>
              ) : (
                <Grid>
                  {roles.map((r) => {
                    const direct = hierarchy[r.role] ?? [];
                    const directSet = new Set(direct);
                    const indirect = r.inherits.filter(
                      (h) => !directSet.has(h),
                    );
                    return (
                      <Grid.Col key={r.role} span={{ base: 12, md: 6 }}>
                        <Card withBorder radius="md" p="md" h="100%">
                          <Group gap="xs" wrap="nowrap" mb="sm">
                            <ThemeIcon
                              variant="light"
                              color="indigo"
                              radius="sm"
                              size="sm"
                            >
                              <IconUsersGroup size={15} />
                            </ThemeIcon>
                            <Code style={{ fontWeight: 700 }}>{r.role}</Code>
                          </Group>

                          <Stack gap={6}>
                            <Group gap={6} align="center" wrap="wrap">
                              <Text size="xs" c="dimmed" w={120}>
                                Hérite directement
                              </Text>
                              {direct.length === 0 ? (
                                <Text size="sm" c="dimmed" fs="italic">
                                  —
                                </Text>
                              ) : (
                                direct.map((h) => (
                                  <Badge
                                    key={h}
                                    variant="light"
                                    color="indigo"
                                    style={{ textTransform: "none" }}
                                  >
                                    {h}
                                  </Badge>
                                ))
                              )}
                            </Group>

                            {indirect.length > 0 && (
                              <Group gap={6} align="center" wrap="wrap">
                                <Text size="xs" c="dimmed" w={120}>
                                  Couvre aussi
                                </Text>
                                {indirect.map((h) => (
                                  <Badge
                                    key={h}
                                    variant="outline"
                                    color="gray"
                                    style={{ textTransform: "none" }}
                                  >
                                    {h}
                                  </Badge>
                                ))}
                              </Group>
                            )}
                          </Stack>
                        </Card>
                      </Grid.Col>
                    );
                  })}
                </Grid>
              )}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="graphe" pt="md">
            {tab === "graphe" &&
              (data ? (
                <RolesGraph data={data} />
              ) : (
                <Text size="sm" c="dimmed" fs="italic">
                  {EMPTY_HINT}
                </Text>
              ))}
          </Tabs.Panel>
        </Tabs>
      </DataState>
    </PageLayout>
  );
});
