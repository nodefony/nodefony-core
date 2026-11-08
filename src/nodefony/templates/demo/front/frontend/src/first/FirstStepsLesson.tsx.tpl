import { useState, type KeyboardEvent, type ReactNode } from "react";
import { loginPagePath } from "nodefony/client";
import { docUrl, type IDemoAbout } from "../about";
import { Inline, LEVELS } from "../Catalogue";
import { tabTargetIndex } from "../effects";
import { Excerpt, LessonCode } from "../lesson/LessonCode";
import type { LessonFile } from "../lesson/lesson";
import { ProbeResult } from "../kit/ProbeResult";
import {
  probeHttp,
  probeSocket,
  type IProbeChunk,
  type IProbeResult,
} from "../kit/probe";
import { FIRST_PATH } from "./firstSteps";
import { FIRST_LESSON, type FirstControllerRegion } from "./firstTabs";

const CONTROLLER: LessonFile = "nodefony/controllers/FirstStepsController.ts";

/** Un appel qu'un bouton lance : sa méthode, son chemin, et l'appel lui-même. */
interface ICall {
  label: string;
  verb: "GET" | "POST" | "WS";
  /** Chemin affiché sous le libellé, relatif à `FIRST_PATH`. */
  path: string;
  run: (
    live: (chunks: readonly IProbeChunk[]) => void,
  ) => Promise<IProbeResult>;
  /** Raison de ne pas pouvoir l'appeler encore, ou `null`. */
  blocked?: string | null;
}

/** Les champs que les essais partagent. */
interface IFormState {
  name: string;
  age: string;
  etag: string | null;
}

/** Un geste : son nom court pour la carte, l'explication, le code, les appels. */
interface IStep {
  id: string;
  /** Nom court, sur la carte. */
  short: string;
  /** Ce qu'on écrit pour ce geste, sur la carte. */
  gesture: string;
  title: string;
  text: string;
  /** Les régions du contrôleur montrées, dans l'ordre. */
  regions: readonly FirstControllerRegion[];
  expect: string;
  /** Les champs à saisir avant d'appeler. */
  fields?: "name" | "name-age";
  calls: (form: IFormState) => readonly ICall[];
}

/** L'adresse de `/hello/{name}`, le nom encodé. */
function helloPath(name: string, lang: "fr" | "en"): string {
  return `${FIRST_PATH}/hello/${encodeURIComponent(name.trim() || "visiteur")}?lang=${lang}`;
}

/** Un `POST` JSON. */
function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Le chemin sans le préfixe commun : c'est ce qui change d'un appel à l'autre. */
function shortPath(path: string): string {
  return path.startsWith(FIRST_PATH) ? path.slice(FIRST_PATH.length) : path;
}

/** Un `GET` du préfixe, en une ligne. */
function get(label: string, path: string, init?: RequestInit): ICall {
  return {
    label,
    verb: "GET",
    path,
    run: (live) => probeHttp(`${FIRST_PATH}${path}`, init, live),
  };
}

