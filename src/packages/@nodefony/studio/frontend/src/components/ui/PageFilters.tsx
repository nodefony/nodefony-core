import { useEffect, useState } from "react";
import {
  Button,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconFilterOff } from "@tabler/icons-react";

import type { AdminPageCapabilities } from "../../stores/AdminStore";
import { InfoHint } from "./StatCard";

/**
 * Habillage humain d'un filtre publié — le serveur envoie des noms techniques
 * (`hasSocial`, `failing`), pas une interface.
 *
 * Ce qui est facultatif ici l'est vraiment : sans libellé, le nom technique est
 * affiché tel quel. C'est laid mais **honnête** — un filtre publié apparaît
 * toujours, y compris celui que le serveur vient d'ajouter et que la console ne
 * connaît pas encore. L'inverse (n'afficher que les filtres pour lesquels un
 * libellé existe) ferait disparaître une capacité en silence.
 */
export interface PageFilterLabel {
  /** Libellé du filtre. Défaut : son nom technique. */
  label?: string;
  /** Bulle d'aide ⓘ à côté du libellé — dit ce que le filtre demande vraiment. */
  hint?: string;
  /**
   * Libellés des valeurs. Pour un booléen, les clés sont `"true"` / `"false"`
   * (défaut « Oui » / « Non ») ; pour une énumération, ses valeurs.
   */
  values?: Record<string, string>;
  /** Texte d'invite d'un filtre libre (`"string"` / `"int"`). */
  placeholder?: string;
}

/** Libellés par nom de filtre. */
export type PageFilterLabels = Record<string, PageFilterLabel>;

export interface PageFiltersProps {
  /**
   * Ce que l'endpoint DÉCLARE savoir filtrer (`AdminPageCapabilities.filters`),
   * ou `null` tant que le catalogue admin n'est pas chargé.
   *
   * `null` ne rend rien : une console qui devine ses filtres finit par en
   * proposer un que le serveur refuse en `400`.
   */
  spec: AdminPageCapabilities["filters"] | null;
  /** Filtres actifs — nom public → valeur telle qu'elle partira sur le fil. */
  value: Record<string, string>;
  /** Appelé à chaque changement, avec l'état COMPLET (jamais un delta). */
  onChange: (next: Record<string, string>) => void;
  /** Habillage humain — cf {@link PageFilterLabel}. */
  labels?: PageFilterLabels;
  /**
   * Filtres publiés que CETTE vue pilote ailleurs (une colonne, un onglet, un
   * champ de tête) et qui ne doivent donc pas apparaître ici en double.
   */
  omit?: readonly string[];
  /** Délai avant émission d'un filtre libre (ms). Défaut 400. */
  debounceMs?: number;
}

/** Valeur du 3ᵉ état d'un booléen : « je ne filtre pas là-dessus ». */
const ANY = "";

/**
 * Barre de filtres d'une ressource — **rend exactement ce que le serveur
 * publie**, jamais ce que la vue imagine.
 *
 * Elle existe parce que le vocabulaire de filtre d'un endpoint
 * (`IFilterSpec`, publié dans le catalogue admin) n'est pas une liste de
 * colonnes : `hasSocial` ou `failing` ne s'affichent nulle part dans le
 * tableau, et une colonne « État » qui mêle `enabled` et `locked` ne
 * correspond à aucun filtre. Les coller aux en-têtes du tableau obligeait donc
 * soit à inventer un filtre que le serveur refuse, soit à renoncer à ceux qu'il
 * offre.
 *
 * La nature déclarée décide de la saisie, et elle seule :
 *
 * | Nature publiée      | Contrôle rendu                        |
 * | ------------------- | ------------------------------------- |
 * | `"boolean"`         | 3 états — Tous / Oui / Non            |
 * | `["a", "b", …]`     | menu déroulant des valeurs, effaçable |
 * | `"string"`          | champ libre débouncé (égalité stricte)|
 * | `"int"`             | champ numérique débouncé              |
 * | *(nature inconnue)* | **rien** — on n'invente pas une saisie |
 *
 * Un filtre vidé est **retiré** de l'état, jamais émis à vide : `?enabled=`
 * n'est pas « tous », c'est une valeur mal formée que le contrat refuse.
 *
 * @example
 * ```tsx
 * const caps = store.admin.pageCapabilities("/nodefony/user/api/users");
 * const [filters, setFilters] = useState<Record<string, string>>({});
 * <PageFilters
 *   spec={caps?.filters ?? null}
 *   value={filters}
 *   onChange={setFilters}
 *   labels={{ enabled: { label: "Activé", values: { true: "Actifs" } } }}
 * />
 * ```
 */
