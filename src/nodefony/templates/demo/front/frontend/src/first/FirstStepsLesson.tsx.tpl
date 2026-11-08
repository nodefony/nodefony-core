import { useState, type ReactNode } from "react";
import { loginPagePath } from "nodefony/client";
import { docUrl, type IDemoAbout } from "../about";
import { Inline, LEVELS } from "../Catalogue";
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

/** Ce que la page sait faire : appeler, et montrer en direct. */
interface IRunner {
  /**
   * Lance un appel ; son résultat s'affiche sous l'étape `step`, à la
   * place du précédent du même bouton `trial` — ceux des autres restent,
   * pour comparer.
   */
  run: (
    step: string,
    trial: string,
    call: (live: (c: readonly IProbeChunk[]) => void) => Promise<IProbeResult>,
  ) => void;
  busy: string | null;
}

/** Une étape : l'explication, le code, et ses essais. */
interface IStep {
  id: string;
  title: string;
  text: string;
  /** Les régions du contrôleur montrées, dans l'ordre. */
  regions: readonly FirstControllerRegion[];
  expect: string;
  /** Les boutons (et champs) de l'essai. */
  trials: (runner: IRunner, state: IFormState) => ReactNode;
}

/** L'appel en cours : son étape, son bouton, les morceaux déjà reçus. */
interface ILive {
  step: string;
  trial: string;
  chunks: readonly IProbeChunk[];
}

/**
 * Les résultats d'une étape, un par bouton, dans l'ordre des premiers
 * clics ; celui du bouton en cours montre ses morceaux en direct.
 */
function StepResults({
  done,
  live,
}: {
  done: Readonly<Record<string, IProbeResult>>;
  live: ILive | null;
}) {
  const trials = Object.keys(done);
  if (live !== null && !trials.includes(live.trial)) trials.push(live.trial);
  return trials.map((trial) => (
    <ProbeResult
      key={trial}
      result={live?.trial === trial ? null : (done[trial] ?? null)}
      live={live?.trial === trial ? live.chunks : null}
    />
  ));
}