// Non vide par son type : le premier geste existe toujours.
const STEPS: readonly [IStep, ...IStep[]] = [
  {
    id: "hello",
    short: "Dire bonjour",
    gesture: "return { … }",
    title: "Retourner une valeur",
    text: "La règle d'or : l'action RETOURNE une valeur, le framework la rend. Un objet devient du JSON, sans `send()`. Le prénom vient de l'adresse (`{name}`), la langue de `?lang=`.",
    regions: ["first-hello"],
    expect: "200, JSON",
    fields: "name",
    calls: (form) => [
      {
        label: "En français",
        verb: "GET",
        path: helloPath(form.name, "fr"),
        run: () => probeHttp(helloPath(form.name, "fr")),
      },
      {
        label: "In English",
        verb: "GET",
        path: helloPath(form.name, "en"),
        run: () => probeHttp(helloPath(form.name, "en")),
      },
    ],
  },
  {
    id: "render",
    short: "HTML ou texte",
    gesture: "render()",
    title: "Rendre du HTML ou du texte",
    text: "Pour choisir soi-même le type, le statut ou les en-têtes : `render()`. `setContextHtml()` annonce du HTML ; un `Content-Type` en en-tête annonce autre chose.",
    regions: ["first-render"],
    expect: "text/html, puis text/plain",
    calls: () => [get("La page HTML", "/page"), get("Le texte brut", "/text")],
  },
  {
    id: "echo",
    short: "Recevoir",
    gesture: "schema: { body }",
    title: "Recevoir des données, validées",
    text: "Le corps d'un `POST` est vérifié par un schéma AVANT l'action : elle ne reçoit que des données conformes, déjà typées. Un âge en lettres est refusé sans y entrer.",
    regions: ["first-echo"],
    expect: "200, puis 422",
    fields: "name-age",
    calls: (form) => [
      {
        label: "Envoyer",
        verb: "POST",
        path: `${FIRST_PATH}/echo`,
        run: () =>
          probeHttp(
            `${FIRST_PATH}/echo`,
            postJson({ name: form.name, age: Number(form.age) }),
          ),
      },
      {
        label: "Envoyer l'âge en lettres",
        verb: "POST",
        path: `${FIRST_PATH}/echo`,
        run: () =>
          probeHttp(
            `${FIRST_PATH}/echo`,
            postJson({ name: form.name, age: "vingt" }),
          ),
      },
    ],
  },
  {
    id: "errors",
    short: "Erreurs",
    gesture: "throw new HttpError",
    title: "Statuts et erreurs",
    text: "Une erreur levée devient une réponse propre, avec son statut : `throw new HttpError(message, 404)`. En production, aucune pile de code ne part.",
    regions: ["first-errors"],
    expect: "200, puis 404",
    calls: () => [
      get("Le livre 1", "/books/1"),
      get("Le livre 42", "/books/42"),
    ],
  },
  {
    id: "redirect",
    short: "Rediriger",
    gesture: "redirect()",
    title: "Rediriger, et le message flash",
    text: "`redirect(url)` renvoie ailleurs (302). Après un envoi, on redirige en 303 : recharger n'envoie pas deux fois. Le message flash vit en session et ne se lit qu'UNE fois : relisez la note.",
    regions: ["first-redirect", "first-flash"],
    expect: "redirection suivie, flash lu une fois",
    calls: () => [
      get("Ancienne adresse", "/old-hello"),
      {
        label: "Envoyer une note",
        verb: "POST",
        path: `${FIRST_PATH}/note`,
        run: () => probeHttp(`${FIRST_PATH}/note`, { method: "POST" }),
      },
      get("Relire la note", "/note"),
    ],
  },
  {
    id: "web",
    short: "Response Web",
    gesture: "Response.json()",
    title: "Renvoyer une Response Web",
    text: "L'objet `Response` de la Fetch API, celui que rend `fetch()` : l'action le renvoie tel quel, statut et en-têtes compris. Pratique pour relayer une API, ou une bibliothèque qui en produit une.",
    regions: ["first-web-response"],
    expect: "200, en-tête x-demo",
    calls: () => [get("Appeler", "/web")],
  },
  {
    id: "stream",
    short: "Flux",
    gesture: "renderStream()",
    title: "Envoyer un flux",
    text: "`renderStream()` envoie chaque morceau dès qu'il est prêt. Regardez-les arriver un par un, avec leur instant d'arrivée.",
    regions: ["first-stream"],
    expect: "6 morceaux, 400 ms d'écart",
    calls: () => [get("Lancer le compte à rebours", "/countdown")],
  },
  {
    id: "file",
    short: "Fichier",
    gesture: "streamFile()",
    title: "Servir un fichier, et le cache offert",
    text: "`streamFile()` lit le fichier du disque en flux — ici, ce contrôleur. Il pose seul un `etag` : redemandé avec, le fichier ne repart pas (304). `renderFileDownload()` le sert en pièce à enregistrer.",
    regions: ["first-file"],
    expect: "200, puis 304",
    calls: (form) => [
      get("Lire le fichier", "/source"),
      {
        ...get("Redemander avec son etag", "/source", {
          headers: { "if-none-match": form.etag ?? "" },
        }),
        blocked: form.etag === null ? "lisez d'abord le fichier" : null,
      },
    ],
  },
  {
    id: "whoami",
    short: "Qui appelle ?",
    gesture: "this.user",
    title: "Qui appelle ?",
    text: "`this.user` : l'identité posée par le pare-feu, ou `null` pour un visiteur. Le serveur ne croit jamais un nom envoyé par le navigateur. Connectez-vous, puis rappelez.",
    regions: ["first-whoami"],
    expect: "connected: false, ou votre identifiant",
    calls: () => [get("Qui suis-je ?", "/whoami")],
  },
  {
    id: "socket",
    short: "Deux transports",
    gesture: '"WEBSOCKET"',
    title: "Une action, deux transports",
    text: "L'action du geste 1 déclare aussi `WEBSOCKET` : la même méthode répond à une socket. La première trame est sa réponse, et chaque message envoyé la rappelle. Même code, même sécurité — seul `transport` change.",
    regions: ["first-hello"],
    expect: "transport: websocket",
    fields: "name",
    calls: (form) => [
      {
        label: "Par WebSocket",
        verb: "WS",
        path: helloPath(form.name, "fr"),
        run: () => probeSocket(helloPath(form.name, "fr"), "encore"),
      },
      {
        label: "Par HTTP, pour comparer",
        verb: "GET",
        path: helloPath(form.name, "fr"),
        run: () => probeHttp(helloPath(form.name, "fr")),
      },
    ],
  },
];

