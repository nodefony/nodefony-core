import { Drawer } from "@mantine/core";
import { RealtimeHubContent } from "./RealtimeHubContent";

interface Props {
  opened: boolean;
  onClose: () => void;
}

/**
 * ConnectionDrawer — coquille `Drawer` autour de {@link RealtimeHubContent}.
 *
 * Le hub temps réel est désormais exposé surtout en **HoverCard** sur le chip
 * topbar (aperçu des abonnements de la page courante) + la **console Realtime**
 * plein écran. Ce drawer reste disponible (même contenu, source unique) pour un
 * usage mobile/tiroir si besoin.
 */
export function ConnectionDrawer({ opened, onClose }: Props) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title="Realtime hub"
      position="right"
      size="md"
    >
      <RealtimeHubContent />
    </Drawer>
  );
}
