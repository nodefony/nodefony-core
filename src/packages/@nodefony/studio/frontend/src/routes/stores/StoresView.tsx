import { observer } from "mobx-react-lite";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import {
  Stack,
  Grid,
  Group,
  Badge,
  Code,
  Text,
  Button,
  Alert,
  Tabs,
  Card,
  SimpleGrid,
  CopyButton,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconRefresh,
  IconDatabase,
  IconServer,
  IconAlertTriangle,
  IconList,
  IconHelpCircle,
  IconRoute,
  IconCopy,
  IconCheck,
  IconFolder,
  IconPlug,
  IconPlugConnected,
  IconDownload,
} from "@tabler/icons-react";
import { DbLogo, hasDbLogo } from "../../components/DbLogo";
import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import {
  PageHeader,
  DataState,
  StatCard,
  DocHint,
  WarnHint,
  DataGrid,
  type DataGridColumn,
} from "../../components/ui";
import {
  STORES_ENDPOINT,
  BRICK_LABEL,
  BRICK_PURPOSE,
  PROVENANCE_LABEL,
  NATURE_LABEL,
  sortBricks,
  isVolatileDurable,
  formatSource,
  storeLocation,
  deriveLocalDatabase,
  baseName,
  type Infra,
  type StoresPayload,
  type StoreResolution,
  type StoreEngine,
  type StoreNature,
} from "./storesModel";
import { StoresHelp } from "./StoresHelp";
import { TransportTab } from "./TransportTab";

/** Données prêtes pour le rendu : infra + lignes (briques) + moteurs détectés. */
interface StoresData {
  infra: Infra;
  rows: StoreResolution[];
  engines: StoreEngine[];
}

/** Statut d'un moteur (libellé + couleur + icône) — facts uniquement. */
function engineStatus(e: StoreEngine): {
  label: string;
  color: string;
  icon: ReactNode;
} {
  if (e.loaded)
    return {
      label: "chargé",
      color: "teal",
      icon: <IconPlugConnected size={13} />,
    };
  if (e.installed)
    return {
      label: "installé, non branché",
      color: "blue",
      icon: <IconPlug size={13} />,
    };
  return {
    label: "à installer",
    color: "gray",
    icon: <IconDownload size={13} />,
  };
}

/**
 * La nature d'une brique (`session` / `ephemeral` / `durable`) est DÉCLARÉE par le
 * service qui la résout et arrive dans le payload — on la lit, on ne la redevine pas.
 * Une liste locale « session, idempotency » a existé ici : elle classait à tort toute
 * brique éphémère ajoutée ensuite, sans que rien ne le signale. Brique non résolue
 * (module non chargé) → `durable`, le même défaut que le back.
 */
type NatureOf = (brick: string) => StoreNature;

/**
 * Tuile d'un moteur de persistance — FACTS sur la carte (statut, couverture par
 * brique ✅/❌, briques portées), EXPLICATION dans une fiche ⓘ `DocHint` DYNAMIQUE
 * (norme Studio : pas de prose sur l'écran factuel, contenu interpolé du live, cas 0
 * explicité).
 */