export function PageFilters({
  spec,
  value,
  onChange,
  labels,
  omit,
  debounceMs = 400,
}: PageFiltersProps) {
  const entries = spec
    ? Object.entries(spec).filter(([name]) => !omit?.includes(name))
    : [];
  if (entries.length === 0) return null;

  const set = (name: string, next: string) => {
    const out = { ...value };
    // Vide = pas de filtre. Émettre `?x=` enverrait une valeur que le contrat
    // refuse (400) là où l'utilisateur voulait justement ne rien demander.
    if (next === "") delete out[name];
    else out[name] = next;
    onChange(out);
  };

  const active = Object.keys(value).length;

  return (
    <Group gap="lg" align="flex-end" wrap="wrap">
      {entries.map(([name, nature]) => (
        <FilterControl
          key={name}
          name={name}
          nature={nature}
          value={value[name] ?? ""}
          onChange={(next) => set(name, next)}
          label={labels?.[name]}
          debounceMs={debounceMs}
        />
      ))}
      {active > 0 && (
        <Button
          variant="subtle"
          size="xs"
          color="gray"
          leftSection={<IconFilterOff size={14} />}
          onClick={() => onChange({})}
        >
          Effacer {active} filtre{active > 1 ? "s" : ""}
        </Button>
      )}
    </Group>
  );
}

/** Un contrôle, choisi par la NATURE publiée du filtre. */
function FilterControl({
  name,
  nature,
  value,
  onChange,
  label,
  debounceMs,
}: {
  name: string;
  nature: string | string[];
  value: string;
  onChange: (next: string) => void;
  label?: PageFilterLabel;
  debounceMs: number;
}) {
  const title = label?.label ?? name;
  const head = (
    <Group gap={4} align="center" wrap="nowrap">
      <Text size="xs" fw={600} c="dimmed">
        {title}
      </Text>
      {label?.hint && <InfoHint text={label.hint} />}
    </Group>
  );

  // Énumération : le domaine est fermé et publié → menu déroulant, jamais un
  // champ libre (qui laisserait saisir une valeur refusée en 400).
  if (Array.isArray(nature)) {
    return (
      <Stack gap={4}>
        {head}
        <Select
          size="xs"
          w={170}
          clearable
          placeholder="Tous"
          aria-label={title}
          data={nature.map((v) => ({
            value: v,
            label: label?.values?.[v] ?? v,
          }))}
          value={value === "" ? null : value}
          onChange={(v) => onChange(v ?? "")}
        />
      </Stack>
    );
  }

  if (nature === "boolean") {
    return (
      <Stack gap={4}>
        {head}
        <SegmentedControl
          size="xs"
          aria-label={title}
          value={value === "" ? ANY : value}
          onChange={(v) => onChange(v === ANY ? "" : v)}
          data={[
            { value: ANY, label: "Tous" },
            { value: "true", label: label?.values?.true ?? "Oui" },
            { value: "false", label: label?.values?.false ?? "Non" },
          ]}
        />
      </Stack>
    );
  }

  if (nature === "string" || nature === "int") {
    return (
      <Stack gap={4}>
        {head}
        <DebouncedFilterInput
          numeric={nature === "int"}
          value={value}
          onChange={onChange}
          placeholder={label?.placeholder ?? "Valeur exacte"}
          ariaLabel={title}
          delay={debounceMs}
        />
      </Stack>
    );
  }

  // Nature inconnue de cette console : ne rien rendre. Un champ libre « au cas
  // où » enverrait une valeur dont on ignore la forme attendue.
  return null;
}

/**
 * Champ de filtre libre — n'émet qu'après une pause de frappe.
 *
 * Sans ce délai, chaque touche déclencherait un tour de page complet côté
 * serveur (`?user=a`, `?user=al`, `?user=ali`…) : sept requêtes pour un mot,
 * dont six dont personne ne lira jamais le résultat.
 */
function DebouncedFilterInput({
  numeric,
  value,
  onChange,
  placeholder,
  ariaLabel,
  delay,
}: {
  numeric: boolean;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
  delay: number;
}) {
  const [draft, setDraft] = useState(value);
  const [debounced] = useDebouncedValue(draft, delay);

  // La valeur peut changer SANS passer par la frappe (bouton « Effacer », clic
  // sur une carte de tête, restauration d'un état) : la saisie suit alors.
  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // `onChange` et `value` sont volontairement hors dépendances : n'émettre
    // que sur la pause de frappe, pas à chaque rendu du parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  if (numeric) {
    return (
      <NumberInput
        size="xs"
        w={140}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={draft === "" ? "" : Number(draft)}
        onChange={(v) => setDraft(v === "" ? "" : String(v))}
      />
    );
  }
  return (
    <TextInput
      size="xs"
      w={180}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
    />
  );
}
