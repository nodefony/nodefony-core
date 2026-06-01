/**
 * **ConfigLayout** — brique **générique** de visualisation de la configuration
 * d'un module Nodefony. Réutilisable PARTOUT (core, @nodefony/*, app, modules
 * tiers) → la même grille de lecture config sur tout l'écosystème.
 *
 * Conçue autour du **schéma Zod** d'un module (clé, type, contraintes, défaut +
 * flags Nodefony : `runtimeMutable` / `reserved` / `kernelDerived` / `secret`).
 * Deux modes, choisis AUTOMATIQUEMENT selon les données fournies :
 *
 *  - **Mode schéma** (aucune valeur effective) : montre ce qui est CONFIGURABLE —
 *    réglage + rôle, valeur par défaut, type & valeurs possibles, et l'« état »
 *    (modifiable à chaud / au redémarrage / réservé / dérivé / secret). C'est le
 *    cas tant que la config effective n'est pas exposée par une API.
 *  - **Mode effectif** (au moins un champ porte `effective`) : ajoute la VALEUR
 *    EFFECTIVE et sa **provenance** dans la cascade de surcharge
 *    (défaut → module → app → env : la dernière définie gagne).
 *
 * 100 % présentation : la page consommatrice mappe son schéma Zod (idéalement via
 * `z.toJSONSchema()`) vers `sections`. La structure ne change pas quand on passe
 * du mode schéma au mode effectif.
 */
import type { ReactNode } from "react";
import {
  Badge,
  Box,
  Card,
  Code,
  Group,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconSettings,
  IconBolt,
  IconLock,
  IconWand,
  IconEyeOff,
  IconArrowRight,
} from "@tabler/icons-react";
import { DocHint } from "./DocHint";

/** D'où vient la valeur effective gagnante dans la cascade de surcharge. */
export type ConfigSource = "default" | "module" | "app" | "env" | "runtime";

/** Mutabilité d'un réglage : à chaud (dev) / au redémarrage / lecture seule. */
export type ConfigMutability = "live" | "boot" | "readonly";

/** État de migration du schéma de validation d'un module. */
export type ConfigSchemaStatus = "zod" | "partial" | "none";

/** Un réglage de configuration (une ligne). */
export interface ConfigField {
  /** Clé (`headerServer`, `session.handler`, `upload.uploadDir`…). */
  key: string;
  /** Type/forme issu du schéma Zod (`enum`, `string`, `number`, `boolean`, `url`…). */
  type?: string;
  /** Valeurs possibles / contrainte (enum, min/max, nullable) issue de Zod. */
  constraint?: ReactNode;
  /** Valeur par défaut (schéma / framework). */
  defaultValue?: ReactNode;
  /** Rôle / explication courte du réglage. */
  description?: ReactNode;
  /** Mutabilité runtime (du flag `runtimeMutable`). */
  mutability: ConfigMutability;
  /** Réservé à une feature future (flag `reserved`) — non lu en runtime. */
  reserved?: boolean;
  /** Défaut dérivé du kernel (flag `kernelDerived`) — affiché « auto ». */
  kernelDerived?: boolean;
  /** Donnée sensible (flag `secret`) — masquée. */
  secret?: boolean;
  /**
   * Valeur EFFECTIVE (mode effectif). Si AUCUN champ n'en porte, l'écran reste en
   * mode schéma (colonnes effective/provenance masquées).
   */
  effective?: ReactNode;
  /** Provenance de la valeur effective (requise en mode effectif). */
  source?: ConfigSource;
  /** Variable d'environnement associée (12-factor). */
  env?: string;
}

/** Un groupe de réglages (par domaine). */
export interface ConfigSection {
  title: string;
  description?: ReactNode;
  fields: ConfigField[];
}

export interface ConfigLayoutProps {
  /** Nom du module (en-tête). */
  module: string;
  /** État de migration du schéma de validation. Défaut `none`. */
  schema?: ConfigSchemaStatus;
  /** Sections de réglages. */
  sections: ConfigSection[];
  /** Bandeau d'avertissement / contexte (ex. préparation, config non exposée). */
  notice?: ReactNode;
}

const SOURCE_META: Record<
  ConfigSource,
  { label: string; color: string; help: string }
> = {
  default: {
    label: "défaut",
    color: "gray",
    help: "Valeur par défaut du schéma (aucune surcharge).",
  },
  module: {
    label: "module",
    color: "blue",
    help: "Surchargée dans la config du module.",
  },
  app: {
    label: "app",
    color: "grape",
    help: "Surchargée dans la config de l'application (config.ts).",
  },
  env: {
    label: "env",
    color: "teal",
    help: "Surchargée par une variable d'environnement (priorité max).",
  },
  runtime: {
    label: "runtime",
    color: "cyan",
    help: "Dérivée de l'environnement d'exécution.",
  },
};

