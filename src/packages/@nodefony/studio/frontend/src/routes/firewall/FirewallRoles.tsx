/**
 * Section **Hiérarchie de rôles** de la console Firewall — niveau A de
 * l'autorisation (RoleHierarchyWalker) : déclaration brute + résolution
 * transitive. Données issues de `GET .../api/roleHierarchy`.
 */
import { useCallback } from "react";
import { observer } from "mobx-react-lite";
import {
  Stack,
  Group,
  Card,
  Badge,
  Text,
  Code,
  Alert,
  Grid,
  ThemeIcon,
} from "@mantine/core";
import {
  IconUsersGroup,
  IconArrowRight,
  IconInfoCircle,
} from "@tabler/icons-react";

import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import { DataState, DocHint } from "../../components/ui";
import {
  ROLES_ENDPOINT,
  FIREWALL_DOC,
  describeFirewallError,
  type RoleHierarchy,
} from "./firewallModel";

export const FirewallRoles = observer(() => {
  const store = useStore();

  const fetcher = useCallback(async (): Promise<RoleHierarchy> => {
    try {
      return await store.api.getAbsolute<RoleHierarchy>(ROLES_ENDPOINT);
    } catch (e) {
      throw new Error(describeFirewallError(e));
    }
  }, [store]);

  const { data, loading, error, reload } = useResource(fetcher);
  const roles = data?.roles ?? [];

  return (
    <Stack gap="md">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          {roles.length} rôle(s) avec héritage déclaré.
        </Text>
        <DocHint
          title="Hiérarchie de rôles"
          version={FIREWALL_DOC}
          summary="Niveau A de l'autorisation : un rôle hérite des droits des rôles listés. La résolution est transitive et précalculée au boot (cycles détectés → erreur)."
          sections={[
            {
              label: "Comment lire",
              body: "« ROLE_ADMIN → ROLE_USER, ROLE_X » signifie qu'un porteur de ROLE_ADMIN satisfait aussi toute exigence de ROLE_USER ou ROLE_X (héritage résolu).",
            },
            {
              label: "Si vide",
              body: "Aucun héritage déclaré : chaque rôle ne couvre que lui-même. Déclaration via defineSecurityConfig({ roleHierarchy }).",
            },
          ]}
        />
      </Group>

      <DataState
        loading={loading && !data}
        error={error}
        empty={!loading && roles.length === 0}
        emptyMessage="Aucune hiérarchie de rôles déclarée."
        onRetry={reload}
      >
        <Grid>
          {roles.map((r) => (
            <Grid.Col key={r.role} span={{ base: 12, md: 6 }}>
              <Card withBorder radius="md" p="md" h="100%">
                <Group gap="xs" wrap="nowrap" mb="xs">
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
                {r.inherits.length === 0 ? (
                  <Text size="sm" c="dimmed" fs="italic">
                    n'hérite d'aucun autre rôle
                  </Text>
                ) : (
                  <Group gap={6} align="center" wrap="wrap">
                    <ThemeIcon variant="subtle" color="gray" size="sm">
                      <IconArrowRight size={14} />
                    </ThemeIcon>
                    {r.inherits.map((h) => (
                      <Badge
                        key={h}
                        variant="light"
                        color="indigo"
                        style={{ textTransform: "none" }}
                      >
                        {h}
                      </Badge>
                    ))}
                  </Group>
                )}
              </Card>
            </Grid.Col>
          ))}
        </Grid>

        <Alert
          variant="light"
          color="gray"
          icon={<IconInfoCircle size={16} />}
          mt="xs"
        >
          <Text size="xs">
            Le dispatch d'autorisation route <Code>ROLE_*</Code> vers cette
            hiérarchie, <Code>PERM_*</Code> vers le RBAC ORM, et le reste vers
            les voters (P6.8). Cette vue couvre le niveau A (rôles).
          </Text>
        </Alert>
      </DataState>
    </Stack>
  );
});
