import "../workspace/widgets"; // side-effect : peuple le registry de widgets
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { Badge, Button, Group, Stack, Switch, Text } from "@mantine/core";
import {
  IconApps,
  IconArrowsMinimize,
  IconCpu,
  IconRefresh,
} from "@tabler/icons-react";
import { useUi, useWorkspace } from "../stores";
import { PageHeader } from "../components/ui";
import { WidgetGrid } from "../workspace/WidgetGrid";
import { WidgetCatalogDrawer } from "../workspace/WidgetCatalogDrawer";
import { WorkspaceSwitcher } from "../workspace/WorkspaceSwitcher";
import { useWidgetRuntime } from "../workspace/useWidgetRuntime";

/**
 * **Mon bureau** (`/nodefony/workspace`) — bureau d'observabilité composable.
 * L'utilisateur choisit un preset métier (dev / superviseur / admin / vierge), puis
 * ajoute, retire et agence ses widgets. Chaque widget est alimenté par le même
 * protocole (snapshot + canal realtime) via le `WidgetHost`. Mode héros « Jumeau
 * Vivant » = L3 (canevas spatial), ce mode grille reste le repli « à plat ».
 */
export const Workspace = observer(() => {
  const workspace = useWorkspace();
  const ui = useUi();
  const [catalog, setCatalog] = useState(false);
  const { ctx, reload } = useWidgetRuntime();
  const active = workspace.active;

  return (
    <Stack gap="md">
      <WorkspaceSwitcher />

      <PageHeader
        title={active.label}
        subtitle="Composez votre espace : ajoutez, retirez et agencez vos widgets."
        actions={
          <Group gap="xs">
            <Switch
              size="sm"
              checked={ui.realtimeLive}
              onChange={(e) => ui.setRealtimeLive(e.currentTarget.checked)}
              label="Temps réel"
            />
            <Button
              size="xs"
              variant="light"
              leftSection={<IconApps size={14} />}
              onClick={() => setCatalog(true)}
            >
              Ajouter
            </Button>
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              leftSection={<IconArrowsMinimize size={14} />}
              onClick={() => workspace.tidy()}
            >
              Ranger
            </Button>
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              leftSection={<IconRefresh size={14} />}
              onClick={reload}
            >
              Rafraîchir
            </Button>
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              onClick={() => workspace.resetToPreset()}
            >
              Réinitialiser
            </Button>
          </Group>
        }
      />

      {ctx.cluster ? (
        <Group>
          <Badge
            variant="light"
            color="grape"
            leftSection={<IconCpu size={12} />}
          >
            Cluster · {ctx.instanceCount} workers — chaque tuile montre le pod,
            forage par worker au dépliage
          </Badge>
        </Group>
      ) : null}

      {active.items.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          Bureau vide. Cliquez « Ajouter » pour poser vos premiers widgets.
        </Text>
      ) : (
        <WidgetGrid layout={active} ctx={ctx} />
      )}

      <WidgetCatalogDrawer opened={catalog} onClose={() => setCatalog(false)} />
    </Stack>
  );
});

export default Workspace;
