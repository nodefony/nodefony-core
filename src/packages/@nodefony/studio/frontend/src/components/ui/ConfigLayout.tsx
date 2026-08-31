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
import { useMemo, useState, type ReactNode } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Card,
  Code,
  CopyButton,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
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
  IconSearch,
  IconCheck,
  IconCopy,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import { DocHint, TipHint, WarnHint } from "./DocHint";

/** D'où vient la valeur effective gagnante dans la cascade de surcharge. */
export type ConfigSource = "default" | "module" | "app" | "env" | "runtime";

/** Mutabilité d'un réglage : à chaud (dev) / au redémarrage / lecture seule. */
export type ConfigMutability = "live" | "boot" | "readonly";

/** État de migration du schéma de validation d'un module. */
export type ConfigSchemaStatus = "zod" | "partial" | "none";

/**
 * Descripteur d'un contrôle d'édition d'un champ, dérivé du JSON Schema côté
 * mappeur (`jsonSchemaToSections`). ConfigLayout reste 100 % présentation : il
 * REND ce descripteur, il ne parse jamais le schéma lui-même.
 */
export type ConfigEditControl =
  | { kind: "select"; options: string[]; nullable?: boolean }
  | { kind: "switch" }
  | {
      kind: "number";
      min?: number;
      max?: number;
      integer?: boolean;
      nullable?: boolean;
    }
  | { kind: "text"; nullable?: boolean };

/** Verdict d'une tentative d'édition live (autoritaire = serveur). */
export interface EditResult {
  ok: boolean;
  /** Message d'échec (validation/refus serveur) à afficher inline. */
  error?: string;
}

