import { useRef, useState, type KeyboardEvent } from "react";
import { Inline } from "../Catalogue";
import { tabTargetIndex } from "../effects";
import { LESSON_SOURCES } from "./lessonSources";
import {
  CHAT_LESSON_STEPS,
  extractRegion,
  type ILessonExcerpt,
} from "./lessonSteps";

/**
 * Section 3 de la page d'apprentissage — « le code qui la fait » : un onglet
 * par étape du cookbook, et pour chacune les extraits CITÉS des fichiers du
 * module (`lessonSteps.ts`).
 *
 * Patron WAI-ARIA « tabs » à activation automatique : clic, flèches,
 * Début/Fin ; seul l'onglet choisi est dans l'ordre de tabulation.
 *
 * @param cookbookUrl - adresse du cookbook complet, pour la version installée
 */
export function LessonCode({ cookbookUrl }: { cookbookUrl: string }) {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = CHAT_LESSON_STEPS[selected] ?? CHAT_LESSON_STEPS[0];
  const excerpts: readonly ILessonExcerpt[] = current.excerpts;

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const next = tabTargetIndex(event.key, index, CHAT_LESSON_STEPS.length);
    if (next === null) return;
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
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
      <div className="steps" role="tablist" aria-label="Étapes du cookbook">
        {CHAT_LESSON_STEPS.map((step, index) => (
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
        <a className="step-doc" href={cookbookUrl}>
          L'étape {current.step} dans le cookbook
        </a>
      </div>
    </section>
  );
}

/** Un extrait : le fichier, la région, et son texte. */
function Excerpt({ excerpt }: { excerpt: ILessonExcerpt }) {
  const code = extractRegion(LESSON_SOURCES[excerpt.file], excerpt.region);
  return (
    <figure className="excerpt">
      <figcaption>
        <code>{excerpt.file}</code>
        <span>#{excerpt.region}</span>
      </figcaption>
      <pre>
        <code>{code ?? "(région introuvable : voir le test du module)"}</code>
      </pre>
    </figure>
  );
}
