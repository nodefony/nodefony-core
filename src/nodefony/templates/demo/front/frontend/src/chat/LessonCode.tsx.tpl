import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Inline } from "../Catalogue";
import { tabTargetIndex } from "../effects";
import { highlight } from "../highlight";
import { resolveConstants } from "./lessonConstants";
import { LESSON_SOURCES } from "./lessonSources";
import {
  extractRegion,
  type ILessonDecorator,
  type ILessonExcerpt,
  type ILessonStep,
} from "./lessonSteps";

/** Ce qu'une page d'apprentissage donne à sa section de code. */
export interface ILessonCodeProps {
  steps: readonly ILessonStep[];
  decorators: readonly ILessonDecorator[];
  /** Nom des onglets pour les lecteurs d'écran (« Étapes du cookbook »). */
  stepsLabel: string;
  /** Le lien de doc sous chaque étape. */
  doc: { href: string; label: (step: number) => string };
}

/**
 * Section 3 d'une page d'apprentissage — « le code qui la fait » : un onglet
 * par étape, et pour chacune les extraits CITÉS des fichiers du module,
 * colorés, avec ce qu'il faut y lire. Sous les onglets, tous les décorateurs
 * employés, chacun relié à l'étape qui le montre. Sert le chat
 * (`lessonSteps.ts`) comme l'API entre programmes (`partnerSteps.ts`).
 *
 * Patron WAI-ARIA « tabs » à activation automatique : clic, flèches,
 * Début/Fin ; seul l'onglet choisi est dans l'ordre de tabulation.
 */
export function LessonCode({
  steps,
  decorators,
  stepsLabel,
  doc,
}: ILessonCodeProps) {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = steps.at(selected) ?? steps.at(0);
  if (current === undefined) return null;
  const excerpts = current.excerpts;

  const select = (index: number) => {
    setSelected(index);
    tabs.current[index]?.focus();
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const next = tabTargetIndex(event.key, index, steps.length);
    if (next === null) return;
    event.preventDefault();
    select(next);
  };

  /** Va à l'étape qui montre un décorateur, et l'amène dans la vue. */
  const showStep = (step: number) => {
    const index = steps.findIndex((entry) => entry.step === step);
    if (index === -1) return;
    select(index);
    tabs.current[index]?.scrollIntoView({ block: "nearest" });
  };

  return (
    <section className="lesson-code" aria-labelledby="lesson-code-title">
      <h2 id="lesson-code-title" className="lesson-step">
        3 · Le code qui la fait
      </h2>
      <p>
        Chaque extrait est lu dans les fichiers de ce module au moment de la
        construction : c'est le code qui tourne au-dessus, pas une copie.
      </p>
      <div className="steps" role="tablist" aria-label={stepsLabel}>
        {steps.map((step, index) => (
          <button
            key={step.step}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`step-tab-${step.step}`}
            aria-controls="step-panel"
            aria-selected={index === selected}
            tabIndex={index === selected ? 0 : -1}
            className={step.status === "soon" ? "step-tab soon" : "step-tab"}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className="step-num">{step.step}</span> {step.title}
          </button>
        ))}
      </div>
      <div
        id="step-panel"
        role="tabpanel"
        aria-labelledby={`step-tab-${current.step}`}
        className="step-panel"
      >
        <p className="step-summary">
          <Inline text={current.summary} />
        </p>
        {excerpts.length === 0 ? (
          <p className="step-soon">Démo à venir.</p>
        ) : (
          excerpts.map((excerpt) => (
            <Excerpt
              key={`${excerpt.file}#${excerpt.region}`}
              excerpt={excerpt}
            />
          ))
        )}
        <a className="step-doc" href={doc.href}>
          {doc.label(current.step)}
        </a>
      </div>
      <div className="decorators">
        <h3>Les {decorators.length} décorateurs de cette démo</h3>
        <p>
          Toute la mécanique est déclarée : le framework lit ces décorateurs au
          démarrage, et l'action ne contient plus que le métier.
        </p>
        <ul>
          {decorators.map((decorator) => (
            <li key={decorator.name}>
              <code className="decorator-name">@{decorator.name}</code>
              <span className="decorator-from">{decorator.from}</span>
              <p>
                <Inline text={decorator.role} />
              </p>
              <button type="button" onClick={() => showStep(decorator.step)}>
                Voir à l'étape {decorator.step}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Un extrait : le fichier, la région, ce qu'il faut y lire, et son texte coloré. */
function Excerpt({ excerpt }: { excerpt: ILessonExcerpt }) {
  const code = extractRegion(LESSON_SOURCES[excerpt.file], excerpt.region);
  const tokens = useMemo(
    () => (code === null ? null : highlight(code)),
    [code],
  );
  const constants = useMemo(
    () => (code === null ? [] : resolveConstants(code, LESSON_SOURCES)),
    [code],
  );
  return (
    <figure className="excerpt">
      <figcaption>
        <code>{excerpt.file}</code>
        <span>#{excerpt.region}</span>
      </figcaption>
      <p className="excerpt-note">
        <Inline text={excerpt.note} />
      </p>
      <pre>
        <code>
          {tokens === null
            ? "(région introuvable : voir le test du module)"
            : tokens.map((token) => (
                <span
                  key={token.at}
                  className={
                    token.kind === "plain" ? undefined : `tok-${token.kind}`
                  }
                >
                  {token.text}
                </span>
              ))}
        </code>
      </pre>
      {constants.length > 0 && (
        <dl className="excerpt-consts" aria-label="Constantes de cet extrait">
          {constants.map((constant) => (
            <div key={constant.name}>
              <dt>
                <code>{constant.name}</code>
              </dt>
              <dd>
                <code>{constant.value}</code>
                <span>{constant.file}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </figure>
  );
}
