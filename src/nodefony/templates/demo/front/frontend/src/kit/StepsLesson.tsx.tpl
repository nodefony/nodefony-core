import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Inline } from "../Catalogue";
import { tabTargetIndex } from "../effects";
import { Excerpt } from "../lesson/LessonCode";
import type { ILessonExcerpt } from "../lesson/lesson";
import { ProbeResult } from "./ProbeResult";
import type { IProbeChunk, IProbeResult } from "./probe";

/** Un appel qu'un bouton lance : sa méthode, son chemin, et l'appel lui-même. */
export interface IStepCall {
  label: string;
  verb: "GET" | "POST" | "WS" | "SSE";
  /** Chemin affiché sous le libellé. */
  path: string;
  run: (
    live: (chunks: readonly IProbeChunk[]) => void,
  ) => Promise<IProbeResult>;
  /** Raison de ne pas pouvoir l'appeler encore, ou `null`. */
  blocked?: string | null;
}

/** Un geste : son nom court pour la carte, l'explication, le code, les appels. */
export interface ILessonStep<E extends ILessonExcerpt = ILessonExcerpt> {
  id: string;
  /** Nom court, sur la carte. */
  short: string;
  /** Ce qu'on écrit pour ce geste, sur la carte. */
  gesture: string;
  title: string;
  text: string;
  /** Les extraits montrés à gauche, dans l'ordre. */
  excerpts: readonly E[];
  expect: string;
  calls: readonly IStepCall[];
}

/** L'appel en cours : son geste, son bouton, les morceaux déjà reçus. */
interface ILive {
  step: string;
  call: string;
  chunks: readonly IProbeChunk[];
}

/** Le geste que l'adresse désigne (`#stream`), sinon le premier. */
function initialStep(steps: readonly ILessonStep[]): number {
  const index = steps.findIndex(
    (step) => `#${step.id}` === window.location.hash,
  );
  return index === -1 ? 0 : index;
}

/**
 * La mise en page des leçons « à gestes » : la CARTE des gestes en haut,
 * puis UN geste à l'écran — son code à gauche, ses appels et leurs réponses
 * à droite. Rien à faire défiler pour passer d'un geste à l'autre ; l'adresse
 * garde le geste choisi (`#stream`).
 *
 * Guide pour un agent : brique du KIT, partagée par « Premiers pas » et
 * « Flux SSE ». La page fournit ses gestes et, au besoin, des champs
 * (`fields`) ou des liens (`extra`) propres à un geste ; les appels passent
 * par la sonde (`probe.ts`), affichée par `ProbeResult.tsx`. La carte suit
 * le patron WAI-ARIA « tabs ».
 *
 * @param steps - les gestes, jamais vide
 * @param label - nom accessible de la carte (« Les dix gestes »)
 * @param prefix - préfixe commun des chemins, retiré de leur affichage
 * @param fields - champs à saisir avant d'appeler, pour un geste donné
 * @param extra - liens ajoutés sous les appels d'un geste
 * @param onResult - reçoit chaque résultat (garder un `etag`, par exemple)
 */
