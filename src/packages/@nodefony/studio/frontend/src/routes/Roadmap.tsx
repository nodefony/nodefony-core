import { Card, Group, SimpleGrid, Stack, Text, ThemeIcon } from "@mantine/core";
import { Link } from "react-router";
import { PageHeader } from "../components/ui";
import { NAV_GROUPS } from "../layouts/navConfig";
import { DocHint } from "../components/ui";

/**
 * Feuille de route — ce qui n'est pas encore livré, rassemblé en un seul endroit.
 *
 * Ces pages figuraient dans le menu, atténuées et badgées « à venir ». Quatorze
 * entrées sur quarante et une : un tiers de la navigation d'une console
 * d'administration occupé à annoncer ce qui n'existe pas. L'intention était de
 * montrer où va le produit ; l'effet obtenu était de le faire paraître inachevé,
 * et de noyer ce qui marche.
 *
 * La vitrine n'est pas supprimée, elle est DÉPLACÉE — ici, où on vient la
 * chercher. La liste n'est pas recopiée : elle est DÉRIVÉE de `NAV_GROUPS`, la
 * même source que le menu. Retirer le drapeau `wip` d'une entrée la fait donc
 * apparaître dans le menu et disparaître d'ici, du même geste : les deux ne
 * peuvent pas se contredire.
 */
export function Roadmap() {
  const groupes = NAV_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    icon: g.icon,
    items: g.items.filter((i) => i.wip),
  })).filter((g) => g.items.length > 0);

  const total = groupes.reduce((n, g) => n + g.items.length, 0);

  return (
    <Stack gap="md">
      <PageHeader
        title="Feuille de route"
        subtitle={`${total} écrans en préparation, dans ${groupes.length} domaines`}
      />

      <Group gap={6}>
        <Text size="sm" c="dimmed">
          Les écrans déjà prévus, pas encore livrés — chacun mène à sa fiche,
          qui dit la phase qui le débloquera.
        </Text>
        <DocHint
          title="Pourquoi ces pages ne sont pas dans le menu"
          summary="Une console d'administration doit montrer ce qu'on peut FAIRE."
          sections={[
            {
              label: "Ce que le menu montrait avant",
              body: "Quatorze entrées sur quarante et une portaient un badge « à venir » : un tiers de la navigation occupé à annoncer ce qui n'existe pas, et ce qui marche noyé au milieu.",
            },
            {
              label: "D'où vient cette liste",
              body: "Du même fichier que le menu (`navConfig`). Retirer le drapeau d'une page la fait apparaître dans le menu et disparaître d'ici, du même geste — les deux ne peuvent pas se contredire.",
            },
          ]}
        />
      </Group>

      {groupes.map((g) => {
        const Icone = g.icon;
        return (
          <Stack key={g.id} gap="xs">
            <Group gap={8}>
              <ThemeIcon variant="light" color="gray" size="sm" radius="sm">
                <Icone size={14} stroke={1.6} />
              </ThemeIcon>
              <Text size="sm" fw={600} tt="uppercase" c="dimmed">
                {g.label}
              </Text>
              <Text size="xs" c="dimmed">
                {g.items.length}
              </Text>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
              {g.items.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <Card
                    key={item.to}
                    component={Link}
                    to={item.to}
                    withBorder
                    padding="sm"
                    radius="md"
                  >
                    <Group gap={10} wrap="nowrap">
                      <ThemeIcon variant="light" color="brand" radius="md">
                        <ItemIcon size={18} stroke={1.6} />
                      </ThemeIcon>
                      <Text size="sm" fw={600}>
                        {item.label}
                      </Text>
                    </Group>
                  </Card>
                );
              })}
            </SimpleGrid>
          </Stack>
        );
      })}
    </Stack>
  );
}

export default Roadmap;