/** L'appel en cours : son geste, son bouton, les morceaux déjà reçus. */
interface ILive {
  step: string;
  call: string;
  chunks: readonly IProbeChunk[];
}

/** Le geste que l'adresse désigne (`#redirect`), sinon le premier. */
function initialStep(): number {
  const index = STEPS.findIndex(
    (step) => `#${step.id}` === window.location.hash,
  );
  return index === -1 ? 0 : index;
}

/**
 * Page d'apprentissage « Premiers pas » (`/demo/first-steps`) : la CARTE des
 * dix gestes en haut, puis UN geste à l'écran — son code à gauche, ses
 * appels et leurs réponses à droite. Rien à faire défiler pour passer d'un
 * geste à l'autre ; l'adresse garde le geste choisi (`#stream`).
 *
 * Guide pour un agent : le contrôleur est `FirstStepsController.ts`, les
 * appels passent par la sonde du kit (`kit/probe.ts`), affichée par
 * `kit/ProbeResult.tsx`. La carte suit le patron WAI-ARIA « tabs ».
 */
export function FirstStepsLesson({ about }: { about: IDemoAbout | null }) {
  const version = about?.nodefony.version ?? null;
  const [selected, setSelected] = useState(initialStep);
  // Par geste, le dernier résultat de CHAQUE bouton : ils se comparent.
  const [results, setResults] = useState<
    Record<string, Record<string, IProbeResult>>
  >({});
  const [live, setLive] = useState<ILive | null>(null);
  const [name, setName] = useState("Alice");
  const [age, setAge] = useState("30");
  // L'etag du dernier fichier lu : un 304 ne le renvoie pas, on le garde.
  const [etag, setEtag] = useState<string | null>(null);
  const step = STEPS.at(selected) ?? STEPS[0];
  const form: IFormState = { name, age, etag };

  const choose = (index: number) => {
    const next = STEPS.at(index);
    if (next === undefined) return;
    setSelected(index);
    window.history.replaceState(null, "", `#${next.id}`);
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = tabTargetIndex(event.key, index, STEPS.length);
    if (next === null) return;
    event.preventDefault();
    choose(next);
    document.getElementById(`first-tab-${STEPS[next]?.id ?? ""}`)?.focus();
  };
  const run = (call: ICall) => {
    const at = { step: step.id, call: call.label };
    setLive({ ...at, chunks: [] });
    void call
      .run((chunks) => setLive({ ...at, chunks }))
      .then((result) => {
        const found = result.headers.find(([header]) => header === "etag");
        if (found !== undefined) setEtag(found[1]);
        setResults((done) => ({
          ...done,
          [at.step]: { ...done[at.step], [at.call]: result },
        }));
        setLive(null);
      });
  };

  return (
    <main className="lesson first">
      <nav className="crumbs" aria-label="Fil d'Ariane">
        <a href="/demo">Démo</a>
        <span aria-hidden="true">›</span>
        <span aria-current="page">Premiers pas</span>
      </nav>

      <header className="first-head">
        <span className={`lvl ${LEVELS.beginner.className}`}>
          {LEVELS.beginner.label}
        </span>
        <h1>Premiers pas — un contrôleur, dix gestes</h1>
        <p>
          Un <strong>contrôleur</strong> reçoit une requête et rend une réponse.
          Choisissez un geste : vous voyez son code, vous l'appelez pour de
          vrai, et le serveur répond.
        </p>
      </header>

      <div className="first-map" role="tablist" aria-label="Les dix gestes">
        {STEPS.map((entry, index) => {
          const tried = entry.id in results;
          return (
            <button
              key={entry.id}
              id={`first-tab-${entry.id}`}
              type="button"
              role="tab"
              aria-selected={index === selected}
              aria-controls="first-stage"
              tabIndex={index === selected ? 0 : -1}
              className="first-tab"
              onClick={() => choose(index)}
              onKeyDown={(event) => onTabKey(event, index)}
            >
              <span className="first-tab-num">{tried ? "✓" : index + 1}</span>
              <span className="first-tab-title">{entry.short}</span>
              <code className="first-tab-gesture">{entry.gesture}</code>
              {tried && <span className="sr-only"> (essayé)</span>}
            </button>
          );
        })}
      </div>

      <section
        id="first-stage"
        role="tabpanel"
        aria-labelledby={`first-tab-${step.id}`}
        className="first-stage"
      >
        <div className="first-code">
          {step.regions.map((region) => (
            <Excerpt key={region} excerpt={{ file: CONTROLLER, region }} />
          ))}
        </div>

        <div className="first-try">
          <p className="first-kicker">
            <span>
              Geste {selected + 1} / {STEPS.length}
            </span>
            <span>Attendu : {step.expect}</span>
          </p>
          <h2>{step.title}</h2>
          <p className="first-text">
            <Inline text={step.text} />
          </p>
          {step.fields !== undefined && (
            <div className="first-fields">
              <label>
                {step.fields === "name-age" ? "Nom" : "Prénom"}
                <input
                  value={name}
                  maxLength={40}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              {step.fields === "name-age" && (
                <label>
                  Âge
                  <input
                    value={age}
                    inputMode="numeric"
                    onChange={(event) => setAge(event.target.value)}
                  />
                </label>
              )}
            </div>
          )}
          <div className="calls">
            {step.calls(form).map((call) => (
              <CallButton
                key={call.label}
                call={call}
                busy={live !== null}
                running={live?.call === call.label}
                onRun={run}
              />
            ))}
            {step.id === "file" && (
              <a
                className="call"
                href={`${FIRST_PATH}/source?download=1`}
                download
              >
                <span className="call-verb verb-get">GET</span>
                <span className="call-text">
                  <span className="call-label">Télécharger</span>
                  <code className="call-path">/source?download=1</code>
                </span>
              </a>
            )}
            {step.id === "whoami" &&
              about !== null &&
              about.loginPath !== null && (
                <a
                  className="first-link"
                  href={loginPagePath(
                    `/demo/first-steps#${step.id}`,
                    about.loginPath,
                  )}
                >
                  Se connecter, puis rappeler
                </a>
              )}
          </div>
          <div className="first-results" aria-live="polite">
            <StepResults
              done={results[step.id] ?? {}}
              live={live?.step === step.id ? live : null}
            />
          </div>
          <div className="first-nav">
            <button
              type="button"
              disabled={selected === 0}
              onClick={() => choose(selected - 1)}
            >
              ← {STEPS[selected - 1]?.short ?? "Précédent"}
            </button>
            <button
              type="button"
              disabled={selected === STEPS.length - 1}
              onClick={() => choose(selected + 1)}
            >
              {STEPS[selected + 1]?.short ?? "Suivant"} →
            </button>
          </div>
        </div>
      </section>

      <details className="first-more">
        <summary>Le contrôleur entier, et la page, couche par couche</summary>
        <LessonCode
          lesson={FIRST_LESSON}
          doc={{
            href: docUrl(version, "modules/framework/controller"),
            label: "Le contrôleur — la doc complète",
          }}
        />
      </details>

      <section className="lesson-traps" aria-labelledby="lesson-traps-title">
        <div>
          <h2 id="lesson-traps-title" className="lesson-step">
            Les pièges
          </h2>
          <ul>
            <li>
              <strong>
                <code>return null</code> laisse la requête pendue.
              </strong>{" "}
              Le framework comprend « je répondrai moi-même » et attend. Rendez
              une valeur, ou un statut sans corps (204).
            </li>
            <li>
              <strong>Le contrôleur est partagé.</strong> Une seule instance
              sert toutes les requêtes : rien ne se garde sur <code>this</code>,
              sous peine de mêler deux visiteurs.
            </li>
            <li>
              <strong>Un 301 ne s'oublie pas.</strong> Le navigateur le garde
              presque pour toujours : <code>redirect()</code> fait un 302 par
              défaut.
            </li>
            <li>
              <strong>Un flash sans session ne fait rien.</strong> Sans{" "}
              <code>@UseSession()</code> sur la route, le message n'est pas
              gardé, et rien ne le signale.
            </li>
            <li>
              <strong>Une Response renvoyée par une socket ne part pas.</strong>{" "}
              Une trame n'a ni statut ni en-têtes : par WebSocket, rendez un
              objet.
            </li>
          </ul>
        </div>
        <aside className="further" aria-label="Pour aller plus loin">
          <h2 className="lesson-step">Pour aller plus loin</h2>
          <a href={docUrl(version, "modules/framework/controller")}>
            Le contrôleur — @nodefony/framework
          </a>
          <a href="/demo/chat">Le chat : un contrôleur temps réel</a>
          <span>
            Générer un contrôleur : <code>npx nodefony create controller</code>
          </span>
        </aside>
      </section>
    </main>
  );
}

/** Un appel : la méthode, le libellé, et le chemin qu'il vise. */
function CallButton({
  call,
  busy,
  running,
  onRun,
}: {
  call: ICall;
  busy: boolean;
  running: boolean;
  onRun: (call: ICall) => void;
}) {
  const blocked = call.blocked ?? null;
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
        <code className="call-path">{blocked ?? shortPath(call.path)}</code>
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