const SCHEMA_META: Record<
  ConfigSchemaStatus,
  { label: string; color: string; help: string }
> = {
  zod: {
    label: "validé Zod",
    color: "teal",
    help: "Config validée par un schéma Zod au démarrage : types, valeurs et contraintes garantis. Un boot avec une config invalide échoue tôt (fail-fast).",
  },
  partial: {
    label: "schéma partiel",
    color: "yellow",
    help: "Une partie de la config est validée par Zod ; le reste est en migration.",
  },
  none: {
    label: "non migré (Zod)",
    color: "gray",
    help: "Module pas encore migré vers la validation Zod (dette config).",
  },
};

/** Badge de provenance (cascade de surcharge). */
function SourceBadge({ source }: { source: ConfigSource }) {
  const m = SOURCE_META[source];
  return (
    <Tooltip label={m.help} multiline w={260} withArrow>
      <Badge size="xs" variant="light" color={m.color} tt="none">
        {m.label}
      </Badge>
    </Tooltip>
  );
}

/**
 * Badges d'**état** d'un réglage = la réponse à « puis-je le changer ? ». Combine
 * mutabilité + flags Nodefony (réservé / dérivé kernel / secret). Un seul coup
 * d'œil suffit.
 */
function StateBadges({ f }: { f: ConfigField }) {
  return (
    <Group gap={4} wrap="wrap">
      {f.reserved ? (
        <Tooltip
          label="Réservé à une feature future — pas lu en runtime aujourd'hui."
          multiline
          w={240}
          withArrow
        >
          <Badge
            size="sm"
            variant="light"
            color="gray"
            leftSection={<IconLock size={11} />}
            tt="none"
          >
            réservé
          </Badge>
        </Tooltip>
      ) : f.mutability === "live" ? (
        <Tooltip
          label="Modifiable à chaud (relu à chaque requête) — en développement. Figé en production."
          multiline
          w={260}
          withArrow
        >
          <Badge
            size="sm"
            variant="light"
            color="teal"
            leftSection={<IconBolt size={11} />}
            tt="none"
          >
            à chaud (dev)
          </Badge>
        </Tooltip>
      ) : f.mutability === "readonly" ? (
        <Badge
          size="sm"
          variant="light"
          color="gray"
          leftSection={<IconLock size={11} />}
          tt="none"
        >
          lecture seule
        </Badge>
      ) : (
        <Tooltip
          label="Pris en compte au démarrage (12-factor) — éditer la config / l'env puis redémarrer."
          multiline
          w={260}
          withArrow
        >
          <Badge
            size="sm"
            variant="light"
            color="gray"
            leftSection={<IconLock size={11} />}
            tt="none"
          >
            au redémarrage
          </Badge>
        </Tooltip>
      )}
      {f.kernelDerived && (
        <Tooltip
          label="Valeur par défaut calculée à partir du kernel (tmpDir, domain…) → affichée « auto »."
          multiline
          w={260}
          withArrow
        >
          <Badge
            size="sm"
            variant="light"
            color="cyan"
            leftSection={<IconWand size={11} />}
            tt="none"
          >
            auto (kernel)
          </Badge>
        </Tooltip>
      )}
      {f.secret && (
        <Tooltip
          label="Donnée sensible : masquée dans Studio, rédigée dans les logs."
          multiline
          w={240}
          withArrow
        >
          <Badge
            size="sm"
            variant="light"
            color="orange"
            leftSection={<IconEyeOff size={11} />}
            tt="none"
          >
            secret
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}

/** Aide « comment lire la cascade de surcharge » (rendue dans l'en-tête). */
function CascadeHint() {
  const chain: ConfigSource[] = ["default", "module", "app", "env"];
  return (
    <DocHint
      title="Cascade de surcharge"
      summary="La valeur effective d'un réglage est calculée en empilant les sources : chaque niveau peut surcharger le précédent. La DERNIÈRE source définie gagne."
      sections={[
        {
          label: "Ordre de priorité",
          body: (
            <Group gap={6} wrap="wrap">
              {chain.map((s, i) => (
                <Group key={s} gap={6} wrap="nowrap">
                  {i > 0 && (
                    <IconArrowRight size={12} style={{ opacity: 0.5 }} />
                  )}
                  <SourceBadge source={s} />
                </Group>
              ))}
            </Group>
          ),
        },
        {
          label: "12-factor",
          body: "La variable d'environnement a le dernier mot : déployer sans toucher au code. La colonne « Provenance » dit d'où vient la valeur gagnante.",
        },
      ]}
    />
  );
}

/**
 * Visualise la configuration d'un module : en-tête + statut schéma, puis une
 * table par section. Mode schéma ou effectif selon les données.
 */
export function ConfigLayout({
  module,
  schema = "none",
  sections,
  notice,
}: ConfigLayoutProps) {
  const sm = SCHEMA_META[schema];
  // Mode effectif dès qu'un champ porte une valeur effective (sinon mode schéma).
  const hasEffective = sections.some((s) =>
    s.fields.some((f) => f.effective !== undefined),
  );

  return (
    <Stack gap="lg">
      {/* En-tête : module + statut du schéma de validation. */}
      <Group gap="sm" wrap="wrap">
        <ThemeIcon variant="light" color="brand" size="lg" radius="md">
          <IconSettings size={20} />
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text
            fz={10}
            fw={700}
            tt="uppercase"
            c="dimmed"
            style={{ letterSpacing: 0.4 }}
          >
            Configuration
          </Text>
          <Group gap={6} wrap="nowrap">
            <Title order={4}>{module}</Title>
            <Tooltip label={sm.help} multiline w={300} withArrow>
              <Badge variant="light" color={sm.color} tt="none">
                {sm.label}
              </Badge>
            </Tooltip>
            <DocHint
              title="Validation de la configuration (Zod)"
              summary="Nodefony valide la configuration au démarrage avec Zod : un réglage invalide fait échouer le boot tôt, plutôt qu'un bug obscur en cours d'exécution."
              sections={[
                {
                  label: "Source de vérité",
                  body: "Le schéma documente les clés, leurs types, leurs valeurs possibles et leurs défauts. C'est « ce qui est configurable ».",
                },
                {
                  label: "Migration progressive",
                  body: "Tous les modules ne sont pas encore migrés ; un badge signale l'état (validé Zod / partiel / non migré).",
                },
              ]}
            />
            {hasEffective && <CascadeHint />}
          </Group>
        </div>
      </Group>

      {notice}

      {sections.map((section) => (
        <Stack key={section.title} gap="xs">
          <Title order={5}>{section.title}</Title>
          {section.description && (
            <Text size="sm" c="dimmed">
              {section.description}
            </Text>
          )}
          <Card withBorder radius="md" p={0}>
            <Table
              striped
              withRowBorders={false}
              verticalSpacing="sm"
              horizontalSpacing="md"
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 280 }}>Réglage</Table.Th>
                  {hasEffective && (
                    <Table.Th style={{ width: 190 }}>Valeur effective</Table.Th>
                  )}
                  <Table.Th style={{ width: 150 }}>Défaut</Table.Th>
                  <Table.Th style={{ width: 200 }}>Type & valeurs</Table.Th>
                  <Table.Th style={{ width: 180 }}>État</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {section.fields.map((f) => (
                  <Table.Tr key={f.key}>
                    {/* Réglage = clé + rôle (lisible d'un coup). */}
                    <Table.Td>
                      <Stack gap={2}>
                        <Group gap={4} wrap="wrap">
                          <Code style={{ fontSize: 12 }}>{f.key}</Code>
                          {f.env && (
                            <Tooltip label="Variable d'environnement (12-factor)">
                              <Code style={{ fontSize: 10 }}>{f.env}</Code>
                            </Tooltip>
                          )}
                        </Group>
                        {f.description && (
                          <Text size="xs" c="dimmed">
                            {f.description}
                          </Text>
                        )}
                      </Stack>
                    </Table.Td>
                    {hasEffective && (
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Box style={{ minWidth: 0 }}>
                            {f.effective ?? (
                              <Text size="xs" c="dimmed">
                                —
                              </Text>
                            )}
                          </Box>
                          {f.source && <SourceBadge source={f.source} />}
                        </Group>
                      </Table.Td>
                    )}
                    <Table.Td>
                      {f.defaultValue ?? (
                        <Text size="xs" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        {f.type && (
                          <Badge size="xs" variant="default" tt="none">
                            {f.type}
                          </Badge>
                        )}
                        {f.constraint && (
                          <Text size="xs" c="dimmed">
                            {f.constraint}
                          </Text>
                        )}
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <StateBadges f={f} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </Stack>
      ))}
    </Stack>
  );
}