/** Un réglage de configuration (une ligne). */
export interface ConfigField {
  /** Clé (`headerServer`, `session.store`, `upload.uploadDir`…). */
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
  /**
   * Recette d'override `NF__<SEG>__<CHEMIN>` (12-factor) — comment surcharger ce
   * champ au déploiement sans toucher au code. Rendue dans la colonne « Recette »
   * avec un bouton copier (injectée par `withOverrideKeys`).
   */
  recipe?: string;
  /**
   * Contrôle d'édition à dériver (champ `runtimeMutable` non secret uniquement).
   * Absent = non éditable inline (lecture seule, recette d'override pour le reste).
   */
  editControl?: ConfigEditControl;
  /** Valeur courante BRUTE (initialise le contrôle d'édition). */
  editValue?: unknown;
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
  /**
   * Active l'édition LIVE (réservé au dev — le serveur reste autoritaire et
   * refuse hors dev). Un contrôle inline n'apparaît QUE sur un champ « à chaud »
   * (`mutability:"live"`, non secret/réservé) pourvu d'un `editControl`.
   */
  editable?: boolean;
  /**
   * Applique une édition : renvoie le verdict serveur (succès/refus). La page
   * branche ici son `PATCH …/config/{module}` + toast + refetch de provenance.
   */
  onEdit?: (field: ConfigField, value: unknown) => Promise<EditResult>;
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
    help: "Valeur posée à l'exécution : éditée à chaud en développement (éphémère, perdue au redémarrage) ou dérivée du runtime.",
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
    <DocHint title="Provenance de la valeur" summary={m.help} width={260}>
      <Badge
        size="xs"
        variant="light"
        color={m.color}
        tt="none"
        style={{ cursor: "help" }}
      >
        {m.label}
      </Badge>
    </DocHint>
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
        <WarnHint
          title="Réservé"
          summary="Réservé à une feature future — pas lu en runtime aujourd'hui."
          width={240}
        >
          <Badge
            size="sm"
            variant="light"
            color="gray"
            leftSection={<IconLock size={11} />}
            tt="none"
            style={{ cursor: "help" }}
          >
            réservé
          </Badge>
        </WarnHint>
      ) : f.mutability === "live" ? (
        <TipHint
          title="Modifiable à chaud"
          summary="Relu à chaque requête — modifiable en développement sans redémarrage. Figé en production."
          width={260}
        >
          <Badge
            size="sm"
            variant="light"
            color="teal"
            leftSection={<IconBolt size={11} />}
            tt="none"
            style={{ cursor: "help" }}
          >
            à chaud (dev)
          </Badge>
        </TipHint>
      ) : f.mutability === "readonly" ? (
        <DocHint
          title="Lecture seule"
          summary="Réglage non modifiable au runtime."
          width={220}
        >
          <Badge
            size="sm"
            variant="light"
            color="gray"
            leftSection={<IconLock size={11} />}
            tt="none"
            style={{ cursor: "help" }}
          >
            lecture seule
          </Badge>
        </DocHint>
      ) : (
        <DocHint
          title="Au redémarrage"
          summary="Pris en compte au démarrage (12-factor) — éditer la config / l'env puis redémarrer le serveur."
          width={260}
        >
          <Badge
            size="sm"
            variant="light"
            color="gray"
            leftSection={<IconLock size={11} />}
            tt="none"
            style={{ cursor: "help" }}
          >
            au redémarrage
          </Badge>
        </DocHint>
      )}
      {f.kernelDerived && (
        <DocHint
          title="Auto (kernel)"
          summary="Valeur par défaut calculée à partir du kernel (tmpDir, domain…) → affichée « auto » ; la valeur effective est la valeur résolue au boot."
          width={260}
        >
          <Badge
            size="sm"
            variant="light"
            color="cyan"
            leftSection={<IconWand size={11} />}
            tt="none"
            style={{ cursor: "help" }}
          >
            auto (kernel)
          </Badge>
        </DocHint>
      )}
      {f.secret && (
        <WarnHint
          title="Secret"
          summary="Donnée sensible : masquée dans Studio, rédigée dans les logs."
          width={240}
        >
          <Badge
            size="sm"
            variant="light"
            color="orange"
            leftSection={<IconEyeOff size={11} />}
            tt="none"
            style={{ cursor: "help" }}
          >
            secret
          </Badge>
        </WarnHint>
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

/** Normalise pour une recherche tolérante (sans accents, minuscules). */
function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Concatène le texte recherchable d'un réglage (champs string uniquement). */
function fieldSearchText(f: ConfigField): string {
  const parts = [f.key];
  if (typeof f.type === "string") parts.push(f.type);
  if (typeof f.description === "string") parts.push(f.description);
  if (typeof f.constraint === "string") parts.push(f.constraint);
  return parts.join(" ");
}

/** Cellule « Recette » 12-factor : la var `NF__…` à copier pour surcharger au déploiement. */
function RecipeCell({ recipe }: { recipe: string }) {
  return (
    <Group gap={4} wrap="nowrap">
      <Code style={{ fontSize: 11 }}>{recipe}</Code>
      <CopyButton value={recipe} timeout={1500}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? "Copié" : "Copier"} withArrow>
            <ActionIcon
              size="sm"
              variant="subtle"
              color={copied ? "teal" : "gray"}
              aria-label={`Copier ${recipe}`}
              onClick={copy}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
}

/** Un champ porte-t-il un éditeur inline (édition live activée + champ « à chaud ») ? */
function isEditable(f: ConfigField, editable: boolean): boolean {
  return (
    editable &&
    !!f.editControl &&
    f.mutability === "live" &&
    !f.secret &&
    !f.reserved
  );
}

/** Bouton « appliquer » des contrôles libres (number/text) — actif si modifié. */
function SaveBtn({
  onClick,
  pending,
  dirty,
}: {
  onClick: () => void;
  pending: boolean;
  dirty: boolean;
}) {
  return (
    <Tooltip label="Appliquer (Entrée)" withArrow>
      <ActionIcon
        size="sm"
        variant="light"
        color="brand"
        disabled={!dirty || pending}
        loading={pending}
        onClick={onClick}
        aria-label="Appliquer la valeur"
      >
        <IconDeviceFloppy size={14} />
      </ActionIcon>
    </Tooltip>
  );
}

/**
 * Éditeur inline d'un champ « à chaud ». Dérive le contrôle Mantine du
 * descripteur `editControl` (select / switch / number / text). Optimiste avec
 * rollback : le serveur reste autoritaire — un refus (`{ ok:false }`) restaure
 * la dernière valeur valide et affiche le message inline.
 */
function FieldEditor({
  field,
  onEdit,
}: {
  field: ConfigField;
  onEdit: NonNullable<ConfigLayoutProps["onEdit"]>;
}) {
  const ctrl = field.editControl as ConfigEditControl;
  const [val, setVal] = useState<unknown>(field.editValue);
  const [draft, setDraft] = useState<string>(
    field.editValue == null ? "" : String(field.editValue),
  );
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const commit = async (next: unknown) => {
    if (pending) return;
    setPending(true);
    setErr(null);
    setSaved(false);
    const res = await onEdit(field, next);
    setPending(false);
    if (res.ok) {
      setVal(next);
      setDraft(next == null ? "" : String(next));
      setSaved(true);
    } else {
      setErr(res.error ?? "refusé");
      setDraft(val == null ? "" : String(val)); // rollback du champ libre
    }
  };

  const onDirty = () => {
    if (saved) setSaved(false);
    if (err) setErr(null);
  };

  const submitNumber = () => {
    if (draft === "") {
      if (ctrl.kind === "number" && ctrl.nullable) commit(null);
      return;
    }
    const n = Number(draft);
    if (Number.isNaN(n)) {
      setErr("nombre invalide");
      return;
    }
    if (val === n) return;
    commit(n);
  };

  const submitText = () => {
    const nullable = ctrl.kind === "text" && ctrl.nullable;
    const next = nullable && draft.trim() === "" ? null : draft;
    if ((val ?? null) === (next ?? null)) return;
    commit(next);
  };

  let control: ReactNode = null;
  if (ctrl.kind === "switch") {
    control = (
      <Switch
        size="sm"
        checked={val === true}
        disabled={pending}
        onChange={(e) => commit(e.currentTarget.checked)}
        aria-label={`Modifier ${field.key}`}
      />
    );
  } else if (ctrl.kind === "select") {
    const NULL = "∅ (null)";
    const data = ctrl.nullable ? [...ctrl.options, NULL] : ctrl.options;
    control = (
      <Select
        size="xs"
        w={170}
        data={data}
        value={val == null ? (ctrl.nullable ? NULL : null) : String(val)}
        disabled={pending}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
        onChange={(v) => v != null && commit(v === NULL ? null : v)}
        aria-label={`Modifier ${field.key}`}
      />
    );
  } else if (ctrl.kind === "number") {
    control = (
      <Group gap={4} wrap="nowrap">
        <NumberInput
          size="xs"
          w={120}
          value={draft === "" ? "" : Number(draft)}
          min={ctrl.min}
          max={ctrl.max}
          allowDecimal={!ctrl.integer}
          disabled={pending}
          onChange={(v) => {
            onDirty();
            setDraft(v === "" ? "" : String(v));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitNumber();
          }}
          aria-label={`Modifier ${field.key}`}
        />
        <SaveBtn
          onClick={submitNumber}
          pending={pending}
          dirty={String(val ?? "") !== draft}
        />
      </Group>
    );
  } else {
    control = (
      <Group gap={4} wrap="nowrap">
        <TextInput
          size="xs"
          w={170}
          value={draft}
          placeholder={
            ctrl.kind === "text" && ctrl.nullable ? "(vide = null)" : undefined
          }
          disabled={pending}
          onChange={(e) => {
            onDirty();
            setDraft(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitText();
          }}
          aria-label={`Modifier ${field.key}`}
        />
        <SaveBtn
          onClick={submitText}
          pending={pending}
          dirty={(val == null ? "" : String(val)) !== draft}
        />
      </Group>
    );
  }

  return (
    <Stack gap={2}>
      <Group gap={4} wrap="nowrap">
        {control}
        {saved && (
          <IconCheck
            size={15}
            color="var(--mantine-color-teal-6)"
            aria-label="Enregistré"
          />
        )}
      </Group>
      {err && (
        <Text size="xs" c="red">
          {err}
        </Text>
      )}
    </Stack>
  );
}

/**
 * Visualise la configuration d'un module : en-tête + statut schéma, recherche,
 * puis une table par section. Mode schéma ou effectif selon les données.
 */
export function ConfigLayout({
  module,
  schema = "none",
  sections,
  notice,
  editable = false,
  onEdit,
}: ConfigLayoutProps) {
  const sm = SCHEMA_META[schema];
  const [query, setQuery] = useState("");

  // Filtre tolérant (accents-insensible, multi-termes : tous les mots présents)
  // sur clé + titre de section + type + description + contrainte. Les sections
  // sans champ retenu sont masquées.
  const totalFields = sections.reduce((n, s) => n + s.fields.length, 0);
  const visibleSections = useMemo(() => {
    const terms = normalizeText(query.trim()).split(/\s+/).filter(Boolean);
    if (!terms.length) return sections;
    return sections
      .map((s) => ({
        ...s,
        fields: s.fields.filter((f) => {
          const hay = normalizeText(`${fieldSearchText(f)} ${s.title}`);
          return terms.every((t) => hay.includes(t));
        }),
      }))
      .filter((s) => s.fields.length > 0);
  }, [sections, query]);
  const shownFields = visibleSections.reduce((n, s) => n + s.fields.length, 0);
  // Mode effectif dès qu'un champ porte une valeur effective (sinon mode schéma).
  const hasEffective = sections.some((s) =>
    s.fields.some((f) => f.effective !== undefined),
  );
  // La cascade de PROVENANCE (défaut→module→app→env) ne s'affiche QUE si au moins
  // un champ porte une `source` : on ne montre l'aide « d'où vient la valeur » que
  // quand on sait répondre. Sinon (valeur effective sans provenance), on affiche la
  // valeur sans prétendre connaître son origine.
  const hasSource = sections.some((s) =>
    s.fields.some((f) => f.source !== undefined),
  );
  // Colonne « Recette » (12-factor) dès qu'un champ porte une recette d'override.
  const hasRecipe = sections.some((s) =>
    s.fields.some((f) => f.recipe !== undefined),
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
            <DocHint title="Statut du schéma" summary={sm.help} width={300}>
              <Badge
                variant="light"
                color={sm.color}
                tt="none"
                style={{ cursor: "help" }}
              >
                {sm.label}
              </Badge>
            </DocHint>
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
            {hasSource && <CascadeHint />}
          </Group>
        </div>
      </Group>

      {notice}

      <Group justify="space-between" align="center" gap="sm" wrap="wrap">
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Rechercher un réglage…"
          aria-label="Rechercher un réglage de configuration"
          leftSection={<IconSearch size={15} />}
          size="sm"
          w={320}
        />
        <Text
          size="xs"
          c="dimmed"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {query.trim()
            ? `${shownFields} / ${totalFields} réglages`
            : `${totalFields} réglages`}
        </Text>
      </Group>

      {visibleSections.length === 0 && (
        <Text c="dimmed" size="sm">
          Aucun réglage ne correspond à «&nbsp;{query.trim()}&nbsp;».
        </Text>
      )}

      {visibleSections.map((section) => (
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
                  {hasRecipe && (
                    <Table.Th style={{ width: 230 }}>
                      <Group gap={4} wrap="nowrap">
                        Recette
                        <DocHint
                          title="Recette d'override (12-factor)"
                          summary="La variable d'environnement qui surcharge ce réglage SANS toucher au code (NF__<MODULE>__<CHEMIN>). À copier dans .env.local / l'orchestrateur (priorité maximale dans la cascade)."
                          width={280}
                        />
                      </Group>
                    </Table.Th>
                  )}
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
                            <DocHint
                              title="Variable d'environnement"
                              summary="Surcharge 12-factor : définir cette variable d'environnement surcharge le réglage au déploiement (priorité max dans la cascade)."
                              width={260}
                            >
                              <Code style={{ fontSize: 10, cursor: "help" }}>
                                {f.env}
                              </Code>
                            </DocHint>
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
                            {isEditable(f, editable) && onEdit ? (
                              <FieldEditor field={f} onEdit={onEdit} />
                            ) : (
                              (f.effective ?? (
                                <Text size="xs" c="dimmed">
                                  —
                                </Text>
                              ))
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
                    {hasRecipe && (
                      <Table.Td>
                        {f.recipe ? (
                          <RecipeCell recipe={f.recipe} />
                        ) : (
                          <Text size="xs" c="dimmed">
                            —
                          </Text>
                        )}
                      </Table.Td>
                    )}
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
