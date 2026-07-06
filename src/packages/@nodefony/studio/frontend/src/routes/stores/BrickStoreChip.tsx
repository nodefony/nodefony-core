/**
 * Puce « Store actif » réutilisable — à poser dans le header de chaque page de
 * brique (Sessions, Users, API Keys, Webhooks, Audit…). Pilotée par le registre
 * (`/nodefony/kernel/api/stores`, source UNIQUE) : badge du backend résolu +
 * survol détaillant configuré / provenance / source / backends dispo / durabilité,
 * avec lien vers l'écran Stores. Remplace les badges de store ad-hoc par page.
 */
import { observer } from "mobx-react-lite";
import { useCallback } from "react";
import { Badge, HoverCard, Stack, Group, Text, Anchor } from "@mantine/core";
import { IconDatabase, IconAlertTriangle } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import { KeyValue } from "../../components/ui";
import type { UsersStatus } from "../users/usersModel";
import { USERS_STATUS_ENDPOINT } from "../users/usersModel";
import {
  STORES_ENDPOINT,
  BRICK_LABEL,
  BRICK_PURPOSE,
  PROVENANCE_LABEL,
  NATURE_LABEL,
  formatSource,
  storeLocation,
  isVolatileDurable,
  userBrick,
  type StoresPayload,
  type StoreResolution,
} from "./storesModel";

/**
 * Affiche le store de persistance actif d'une brique donnée.
 *
 * @param brick - identifiant de brique (`session`, `tokens`, `passkeys`, `totp`,
 *   `audit`, `webhooks`, `idempotency`, `user`).
 */
export const BrickStoreChip = observer(({ brick }: { brick: string }) => {
  const store = useStore();
  const fetcher = useCallback(async (): Promise<StoreResolution | null> => {
    const [payload, userStatus] = await Promise.all([
      store.api.getAbsolute<StoresPayload>(STORES_ENDPOINT),
      // La brique `user` vient d'un autre module (peut 403/manquer) → non bloquant.
      brick === "user"
        ? store.api
            .getAbsolute<UsersStatus>(USERS_STATUS_ENDPOINT)
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    const all = payload.stores.slice();
    const extra = userBrick(userStatus);
    if (extra) {
      all.push(extra);
    }
    return all.find((r) => r.brick === brick) ?? null;
  }, [store, brick]);

  const { data } = useResource(fetcher);
  if (!data) {
    return null;
  }
  const volatile = isVolatileDurable(data);
  const source = formatSource(data.source);
  const loc = storeLocation(data);

  return (
    <HoverCard
      width={300}
      shadow="md"
      openDelay={120}
      withArrow
      position="bottom-end"
    >
      <HoverCard.Target>
        <Badge
          variant="light"
          color={volatile ? "orange" : "grape"}
          leftSection={<IconDatabase size={12} />}
          rightSection={volatile ? <IconAlertTriangle size={11} /> : null}
          style={{ textTransform: "none", cursor: "help" }}
        >
          Store · {data.resolved}
        </Badge>
      </HoverCard.Target>
      <HoverCard.Dropdown>
        <Stack gap={6}>
          <Text fw={600} size="sm">
            {BRICK_LABEL[data.brick] ?? data.brick}
          </Text>
          {BRICK_PURPOSE[data.brick] && (
            <Text size="xs" c="dimmed">
              {BRICK_PURPOSE[data.brick]}
            </Text>
          )}
          <KeyValue k="Store actif" v={data.resolved} mono />
          <KeyValue k="Configuré" v={data.configured} mono />
          <KeyValue k="Provenance" v={PROVENANCE_LABEL[data.provenance]} />
          {source && <KeyValue k="Source" v={source} />}
          <KeyValue
            k="Emplacement"
            v={loc.path ?? loc.hint}
            mono={!!loc.path}
          />
          <Text size="xs" c="dimmed">
            {data.reason}
          </Text>
          <KeyValue
            k="Durabilité"
            v={NATURE_LABEL[data.nature] + (volatile ? " · ⚠ volatil" : "")}
          />
          <Group gap={4} wrap="wrap">
            <Text size="xs" c="dimmed">
              Dispo :
            </Text>
            {data.available.map((b) => (
              <Badge
                key={b}
                size="xs"
                variant={b === data.resolved ? "filled" : "outline"}
                color={b === data.resolved ? "grape" : "gray"}
                style={{ textTransform: "none" }}
              >
                {b}
              </Badge>
            ))}
          </Group>
          <Anchor component={Link} to="/nodefony/stores" size="xs">
            Voir tous les stores →
          </Anchor>
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
});