function EngineCard({
  e,
  bricks,
  universe,
  natureOf,
}: {
  e: StoreEngine;
  bricks: StoreResolution[];
  /** Toutes les briques que ce runtime sait résoudre (calculé, jamais en dur). */
  universe: string[];
  natureOf: NatureOf;
}) {
  const st = engineStatus(e);
  const isCache = e.kind === "cache";
  const covered = e.provides;
  const label = (b: string) => BRICK_LABEL[b] ?? b;
  const isEphemeral = (b: string) => natureOf(b) !== "durable";
  // Un backend DURABLE doit être un chemin COMPLET : on choisit une base de données,
  // pas de perdre une brique → ce qu'il ne couvre pas est un MANQUE (orange).
  // Un CACHE est borné par nature : sa couverture se lit par vocation (éphémère/
  // session), et les briques durables qu'il implémente sont un opt-in conditionné à un
  // Redis PERSISTANT (AOF). Mais ce qu'il ne porte PAS s'affiche quand même, en
  // neutre : taire les cases vides d'un cache reviendrait à affirmer que sa couverture
  // est close — or certaines de ces absences sont bien des manques (une petite valeur
  // durable comme un secret TOTP est du même ordre qu'un passkey, qu'il porte déjà).
  // L'écran montre le FAIT ; ce qui relève du choix ou du reste-à-faire vit dans la
  // roadmap, pas dans une liste jugée ici.
  const vocation = isCache ? covered.filter(isEphemeral) : covered;
  const edgeDurable = isCache ? covered.filter((b) => !isEphemeral(b)) : [];
  const missing = universe.filter((b) => !covered.includes(b));

  // Fiche ⓘ typée + DYNAMIQUE : statut, couverture lue à l'aune du domaine, ce qui
  // est porté, activation. Cas 0 explicité.
  const help = (
    <DocHint
      title={e.engine}
      summary={`${e.package} — ${st.label}. Couvre ${covered.length}/${universe.length} brique(s)${
        isCache
          ? ` (cache : couverture bornée par vocation, ${missing.length} non portée(s))`
          : missing.length
            ? ` — il en manque ${missing.length}`
            : " (chemin complet)"
      }.`}
      sections={[
        {
          label: isCache ? "Couverture (bornée par vocation)" : "Couverture",
          body: isCache
            ? `Vocation cache/éphémère → idéal pour : ${
                vocation.map(label).join(", ") || "—"
              }.${
                edgeDurable.length
                  ? ` Redis implémente aussi ${edgeDurable
                      .map(label)
                      .join(
                        ", ",
                      )}, mais DURABLES → uniquement si Redis PERSISTANT (AOF), sinon perdues au restart.`
                  : ""
              } Non porté ici : ${missing.map(label).join(", ") || "—"} — une partie relève d'un backend durable par nature (ce qui croît sans borne et se consulte : identité, journal d'audit, webhooks), le reste peut être ajouté au même régime opt-in que les jetons et passkeys.`
            : `Gère : ${covered.map(label).join(", ") || "—"}.${
                missing.length
                  ? ` MANQUE : ${missing
                      .map(label)
                      .join(
                        ", ",
                      )}. Un backend durable devrait être un chemin COMPLET — on choisit une base de données, pas de perdre une brique. En attendant, ces briques se replient sur un autre backend (repli annoncé au boot) : charger un second adapter durable à côté suffit.`
                  : " Chemin complet : une application peut tourner sur ce seul backend."
              }`,
        },
        {
          label: "Porté maintenant",
          body: bricks.length
            ? `${bricks.length} brique(s) résolue(s) dessus : ${bricks
                .map((b) => label(b.brick))
                .join(", ")}.`
            : "Aucune brique résolue dessus actuellement.",
        },
        {
          label: "Activation",
          body: e.loaded
            ? `Utilisable via le champ store d'une brique (ex. store: "${e.engine}").`
            : e.installed
              ? `Ajoute use("${e.package}") au manifeste modules de nodefony.config.ts.`
              : `npm i ${e.package} puis ajoute-le au manifeste modules.`,
        },
      ]}
    />
  );

  return (
    <Card withBorder radius="md" p="sm">
      <Group justify="space-between" wrap="nowrap" mb={6}>
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <div
            style={{
              width: 18,
              height: 18,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {hasDbLogo(e.engine) ? (
              <DbLogo name={e.engine} size={18} title={e.engine} />
            ) : (
              <IconDatabase size={16} />
            )}
          </div>
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Group gap={4} wrap="nowrap">
              <Text size="sm" fw={600} tt="capitalize" truncate>
                {e.engine}
              </Text>
              {help}
            </Group>
            <Text size="xs" c="dimmed" ff="monospace" truncate>
              {e.package}
            </Text>
          </Stack>
        </Group>
        <Badge
          size="sm"
          variant="light"
          color={st.color}
          leftSection={st.icon}
          style={{ textTransform: "none", flexShrink: 0 }}
        >
          {st.label}
        </Badge>
      </Group>

      {/* Couverture réelle. Durable → on affiche aussi ce qui MANQUE (cf `missing`). */}
      <Group gap={4} wrap="wrap" mb={6} align="center">
        <Text size="xs" c="dimmed">
          {isCache
            ? "Cache éphémère — idéal pour :"
            : `Couvre ${covered.length}/${universe.length} :`}
        </Text>
        {(isCache ? vocation : covered).map((b) => (
          <Badge
            key={b}
            size="xs"
            variant="light"
            color="teal"
            style={{ textTransform: "none" }}
          >
            {label(b)}
          </Badge>
        ))}
        {(isCache ? vocation : covered).length === 0 && (
          <Text size="xs" c="dimmed">
            —
          </Text>
        )}
      </Group>

      {/* Ce qui n'est PAS porté, toujours affiché — les taire ferait passer une
          couverture partielle pour une couverture close. Ton différent selon la
          nature du moteur : un durable DOIT être complet (orange), un cache est
          borné par vocation (neutre). */}
      {missing.length > 0 && (
        <Group gap={4} wrap="wrap" mb={6} align="center">
          <Text size="xs" c="dimmed">
            {isCache ? "Non porté :" : "Manque :"}
          </Text>
          {missing.map((b) => (
            <Badge
              key={b}
              size="xs"
              variant="outline"
              color={isCache ? "gray" : "orange"}
              style={{ textTransform: "none" }}
              title={`${label(b)} n'a pas de store ${e.engine} — la brique se replie sur un autre backend (repli annoncé au boot)`}
            >
              {label(b)}
            </Badge>
          ))}
        </Group>
      )}

      {/* Cache : briques DURABLES implémentées mais conditionnées à un Redis persistant. */}
      {isCache && edgeDurable.length > 0 && (
        <Group gap={4} wrap="wrap" mb={6} align="center">
          <Text size="xs" c="dimmed">
            Durable seulement si Redis persistant (AOF) :
          </Text>
          {edgeDurable.map((b) => (
            <Badge
              key={b}
              size="xs"
              variant="outline"
              color="blue"
              style={{ textTransform: "none" }}
              title="Brique durable — sur Redis uniquement s'il est persistant (AOF/RDB) ; sinon SQL/Mongo"
            >
              {label(b)}
            </Badge>
          ))}
        </Group>
      )}

      {/* Porté MAINTENANT (résolu) — dynamique. */}
      <Text size="xs" c="dimmed">
        {bricks.length
          ? `Porte ${bricks.length} brique${bricks.length > 1 ? "s" : ""} actuellement.`
          : "Aucune brique portée actuellement."}
      </Text>

      {/* Geste d'activation VISIBLE (fact actionnable) quand non branché. */}
      {!e.loaded && (
        <Text size="xs" c="dimmed" mt={2}>
          →{" "}
          {e.installed ? (
            <Code style={{ fontSize: 10 }}>use(&quot;{e.package}&quot;)</Code>
          ) : (
            <Code style={{ fontSize: 10 }}>npm i {e.package}</Code>
          )}
        </Text>
      )}
    </Card>
  );
}

/**
 * Section « Moteurs de persistance » : découvrabilité des adapters officiels — état
 * installé × chargé + geste d'activation. Comble « comment savoir que je PEUX utiliser
 * mongoose ? » (le registre runtime ne montre que le chargé).
 */
function EnginesSection({
  engines,
  rows,
}: {
  engines: StoreEngine[];
  rows: StoreResolution[];
}) {
  if (!engines.length) return null;
  const loaded = engines.filter((e) => e.loaded).length;
  const branchable = engines.filter((e) => e.installed && !e.loaded).length;
  const toInstall = engines.filter((e) => !e.installed).length;
  const bricksOf = (engine: string) =>
    rows.filter((r) => r.resolved === engine);
  // Univers des briques CALCULÉ : ce que les adapters déclarent couvrir ∪ ce que le
  // runtime résout réellement. Jamais une liste en dur — elle se périmerait au premier
  // ajout de brique et l'écran mentirait sans que rien ne le signale.
  const universe = [
    ...new Set([
      ...engines.flatMap((e) => e.provides),
      ...rows.map((r) => r.brick),
    ]),
  ].sort();
  // Nature LUE du payload (le service qui résout la brique la déclare) — jamais
  // redevinée ici. Brique non résolue (module non chargé) → `durable`, comme le back.
  const natures = new Map(rows.map((r) => [r.brick, r.nature]));
  const natureOf: NatureOf = (brick) => natures.get(brick) ?? "durable";
  return (
    <Card withBorder radius="md" p="md">
      <Group gap="xs" mb="sm">
        <IconPlugConnected size={18} />
        <Text fw={600}>Moteurs de persistance</Text>
        <Badge variant="light" color="gray" size="sm">
          {loaded}/{engines.length} chargé(s)
        </Badge>
        <DocHint
          title="Moteurs de persistance"
          summary={`${engines.length} adapter(s) officiel(s) : ${loaded} chargé(s), ${branchable} installé(s) non branché(s), ${toInstall} à installer. Le registre runtime ne connaît que le chargé — cette carte montre aussi le reste + la couverture par brique.`}
          sections={[
            {
              label: "États",
              body: 'chargé = branché au manifeste + enregistré (utilisable). installé, non branché = présent dans node_modules → ajouter use("@nodefony/…"). à installer = npm i @nodefony/… puis manifeste.',
            },
            {
              label: "Domaines & couverture",
              body: `Un backend DURABLE (SQL/Mongo) devrait être un chemin COMPLET : on choisit une base de données, pas de perdre une brique — ce qu'il ne couvre pas est donc affiché comme un MANQUE (badge orange), pas passé sous silence. Un CACHE (Redis) est borné par nature : il sert l'éphémère/session, et les briques durables qu'il implémente sont un opt-in conditionné à un Redis persistant. Chaque adapter DÉCLARE ce qu'il couvre (package.json nodefony.stores) ; l'univers des ${universe.length} briques affiché ici est calculé depuis ces déclarations + ce que le runtime résout, jamais figé.`,
            },
          ]}
        />
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
        {engines.map((e) => (
          <EngineCard
            key={e.engine}
            e={e}
            bricks={bricksOf(e.engine)}
            universe={universe}
            natureOf={natureOf}
          />
        ))}
      </SimpleGrid>
    </Card>
  );
}

/** Couleur du badge de durabilité. */
function natureColor(nature: StoreResolution["nature"]): string {
  if (nature === "durable") return "teal";
  if (nature === "ephemeral") return "yellow";
  return "cyan";
}

/**
 * Cellule « localisateur » : icône + valeur mono tronquée (tooltip = valeur complète)
 * + bouton copier. Sert le chemin fichier ET l'endpoint réseau (même rendu).
 */
function LocatorCell({
  icon,
  value,
  display,
  copyLabel,
}: {
  icon: ReactNode;
  value: string;
  display: string;
  copyLabel: string;
}) {
  return (
    <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
      {icon}
      <Tooltip label={value} openDelay={300} multiline maw={440}>
        <Code style={{ fontSize: 11 }}>{display}</Code>
      </Tooltip>
      <CopyButton value={value} timeout={1500}>
        {({ copied, copy }) => (
          <ActionIcon
            size="xs"
            variant="subtle"
            color={copied ? "teal" : "gray"}
            onClick={copy}
            aria-label={copyLabel}
          >
            {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
          </ActionIcon>
        )}
      </CopyButton>
    </Group>
  );
}

/** URL d'infra REDACTÉE (credentials masqués côté serveur) affichée en clair + copie. */
function InfraUrl({ url }: { url: string | null | undefined }) {
  if (!url) return null;
  return (
    <Group gap={4} wrap="nowrap" mt={4} style={{ minWidth: 0 }}>
      <Tooltip label={url} openDelay={300} multiline maw={440}>
        <Text
          size="xs"
          ff="monospace"
          c="dimmed"
          truncate
          style={{ minWidth: 0 }}
        >
          {url}
        </Text>
      </Tooltip>
      <CopyButton value={url} timeout={1500}>
        {({ copied, copy }) => (
          <ActionIcon
            size="xs"
            variant="subtle"
            color={copied ? "teal" : "gray"}
            onClick={copy}
            aria-label="Copier l'URL d'infra"
          >
            {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
          </ActionIcon>
        )}
      </CopyButton>
    </Group>
  );
}

const COLUMNS: DataGridColumn<StoreResolution>[] = [
  {
    key: "brick",
    header: "Brique",
    sortable: true,
    value: (r) => BRICK_LABEL[r.brick] ?? r.brick,
    render: (r) => (
      <Stack gap={0}>
        <Group gap={4} wrap="nowrap">
          <Text size="sm" fw={600}>
            {BRICK_LABEL[r.brick] ?? r.brick}
          </Text>
          {BRICK_PURPOSE[r.brick] && (
            <DocHint
              title={BRICK_LABEL[r.brick] ?? r.brick}
              summary={BRICK_PURPOSE[r.brick]}
            />
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {r.brick}
        </Text>
      </Stack>
    ),
  },
  {
    key: "resolved",
    header: "Store actif",
    sortable: true,
    value: (r) => r.resolved,
    render: (r) => (
      <Badge
        variant="light"
        color={isVolatileDurable(r) ? "orange" : "grape"}
        leftSection={<IconDatabase size={12} />}
        style={{ textTransform: "none" }}
      >
        {r.resolved}
      </Badge>
    ),
  },
  {
    key: "location",
    header: "Emplacement",
    value: (r) => {
      const loc = storeLocation(r);
      return loc.path ?? loc.endpoint ?? loc.hint;
    },
    render: (r) => {
      const { path, endpoint, hint } = storeLocation(r);
      // Chemin physique : nom de fichier en évidence + chemin complet copiable.
      if (path) {
        return (
          <LocatorCell
            icon={
              <IconFolder size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
            }
            value={path}
            display={baseName(path)}
            copyLabel={`Copier le chemin de ${r.brick}`}
          />
        );
      }
      // Backend réseau : URL cible redactée (host:port/db) copiable.
      if (endpoint) {
        return (
          <LocatorCell
            icon={
              <IconServer size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
            }
            value={endpoint}
            display={endpoint}
            copyLabel={`Copier l'endpoint de ${r.brick}`}
          />
        );
      }
      // Memory (volatil) / réseau sans infra déclarée → on explique où vit la donnée.
      return (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      );
    },
  },
  {
    key: "provenance",
    header: "Provenance",
    sortable: true,
    value: (r) => PROVENANCE_LABEL[r.provenance],
    render: (r) => {
      const source = formatSource(r.source);
      return (
        <Stack gap={2}>
          <Group gap={6} wrap="nowrap">
            <Badge
              variant="light"
              color={r.provenance === "infra" ? "blue" : "gray"}
              style={{ textTransform: "none" }}
            >
              {PROVENANCE_LABEL[r.provenance]}
            </Badge>
            <DocHint
              title="Provenance de la résolution"
              summary={r.reason}
              sections={[
                ...(source ? [{ label: "Source", body: source }] : []),
                ...(r.configPath
                  ? [
                      {
                        label: "Clé de config",
                        body: `${r.configPath} — pose cette clé (nodefony.config.ts / env) pour forcer un backend explicite.`,
                      },
                    ]
                  : []),
              ]}
            />
          </Group>
          {source && (
            <Text size="xs" c="dimmed">
              {source}
            </Text>
          )}
          {r.configPath && (
            <Tooltip
              label="Clé de configuration à poser pour forcer ce store"
              openDelay={300}
            >
              <Code style={{ fontSize: 10 }}>{r.configPath}</Code>
            </Tooltip>
          )}
        </Stack>
      );
    },
  },
  {
    key: "configured",
    header: "Configuré",
    value: (r) => r.configured,
    render: (r) => <Code>{r.configured}</Code>,
  },
  {
    key: "available",
    header: "Backends dispo",
    render: (r) =>
      r.available.length === 0 ? (
        <Text size="xs" c="dimmed">
          —
        </Text>
      ) : (
        <Group gap={4}>
          {r.available.map((b) => (
            <Badge
              key={b}
              size="sm"
              variant={b === r.resolved ? "filled" : "outline"}
              color={b === r.resolved ? "grape" : "gray"}
              style={{ textTransform: "none" }}
            >
              {b}
            </Badge>
          ))}
        </Group>
      ),
  },
  {
    key: "nature",
    header: "Durabilité",
    sortable: true,
    value: (r) => NATURE_LABEL[r.nature],
    render: (r) => (
      <Group gap={6} wrap="nowrap">
        <Badge
          variant="dot"
          color={natureColor(r.nature)}
          style={{ textTransform: "none" }}
        >
          {NATURE_LABEL[r.nature]}
        </Badge>
        {isVolatileDurable(r) && (
          <WarnHint
            title="Store durable volatil"
            summary="Brique durable en « memory » : données perdues au redémarrage et non partagées entre pods. Déclarer une infra durable (NF_DATABASE_URL) ou un store persistant explicite."
          />
        )}
      </Group>
    ),
  },
];

/**
 * Écran « Stores de persistance » : état RUNTIME de chaque brique (store résolu,
 * provenance, backends disponibles, durabilité) + bandeau de l'infra déclarée.
 */
export const StoresView = observer(() => {
  const store = useStore();
  const fetcher = useCallback(async (): Promise<StoresData> => {
    // La brique « user » est désormais une résolution de store à part entière
    // (enregistrée par `provisionUsers` via `registerStoreResolution`) → elle
    // arrive dans `payload.stores` comme les 7 autres, plus de fusion synthétique.
    const payload = await store.api.getAbsolute<StoresPayload>(STORES_ENDPOINT);
    return {
      infra: payload.infra,
      rows: sortBricks(payload.stores),
      engines: payload.engines ?? [],
    };
  }, [store]);

  const { data, loading, error, reload } = useResource(fetcher);
  const rows = data?.rows ?? [];
  const infra = data?.infra;
  const engines = data?.engines ?? [];
  // Sans infra RÉSEAU déclarée (mode local `default`), la base active est un fichier
  // sqlite exposé par les stores → on l'affiche au lieu de « — ».
  const localDb = infra?.database ? null : deriveLocalDatabase(rows);
  const volatileCount = rows.filter(isVolatileDurable).length;
  const [tab, setTab] = useState<string | null>("stores");

  return (
    <Stack gap="md">
      <PageHeader
        title="Stores de persistance"
        subtitle={
          `${rows.length} brique(s)` +
          (volatileCount > 0 ? ` · ${volatileCount} volatile(s)` : "")
        }
        icon={<IconDatabase size={22} />}
        actions={
          <Group gap="xs">
            <DocHint
              title="Stores de persistance"
              summary="Pour chaque brique, le backend RÉELLEMENT actif au runtime, sa provenance et les backends disponibles — la matrice brique×backend, branchée sur le vrai état."
              sections={[
                {
                  label: "Store actif",
                  body: "Le backend effectivement résolu au boot (replis inclus) — pas le défaut théorique.",
                },
                {
                  label: "Provenance",
                  body: "« défaut-infra » = choisi automatiquement depuis l'infra déclarée (URLs NF_DATABASE_URL/NF_REDIS_URL). « explicite » = backend nommé dans la config ou l'env.",
                },
                {
                  label: "Durabilité",
                  body: "durable = doit survivre au redémarrage ; éphémère/session tolèrent la volatilité. Un store durable en « memory » (⚠) perd ses données au redémarrage et n'est pas partagé entre pods.",
                },
              ]}
            />
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

      <Tabs value={tab} onChange={setTab} mt="xs">
        <Tabs.List>
          <Tabs.Tab value="stores" leftSection={<IconList size={15} />}>
            Stores
          </Tabs.Tab>
          <Tabs.Tab value="transport" leftSection={<IconRoute size={15} />}>
            Fonds de panier
          </Tabs.Tab>
          <Tabs.Tab value="help" leftSection={<IconHelpCircle size={15} />}>
            Utilisation &amp; aide
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="stores" pt="md">
          <DataState
            loading={loading && !rows.length}
            error={error}
            empty={!rows.length && !infra}
            onRetry={reload}
            emptyMessage="Aucune brique de persistance résolue."
          >
            <Stack gap="lg">
              {infra && (
                <Grid>
                  <StatCard
                    label="Base de données"
                    icon={<IconDatabase size={18} />}
                    span={{ base: 12, sm: 4 }}
                    info={
                      <DocHint
                        title="Base de données"
                        summary={
                          infra.database
                            ? `Infra réseau déclarée : ${infra.database.dialect ?? infra.database.scheme}.`
                            : localDb
                              ? "Aucune infra réseau — base locale sqlite (mono-nœud)."
                              : "Aucune base persistante — mémoire (volatile)."
                        }
                        sections={[
                          {
                            label: "Source",
                            body: infra.database
                              ? "Déclarée via NF_DATABASE_URL (credentials masqués côté serveur)."
                              : localDb
                                ? "Repli local automatique (fichier sqlite sous var/) — aucune infra à déclarer en mono-nœud."
                                : "Ni infra ni backend local persistant chargé — repli mémoire (volatile).",
                          },
                          {
                            label: "Connecteurs",
                            body: "Les briques de persistance vivent sur le connecteur PRIMAIRE (default) — celui qui suit NF_DATABASE_URL. Des connecteurs DÉDIÉS (fixtures en :memory:) peuvent coexister sans suivre l'infra ; leur rôle est explicité dans l'écran ORM.",
                          },
                        ]}
                      />
                    }
                  >
                    <Text fz={22} fw={700} style={{ lineHeight: 1.2 }}>
                      {infra.database
                        ? (infra.database.dialect ?? infra.database.scheme)
                        : (localDb?.dialect ?? "—")}
                    </Text>
                    {infra.database ? (
                      <InfraUrl url={infra.database.url} />
                    ) : localDb ? (
                      <div style={{ marginTop: 4 }}>
                        <LocatorCell
                          icon={
                            <IconFolder
                              size={13}
                              style={{ flexShrink: 0, opacity: 0.6 }}
                            />
                          }
                          value={localDb.location}
                          display={baseName(localDb.location)}
                          copyLabel="Copier le chemin de la base locale"
                        />
                      </div>
                    ) : null}
                  </StatCard>
                  <StatCard
                    label="Cache (Redis)"
                    icon={<IconServer size={18} />}
                    span={{ base: 12, sm: 4 }}
                    hint={
                      infra.cache
                        ? "Cache déclaré via NF_REDIS_URL (credentials masqués)."
                        : "Aucune infra cache déclarée (NF_REDIS_URL)."
                    }
                  >
                    <Text fz={22} fw={700} style={{ lineHeight: 1.2 }}>
                      {infra.cache ? "présent" : "absent"}
                    </Text>
                    <InfraUrl url={infra.cache?.url} />
                  </StatCard>
                  <StatCard
                    label="Logs (relecture)"
                    icon={<IconServer size={18} />}
                    span={{ base: 12, sm: 4 }}
                    hint={
                      infra.logs
                        ? "Backplane de relecture déclaré (NF_LOKI_URL / NF_OPENSEARCH_URL)."
                        : "Aucune infra logs déclarée — sink stdout."
                    }
                  >
                    <Text fz={22} fw={700} style={{ lineHeight: 1.2 }}>
                      {infra.logs
                        ? infra.logs.lokiUrl
                          ? "loki"
                          : infra.logs.opensearchUrl
                            ? "opensearch"
                            : "—"
                        : "stdout"}
                    </Text>
                    <InfraUrl
                      url={infra.logs?.lokiUrl ?? infra.logs?.opensearchUrl}
                    />
                  </StatCard>
                </Grid>
              )}

              <EnginesSection engines={engines} rows={rows} />

              {volatileCount > 0 && (
                <Alert
                  variant="light"
                  color="orange"
                  icon={<IconAlertTriangle size={16} />}
                  title="Persistance volatile détectée"
                >
                  {volatileCount} brique(s) durable(s) résolue(s) en « memory »
                  : données perdues au redémarrage et non partagées entre pods.
                  Déclarer une infra durable (NF_DATABASE_URL) ou un store
                  explicite persistant.
                </Alert>
              )}

              <DataGrid
                mode="client"
                data={rows}
                columns={COLUMNS}
                getRowId={(r) => r.brick}
                searchable
                searchPlaceholder="Filtrer une brique…"
                persist={{ key: "studio.stores", storage: "session" }}
              />
            </Stack>
          </DataState>
        </Tabs.Panel>

        <Tabs.Panel value="transport" pt="md">
          {tab === "transport" && <TransportTab infra={infra} />}
        </Tabs.Panel>

        <Tabs.Panel value="help" pt="md">
          {tab === "help" && <StoresHelp />}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
});
