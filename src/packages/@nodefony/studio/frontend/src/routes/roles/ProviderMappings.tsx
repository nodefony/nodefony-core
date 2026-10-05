/**
 * Carte **Rôles accordés par les annuaires** (onglet Hiérarchie) — la table
 * `roleMapping` de chaque fournisseur d'identité : rôle de l'annuaire → rôle
 * de l'application. Lecture seule : la table vit dans la configuration (elle
 * donne des droits, elle se relit en revue), pas dans la console.
 */
import {
  Badge,
  Card,
  Code,
  Group,
  Stack,
  Table,
  Text,
  ThemeIcon,
  VisuallyHidden,
} from "@mantine/core";
import { IconArrowRight } from "@tabler/icons-react";
import { ProviderIcon } from "../../components/ProviderIcon";
import { DocHint } from "../../components/ui";
import { ROLES_DOC, type ProviderRoleMapping } from "./rolesModel";

/** Une carte par fournisseur doté d'une table ; rien sans table. */
export function ProviderMappings({
  providers,
}: {
  providers: ProviderRoleMapping[];
}) {
  if (providers.length === 0) return null;
  return (
    <Stack gap="sm">
      {providers.map((p) => {
        const platform = p.mappings.filter((m) => m.platform).length;
        return (
          <Card key={p.provider} withBorder radius="md" p="md">
            <Group gap="xs" mb="sm" wrap="nowrap">
              <ThemeIcon variant="light" color="teal" radius="sm" size="sm">
                <ProviderIcon name={p.provider} size={15} />
              </ThemeIcon>
              <Text fw={700}>Rôles accordés par {p.provider}</Text>
              <Badge
                variant="light"
                color="gray"
                style={{ textTransform: "none" }}
              >
                source : {p.sources.join(", ")}
              </Badge>
              {p.allowPlatformRoles && (
                <Badge
                  variant="light"
                  color="red"
                  style={{ textTransform: "none" }}
                >
                  rôles de plateforme ouverts
                </Badge>
              )}
              <DocHint
                title={`Table roleMapping — ${p.provider}`}
                version={ROLES_DOC}
                summary={`${p.mappings.length} rôle(s) de ${p.provider} traduit(s) en rôles de l'application, recalculés à chaque connexion et à chaque jeton d'API.`}
                sections={[
                  {
                    label: "Lecture",
                    body: `Quand ${p.provider} donne le rôle de gauche à un utilisateur, l'application lui accorde celui de droite. Un rôle de ${p.provider} absent de cette table est ignoré. Les rôles donnés à la main dans la fiche d'un utilisateur ne sont jamais retirés par ce calcul.`,
                  },
                  {
                    label: "Plateforme",
                    body:
                      platform === 0
                        ? `Aucun rôle de plateforme (ROLE_NODEFONY_*) n'est accordé par ${p.provider}.`
                        : `${platform} rôle(s) de PLATEFORME accordé(s) par ${p.provider} (allowPlatformRoles) : l'administrateur de l'annuaire administre cette instance.`,
                  },
                  {
                    label: "Modifier",
                    body: "La table se modifie dans la configuration (security.oauth2.providers.<nom>.roleMapping), jamais ici.",
                  },
                ]}
              />
            </Group>
            <Table striped withRowBorders={false} verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Rôle {p.provider}</Table.Th>
                  <Table.Th>
                    <VisuallyHidden>accorde</VisuallyHidden>
                  </Table.Th>
                  <Table.Th>Rôle de l'application</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {p.mappings.map((m) => (
                  <Table.Tr key={m.from}>
                    <Table.Td>
                      <Code>{m.from}</Code>
                    </Table.Td>
                    <Table.Td w={32}>
                      <IconArrowRight size={14} aria-hidden="true" />
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        variant="light"
                        color={m.platform ? "red" : "indigo"}
                        style={{ textTransform: "none" }}
                      >
                        {m.to}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        );
      })}
    </Stack>
  );
}