/** Les champs que les essais partagent. */
interface IFormState {
  name: string;
  setName: (name: string) => void;
  age: string;
  setAge: (age: string) => void;
  etag: string | null;
  loginPath: string | null;
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

/** Un bouton d'essai : désactivé pendant qu'un autre appel court. */
function Trial({
  runner,
  step,
  label,
  call,
  primary = false,
}: {
  runner: IRunner;
  step: string;
  label: string;
  call: Parameters<IRunner["run"]>[2];
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={primary ? "btn primary" : "btn"}
      disabled={runner.busy !== null}
      aria-busy={runner.busy === step}
      onClick={() => runner.run(step, label, call)}
    >
      {label}
    </button>
  );
}

const STEPS: readonly IStep[] = [
  {
    id: "hello",
    title: "Dire bonjour : retourner une valeur",
    text: "La règle d'or : l'action RETOURNE une valeur, le framework la rend. Un objet devient du JSON, sans `send()` ni `res.json()`. Le prénom vient de l'adresse (`{name}`), la langue de `?lang=`.",
    regions: ["first-hello"],
    expect: "200, application/json",
    trials: (runner, form) => (
      <>
        <label className="first-form">
          Prénom
          <input
            value={form.name}
            maxLength={40}
            onChange={(event) => form.setName(event.target.value)}
          />
        </label>
        <Trial
          runner={runner}
          step="hello"
          primary
          label="En français"
          call={() => probeHttp(helloPath(form.name, "fr"))}
        />
        <Trial
          runner={runner}
          step="hello"
          label="In English"
          call={() => probeHttp(helloPath(form.name, "en"))}
        />
      </>
    ),
  },
  {
    id: "render",
    title: "Rendre du HTML ou du texte",
    text: "Quand on veut choisir soi-même le type, le statut ou les en-têtes : `render()`. `setContextHtml()` annonce du HTML ; un `Content-Type` passé en en-tête annonce autre chose.",
    regions: ["first-render"],
    expect: "200, text/html puis text/plain",
    trials: (runner) => (
      <>
        <Trial
          runner={runner}
          step="render"
          primary
          label="La page HTML"
          call={() => probeHttp(`${FIRST_PATH}/page`)}
        />
        <Trial
          runner={runner}
          step="render"
          label="Le texte brut"
          call={() => probeHttp(`${FIRST_PATH}/text`)}
        />
      </>
    ),
  },
  {
    id: "echo",
    title: "Recevoir des données, validées",
    text: "Le corps d'un `POST` est vérifié par un schéma AVANT d'entrer dans l'action : elle ne reçoit que des données conformes, déjà typées. Envoyez un âge en lettres pour voir le refus.",
    regions: ["first-echo"],
    expect: "200, puis 422 si le corps est faux",
    trials: (runner, form) => (
      <>
        <label className="first-form">
          Nom
          <input
            value={form.name}
            maxLength={40}
            onChange={(event) => form.setName(event.target.value)}
          />
        </label>
        <label className="first-form">
          Âge
          <input
            value={form.age}
            inputMode="numeric"
            onChange={(event) => form.setAge(event.target.value)}
          />
        </label>
        <Trial
          runner={runner}
          step="echo"
          primary
          label="Envoyer"
          call={() =>
            probeHttp(
              `${FIRST_PATH}/echo`,
              postJson({ name: form.name, age: Number(form.age) }),
            )
          }
        />
        <Trial
          runner={runner}
          step="echo"
          label="Envoyer l'âge en lettres"
          call={() =>
            probeHttp(
              `${FIRST_PATH}/echo`,
              postJson({ name: form.name, age: "vingt" }),
            )
          }
        />
      </>
    ),
  },
  {
    id: "errors",
    title: "Statuts et erreurs",
    text: "Une erreur levée dans l'action devient une réponse propre, avec son statut : `throw new HttpError(message, 404)`. Pas de pile de code envoyée en production.",
    regions: ["first-errors"],
    expect: "200, puis 404",
    trials: (runner) => (
      <>
        <Trial
          runner={runner}
          step="errors"
          primary
          label="Le livre 1"
          call={() => probeHttp(`${FIRST_PATH}/books/1`)}
        />
        <Trial
          runner={runner}
          step="errors"
          label="Le livre 42"
          call={() => probeHttp(`${FIRST_PATH}/books/42`)}
        />
      </>
    ),
  },
  {
    id: "redirect",
    title: "Rediriger, et le message flash",
    text: "`redirect(url)` renvoie le navigateur ailleurs (302). Après un envoi, on redirige en 303 : recharger la page d'arrivée ne renvoie pas le formulaire. Le message flash, gardé en session, ne se lit qu'UNE fois — relisez la note deux fois.",
    regions: ["first-redirect", "first-flash"],
    expect: "redirection suivie, puis le flash une seule fois",
    trials: (runner) => (
      <>
        <Trial
          runner={runner}
          step="redirect"
          primary
          label="Ancienne adresse"
          call={() => probeHttp(`${FIRST_PATH}/old-hello`)}
        />
        <Trial
          runner={runner}
          step="redirect"
          label="Envoyer une note"
          call={() => probeHttp(`${FIRST_PATH}/note`, { method: "POST" })}
        />
        <Trial
          runner={runner}
          step="redirect"
          label="Relire la note"
          call={() => probeHttp(`${FIRST_PATH}/note`)}
        />
      </>
    ),
  },
  {
    id: "web",
    title: "Renvoyer une Response Web",
    text: "L'objet `Response` de la Fetch API, celui que rend `fetch()` dans le navigateur comme dans Node : l'action peut le renvoyer tel quel, avec son statut et ses en-têtes. Pratique pour relayer une API, ou une bibliothèque qui en produit une.",
    regions: ["first-web-response"],
    expect: "200, en-tête x-demo",
    trials: (runner) => (
      <Trial
        runner={runner}
        step="web"
        primary
        label="Appeler"
        call={() => probeHttp(`${FIRST_PATH}/web`)}
      />
    ),
  },
  {
    id: "stream",
    title: "Envoyer un flux",
    text: "`renderStream()` envoie chaque morceau dès qu'il est prêt, sans attendre la fin. Regardez les morceaux arriver un par un, avec leur instant d'arrivée.",
    regions: ["first-stream"],
    expect: "6 morceaux, espacés de 400 ms",
    trials: (runner) => (
      <Trial
        runner={runner}
        step="stream"
        primary
        label="Lancer le compte à rebours"
        call={(live) => probeHttp(`${FIRST_PATH}/countdown`, {}, live)}
      />
    ),
  },
  {
    id: "file",
    title: "Servir un fichier, et le cache offert",
    text: "`streamFile()` lit le fichier du disque en flux — ici, le contrôleur que vous lisez. Il pose seul un `etag` : redemandé avec, le fichier n'est pas renvoyé (304, corps vide). `renderFileDownload()` sert le même fichier en pièce à enregistrer.",
    regions: ["first-file"],
    expect: "200, puis 304",
    trials: (runner, form) => (
      <>
        <Trial
          runner={runner}
          step="file"
          primary
          label="Lire le fichier"
          call={() => probeHttp(`${FIRST_PATH}/source`)}
        />
        <button
          type="button"
          className="btn"
          disabled={runner.busy !== null || form.etag === null}
          onClick={() =>
            runner.run("file", "Redemander avec son etag", () =>
              probeHttp(`${FIRST_PATH}/source`, {
                headers: { "if-none-match": form.etag ?? "" },
              }),
            )
          }
        >
          Redemander avec son etag
        </button>
        <a className="btn" href={`${FIRST_PATH}/source?download=1`} download>
          Télécharger
        </a>
        {form.etag === null && (
          <span className="trial-hint">Lisez d'abord le fichier.</span>
        )}
      </>
    ),
  },
  {
    id: "whoami",
    title: "Qui appelle ?",
    text: "`this.user` : l'identité que le pare-feu a posée, ou `null` pour un visiteur. Le serveur ne croit jamais un nom envoyé par le navigateur. Connectez-vous, puis rappelez.",
    regions: ["first-whoami"],
    expect: "connected: false, ou votre identifiant",
    trials: (runner, form) => (
      <>
        <Trial
          runner={runner}
          step="whoami"
          primary
          label="Qui suis-je ?"
          call={() => probeHttp(`${FIRST_PATH}/whoami`)}
        />
        {form.loginPath !== null && (
          <a
            className="btn"
            href={loginPagePath("/demo/first-steps", form.loginPath)}
          >
            Se connecter
          </a>
        )}
      </>
    ),
  },
  {
    id: "socket",
    title: "Une action, deux transports",
    text: "L'action de l'étape 1 déclare aussi `WEBSOCKET` : la même méthode répond à une socket. La page ouvre une `WebSocket` vers la même adresse ; la première trame est la réponse de l'action, et chaque message envoyé la rappelle. Même code, même sécurité — seul `transport` change.",
    regions: ["first-hello"],
    expect: "transport: websocket",
    trials: (runner, form) => (
      <>
        <Trial
          runner={runner}
          step="socket"
          primary
          label="Par WebSocket"
          call={() => probeSocket(helloPath(form.name, "fr"), "encore")}
        />
        <Trial
          runner={runner}
          step="socket"
          label="Par HTTP, pour comparer"
          call={() => probeHttp(helloPath(form.name, "fr"))}
        />
      </>
    ),
  },
];

/**
 * Page d'apprentissage « Premiers pas » (`/demo/first-steps`) — le gabarit
 * commun : (1) ce qu'on construit, (2) la démo qui tourne, (3) le code qui
 * la fait, (4) les pièges et la suite. Ici la démo EST la leçon : dix
 * étapes, chacune avec son code et un essai contre la vraie route.
 *
 * Guide pour un agent : le contrôleur est `FirstStepsController.ts`, les
 * appels passent par la sonde du kit (`kit/probe.ts`), affichée par
 * `kit/ProbeResult.tsx`.
 */
export function FirstStepsLesson({ about }: { about: IDemoAbout | null }) {
  const version = about?.nodefony.version ?? null;
  // Par étape, le dernier résultat de CHAQUE bouton.
  const [results, setResults] = useState<
    Record<string, Record<string, IProbeResult>>
  >({});
  const [live, setLive] = useState<ILive | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("Alice");
  const [age, setAge] = useState("30");
  // L'etag du dernier fichier lu : un 304 ne le renvoie pas, on le garde.
  const [etag, setEtag] = useState<string | null>(null);

  const runner: IRunner = {
    busy,
    run: (step, trial, call) => {
      setBusy(step);
      setLive({ step, trial, chunks: [] });
      void call((chunks) => setLive({ step, trial, chunks })).then((result) => {
        const found = result.headers.find(([header]) => header === "etag");
        if (found !== undefined) setEtag(found[1]);
        setResults((done) => ({
          ...done,
          [step]: { ...done[step], [trial]: result },
        }));
        setLive(null);
        setBusy(null);
      });
    },
  };
  const form: IFormState = {
    name,
    setName,
    age,
    setAge,
    etag,
    loginPath: about?.loginPath ?? null,
  };

  return (
    <main className="lesson">
      <nav className="crumbs" aria-label="Fil d'Ariane">
        <a href="/demo">Démo</a>
        <span aria-hidden="true">›</span>
        <span aria-current="page">Premiers pas</span>
      </nav>

      <section className="lesson-intro" aria-labelledby="lesson-title">
        <p className="lesson-meta">
          <span className={`lvl ${LEVELS.beginner.className}`}>
            {LEVELS.beginner.label}
          </span>
          <span className="lesson-step">
            1 · Ce qu'on construit, et pourquoi
          </span>
        </p>
        <h1 id="lesson-title">Premiers pas — un contrôleur, dix gestes</h1>
        <p>
          Un <strong>contrôleur</strong> reçoit une requête et rend une réponse.
          Tout tient dans une classe : une méthode par adresse, et un décorateur
          au-dessus pour dire laquelle. Chaque étape ci-dessous montre le code,
          puis l'appelle pour de vrai : ce qui s'affiche est ce que le serveur a
          répondu.
        </p>
      </section>

      <section className="lesson-demo" aria-labelledby="lesson-demo-title">
        <h2 id="lesson-demo-title" className="lesson-step">
          2 · La démo qui tourne
        </h2>
        <ol className="trials">
          {STEPS.map((step, index) => (
            <li key={step.id} className="trial">
              <div className="trial-head">
                <span className="trial-num" aria-hidden="true">
                  {index + 1}
                </span>
                <h3>{step.title}</h3>
                <span className="trial-expect">Attendu : {step.expect}</span>
              </div>
              <p>
                <Inline text={step.text} />
              </p>
              {step.regions.map((region) => (
                <Excerpt key={region} excerpt={{ file: CONTROLLER, region }} />
              ))}
              <div className="trial-actions">{step.trials(runner, form)}</div>
              <div aria-live="polite">
                <StepResults
                  done={results[step.id] ?? {}}
                  live={live?.step === step.id ? live : null}
                />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <LessonCode
        lesson={FIRST_LESSON}
        doc={{
          href: docUrl(version, "modules/framework/controller"),
          label: "Le contrôleur — la doc complète",
        }}
      />

      <section className="lesson-traps" aria-labelledby="lesson-traps-title">
        <div>
          <h2 id="lesson-traps-title" className="lesson-step">
            4 · Les pièges
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
              défaut, gardez le 301 pour un déménagement définitif.
            </li>
            <li>
              <strong>Un flash sans session ne fait rien.</strong> Sans{" "}
              <code>@UseSession()</code> sur la route, le message n'est pas
              gardé, et rien ne le signale à l'écran.
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
