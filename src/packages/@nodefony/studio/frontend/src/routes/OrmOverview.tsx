import { observer } from "mobx-react-lite";
import { useCallback } from "react";
import {
  Grid,
  Stack,
  Card,
  Group,
  Text,
  Badge,
  ThemeIcon,
  Button,
  SimpleGrid,
} from "@mantine/core";
import { Link } from "react-router-dom";
import {
  IconDatabase,
  IconPlugConnected,
  IconPlugX,
  IconAffiliate,
  IconTable,
} from "@tabler/icons-react";
import { useStore } from "../stores";
import { useResource } from "../hooks";
import { PageHeader, StatCard as Kpi, DataState } from "../components/ui";

/** Résumé d'un connecteur ORM (data plane /nodefony/orm/api/orms). */
interface OrmSummary {
  name: string;
  /** `drizzle` | `sequelize` | `mongoose`… pour l'icône de marque. */
  vendor?: string;
  default: boolean;
  connected: boolean;
  entityCount: number;
}

/** Entité du graphe canonique (/nodefony/orm/api/graph) — on n'utilise que les relations. */
interface EntityNode {
  name: string;
  orm: string;
  relations?: unknown[];
}

interface OrmGraph {
  orms: OrmSummary[];
  entities: EntityNode[];
}

/** Couleur de marque + libellé par vendor (icône colorée — a11y : couleur + texte). */
const VENDORS: Record<string, { color: string; label: string }> = {
  drizzle: { color: "#C5F74F", label: "Drizzle" },
  sequelize: { color: "#52B0E7", label: "Sequelize" },
  mongoose: { color: "#880000", label: "Mongoose" },
  mikroorm: { color: "#864342", label: "MikroORM" },
};

/** Carte d'un connecteur : marque, état de connexion, nb d'entités, accès au schéma. */
function OrmCard({ orm }: { orm: OrmSummary }) {
  const v = VENDORS[orm.vendor ?? ""] ?? {
    color: "gray",
    label: orm.vendor || "—",
  };
  return (
    <Card withBorder radius="md" p="lg">
      <Group justify="space-between" wrap="nowrap" mb="sm">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon size="lg" radius="md" variant="light" color="gray">
            <IconDatabase size={20} color={v.color} />
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Text fw={700} truncate>
              {orm.name}
            </Text>
            <Text size="xs" c="dimmed">
              {v.label}
            </Text>
          </div>
        </Group>
        {orm.default && (
          <Badge size="xs" variant="light" color="brand">
            défaut
          </Badge>
        )}
      </Group>

      <Group justify="space-between">
        <Badge
          variant="light"
          color={orm.connected ? "teal" : "gray"}
          leftSection={
            orm.connected ? (
              <IconPlugConnected size={13} />
            ) : (
              <IconPlugX size={13} />
            )
          }
        >
          {orm.connected ? "connecté" : "déconnecté"}
        </Badge>
        <Group gap={4} c="dimmed">
          <IconTable size={14} />
          <Text size="sm">{orm.entityCount} entité(s)</Text>
        </Group>
      </Group>

      <Button
        component={Link}
        to="/nodefony/databases"
        variant="subtle"
        size="xs"
        mt="md"
        fullWidth
        leftSection={<IconAffiliate size={14} />}
      >
        Voir le schéma
      </Button>
    </Card>
  );
}

/**
 * Dashboard ORM — vue d'ensemble des connecteurs : KPIs (connecteurs, connectés,
 * entités, relations) + une carte par ORM (marque, état, nb d'entités, accès au
 * schéma ERD). Données STATIQUES via le data plane `/nodefony/orm/api`
 * (`useResource`). Le détail visuel du modèle (ERD React Flow) vit dans
 * `/nodefony/databases`.
 */
export const OrmOverview = observer(() => {
  const store = useStore();

  const orms = useResource(
    useCallback(
      () => store.api.getAbsolute<OrmSummary[]>("/nodefony/orm/api/orms"),
      [store],
    ),
  );
  // Graphe complet (sans filtre) → compte les relations tous connecteurs confondus.
  const graph = useResource(
    useCallback(
      () => store.api.getAbsolute<OrmGraph>("/nodefony/orm/api/graph"),
      [store],
    ),
  );

  const list = orms.data ?? [];
  const connected = list.filter((o) => o.connected).length;
  const entityTotal = list.reduce((a, o) => a + (o.entityCount || 0), 0);
  const relationTotal = (graph.data?.entities ?? []).reduce(
    (a, e) => a + (e.relations?.length ?? 0),
    0,
  );

  return (
    <Stack gap="lg">
      <PageHeader
        sticky
        title="Dashboard ORM"
        subtitle="Connecteurs, entités & relations du projet"
        actions={
          <Button
            component={Link}
            to="/nodefony/databases"
            variant="light"
            leftSection={<IconAffiliate size={16} />}
          >
            Schéma ERD
          </Button>
        }
      />

      <Grid>
        <Kpi
          label="Connecteurs"
          icon={<IconDatabase size={30} stroke={1.4} />}
          hint="ORM enregistrés dans le registre."
        >
          <Text fw={700} size="xl">
            {list.length || "—"}
          </Text>
        </Kpi>
        <Kpi
          label="Connectés"
          icon={<IconPlugConnected size={30} stroke={1.4} />}
          hint="Connecteurs dont la connexion est ouverte."
        >
          <Text fw={700} size="xl">
            {list.length ? `${connected}/${list.length}` : "—"}
          </Text>
        </Kpi>
        <Kpi
          label="Entités"
          icon={<IconTable size={30} stroke={1.4} />}
          hint="Total des entités mappées, tous connecteurs."
        >
          <Text fw={700} size="xl">
            {entityTotal || "—"}
          </Text>
        </Kpi>
        <Kpi
          label="Relations"
          icon={<IconAffiliate size={30} stroke={1.4} />}
          hint="Relations déclarées entre entités (graphe canonique)."
        >
          <Text fw={700} size="xl">
            {relationTotal || "—"}
          </Text>
        </Kpi>
      </Grid>

      <DataState
        loading={orms.loading && !list.length}
        error={orms.error}
        empty={!list.length}
        onRetry={orms.reload}
        emptyMessage="Aucun connecteur ORM enregistré au runtime."
      >
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {list.map((o) => (
            <OrmCard key={o.name} orm={o} />
          ))}
        </SimpleGrid>
      </DataState>
    </Stack>
  );
});