export function StepsLesson<E extends ILessonExcerpt>({
  steps,
  label,
  prefix,
  fields,
  extra,
  onResult,
}: {
  steps: readonly [ILessonStep<E>, ...ILessonStep<E>[]];
  label: string;
  prefix: string;
  fields?: (step: ILessonStep<E>) => ReactNode;
  extra?: (step: ILessonStep<E>) => ReactNode;
  onResult?: (result: IProbeResult) => void;
}) {
  const [selected, setSelected] = useState(() => initialStep(steps));
  // Par geste, le dernier résultat de CHAQUE bouton : ils se comparent.
  const [results, setResults] = useState<
    Record<string, Record<string, IProbeResult>>
  >({});
  const [live, setLive] = useState<ILive | null>(null);
  const step = steps.at(selected) ?? steps[0];

  const choose = (index: number) => {
    const next = steps.at(index);
    if (next === undefined) return;
    setSelected(index);
    window.history.replaceState(null, "", `#${next.id}`);
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = tabTargetIndex(event.key, index, steps.length);
    if (next === null) return;
    event.preventDefault();
    choose(next);
    document.getElementById(`steps-tab-${steps[next]?.id ?? ""}`)?.focus();
  };
  const run = (call: IStepCall) => {
    const at = { step: step.id, call: call.label };
    setLive({ ...at, chunks: [] });
    void call
      .run((chunks) => setLive({ ...at, chunks }))
      .then((result) => {
        onResult?.(result);
        setResults((done) => ({
          ...done,
          [at.step]: { ...done[at.step], [at.call]: result },
        }));
        setLive(null);
      });
  };

  return (
    <>
      <div
        className={`steps-map steps-cols-${Math.min(5, Math.ceil(steps.length / 2))}`}
        role="tablist"
        aria-label={label}
      >
        {steps.map((entry, index) => {
          const tried = entry.id in results;
          return (
            <button
              key={entry.id}
              id={`steps-tab-${entry.id}`}
              type="button"
              role="tab"
              aria-selected={index === selected}
              aria-controls="steps-stage"
              tabIndex={index === selected ? 0 : -1}
              className="steps-tab"
              onClick={() => choose(index)}
              onKeyDown={(event) => onTabKey(event, index)}
            >
              <span className="steps-tab-num">{tried ? "✓" : index + 1}</span>
              <span className="steps-tab-title">{entry.short}</span>
              <code className="steps-tab-gesture">{entry.gesture}</code>
              {tried && <span className="sr-only"> (essayé)</span>}
            </button>
          );
        })}
      </div>

      <section
        id="steps-stage"
        role="tabpanel"
        aria-labelledby={`steps-tab-${step.id}`}
        className="steps-stage"
      >
        <div className="steps-code">
          {step.excerpts.map((excerpt) => (
            <Excerpt
              key={`${excerpt.file}#${excerpt.region}`}
              excerpt={excerpt}
            />
          ))}
        </div>

        <div className="steps-try">
          <p className="steps-kicker">
            <span>
              Geste {selected + 1} / {steps.length}
            </span>
            <span>Attendu : {step.expect}</span>
          </p>
          <h2>{step.title}</h2>
          <p className="steps-text">
            <Inline text={step.text} />
          </p>
          {fields?.(step)}
          <div className="calls">
            {step.calls.map((call) => (
              <CallButton
                key={call.label}
                call={call}
                prefix={prefix}
                busy={live !== null}
                running={live?.call === call.label}
                onRun={run}
              />
            ))}
            {extra?.(step)}
          </div>
          <div className="steps-results" aria-live="polite">
            <StepResults
              done={results[step.id] ?? {}}
              live={live?.step === step.id ? live : null}
            />
          </div>
          <div className="steps-nav">
            <button
              type="button"
              disabled={selected === 0}
              onClick={() => choose(selected - 1)}
            >
              ← {steps[selected - 1]?.short ?? "Précédent"}
            </button>
            <button
              type="button"
              disabled={selected === steps.length - 1}
              onClick={() => choose(selected + 1)}
            >
              {steps[selected + 1]?.short ?? "Suivant"} →
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

/** Un appel : la méthode, le libellé, et le chemin qu'il vise. */
function CallButton({
  call,
  prefix,
  busy,
  running,
  onRun,
}: {
  call: IStepCall;
  prefix: string;
  busy: boolean;
  running: boolean;
  onRun: (call: IStepCall) => void;
}) {
  const blocked = call.blocked ?? null;
  // Le chemin sans le préfixe commun : c'est ce qui change d'un appel à l'autre.
  const path = call.path.startsWith(prefix)
    ? call.path.slice(prefix.length)
    : call.path;
  return (
    <button
      type="button"
      className="call"
      disabled={busy || blocked !== null}
      aria-busy={running}
      title={blocked ?? undefined}
      onClick={() => onRun(call)}
    >
      <span className={`call-verb verb-${call.verb.toLowerCase()}`}>
        {call.verb}
      </span>
      <span className="call-text">
        <span className="call-label">{call.label}</span>
        <code className="call-path">{blocked ?? path}</code>
      </span>
      <span className="call-go" aria-hidden="true">
        {running ? "…" : "▶"}
      </span>
    </button>
  );
}

/**
 * Les résultats d'un geste, un par bouton, dans l'ordre des premiers clics ;
 * celui du bouton en cours montre ses morceaux en direct.
 */
function StepResults({
  done,
  live,
}: {
  done: Readonly<Record<string, IProbeResult>>;
  live: ILive | null;
}): ReactNode {
  const calls = Object.keys(done);
  if (live !== null && !calls.includes(live.call)) calls.push(live.call);
  return calls.map((call) => (
    <ProbeResult
      key={call}
      result={live?.call === call ? null : (done[call] ?? null)}
      live={live?.call === call ? live.chunks : null}
    />
  ));
}
