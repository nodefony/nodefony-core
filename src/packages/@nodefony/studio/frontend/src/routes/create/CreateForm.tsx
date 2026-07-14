/**
 * CreateForm — formulaire **piloté par la donnée** : chaque contrôle est rendu depuis une
 * question du moteur (`IScaffoldQuestion`), jamais depuis un champ écrit à la main.
 *
 * Conséquence directe : ajouter une question au scaffold (côté serveur) la fait apparaître
 * ici sans toucher à ce fichier. Les réglages `advanced` vivent dans un repli — ils ont un
 * défaut sûr, les montrer d'emblée noierait les 3 questions qui comptent (divulgation
 * progressive).
 */
import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconAdjustments,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react";
import { InfoHint } from "../../components/ui";
import {
  splitQuestions,
  validateAnswer,
  type IScaffoldQuestion,
  type IScaffoldTarget,
  type IScaffoldTypeSpec,
  type TAnswers,
} from "./createModel";

/** Options du sélecteur de cible : `""` = l'app racine, sinon le NOM du paquet du module. */
function targetOptions(
  targets: IScaffoldTarget[],
): { value: string; label: string }[] {
  return targets.map((t) =>
    t.kind === "app"
      ? { value: "", label: `${t.name} — application racine` }
      : { value: t.name, label: `${t.name} — module` },
  );
}

interface QuestionFieldProps {
  question: IScaffoldQuestion;
  value: string | boolean | undefined;
  error: string | null;
  targets: IScaffoldTarget[];
  onChange: (key: string, value: string | boolean) => void;
}

/** Un contrôle, choisi par le TYPE de la question (+ le cas particulier de la cible). */
function QuestionField({
  question,
  value,
  error,
  targets,
  onChange,
}: QuestionFieldProps) {
  // La cible n'est JAMAIS du texte libre : une faute de frappe donnerait un refus du
  // moteur (« module inconnu ») là où la liste des modules du projet est connue.
  if (question.key === "module") {
    return (
      <Select
        label={question.label}
        description="Où le code est écrit."
        data={targetOptions(targets)}
        value={typeof value === "string" ? value : ""}
        onChange={(v) => onChange(question.key, v ?? "")}
        allowDeselect={false}
        error={error}
      />
    );
  }

  if (question.type === "boolean") {
    return (
      <Checkbox
        label={question.label}
        checked={value === true}
        onChange={(e) => onChange(question.key, e.currentTarget.checked)}
      />
    );
  }

  if (question.type === "choice") {
    const data = (question.choices ?? []).map((c) => ({
      value: c.value,
      label: c.hint ? `${c.label} — ${c.hint}` : c.label,
    }));
    return (
      <Select
        label={question.label}
        data={data}
        value={typeof value === "string" ? value : ""}
        onChange={(v) => onChange(question.key, v ?? "")}
        allowDeselect={false}
        error={error}
      />
    );
  }

  return (
    <TextInput
      label={question.label}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(question.key, e.currentTarget.value)}
      error={error}
      // L'aide de validation est visible AVANT la faute (elle décrit la forme attendue),
      // pas seulement après — c'est elle qui évite l'aller-retour.
      description={question.patternHint}
    />
  );
}

export interface CreateFormProps {
  spec: IScaffoldTypeSpec;
  answers: TAnswers;
  errors: Record<string, string>;
  targets: IScaffoldTarget[];
  onChange: (key: string, value: string | boolean) => void;
}

/** Le formulaire d'un type de scaffold : questions du dialogue + repli « Réglages avancés ». */
export function CreateForm({
  spec,
  answers,
  errors,
  targets,
  onChange,
}: CreateFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { main, advanced } = splitQuestions(spec);

  return (
    <Stack gap="md">
      {main.map((q) => (
        <QuestionField
          key={q.key}
          question={q}
          value={answers[q.key]}
          error={errors[q.key] ?? validateAnswerLive(q, answers[q.key])}
          targets={targets}
          onChange={onChange}
        />
      ))}

      {advanced.length > 0 && (
        <Stack gap="xs">
          <Group gap="xs">
            <Button
              variant="subtle"
              size="compact-sm"
              color="gray"
              leftSection={<IconAdjustments size={16} />}
              rightSection={
                showAdvanced ? (
                  <IconChevronDown size={14} />
                ) : (
                  <IconChevronRight size={14} />
                )
              }
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((v) => !v)}
            >
              Réglages avancés ({advanced.length})
            </Button>
            <InfoHint text="Ces réglages ont un défaut sûr — les laisser tels quels donne le comportement recommandé." />
          </Group>
          <Collapse expanded={showAdvanced}>
            <Stack gap="md" pt="xs">
              {advanced.map((q) => (
                <QuestionField
                  key={q.key}
                  question={q}
                  value={answers[q.key]}
                  error={errors[q.key] ?? validateAnswerLive(q, answers[q.key])}
                  targets={targets}
                  onChange={onChange}
                />
              ))}
            </Stack>
          </Collapse>
        </Stack>
      )}

      {main.length === 0 && advanced.length === 0 && (
        <Alert color="gray" variant="light">
          <Text size="sm">Ce type ne demande aucune réponse.</Text>
        </Alert>
      )}
    </Stack>
  );
}

/**
 * Validation « au fil de la frappe » : on ne signale une faute que sur un champ DÉJÀ
 * rempli — sinon le formulaire s'ouvrirait tout rouge (chaque champ vide violant son
 * `pattern`), ce qui n'apprend rien.
 */
function validateAnswerLive(
  q: IScaffoldQuestion,
  value: string | boolean | undefined,
): string | null {
  if (typeof value !== "string" || value === "") return null;
  return validateAnswer(q, value);
}
