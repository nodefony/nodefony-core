/**
 * capacity-html.mjs — rendu du rapport de capacité.
 *
 * NE CONTIENT PLUS AUCUNE PRIMITIVE DE RENDU : tout vient du skill
 * `nodefony-html-report` (`lib/report.mjs`). Ce fichier ne fait que **traduire des
 * mesures en sections** — c'est la règle « une seule implémentation » : les
 * graphes, l'impression, l'accessibilité et le thème vivent à UN endroit.
 *
 * Le vrai livrable de ce rapport n'est pas un tableau : c'est le **calculateur**.
 * Le lecteur n'a pas besoin de nos chiffres, il a besoin de SA réponse (« combien
 * de pods pour 5 000 clients ? »).
 */
import {
  doc,
  section,
  cards,
  table,
  barChart,
  scatterFit,
  gauge,
  details,
  deckControls,
  printButton,
  calculator,
  warn,
  note,
  legend,
  fmt,
  COLORS,
} from "../../nodefony-html-report/lib/report.mjs";

const n0 = (x) =>
  x == null || Number.isNaN(x) ? "—" : Math.round(x).toLocaleString("fr-FR");
const f2 = (x) => (x == null ? "—" : x.toFixed(2));
const usOf = (rate) => (rate ? Math.round(1e6 / rate) : null);
const spreadOf = (r) =>
  r?.spread === undefined ? "—" : `±${Math.round(r.spread * 50)} %`;

/** Une pente dont l'ajustement est mauvais n'est PAS un chiffre : on le dit. */
const FIT_OK = 0.9;
const ramBasis = (r, dflt) => {
  if (!r) return { kb: dflt, trusted: false };
  if (r.rssR2 >= FIT_OK && r.rssKB > 0)
    return { kb: Math.max(r.rssKB, r.heapKB), trusted: true };
  return { kb: r.heapKB, trusted: false };
};

export function renderHtml(R, { PAYLOAD, REPEAT, generatedAt, command }) {
  const env = R.env;
  const [ramTls, ramClr] = R.ram;
  const [wsTls, wsClr] = R.ws;
  const fan = R.fanout;

  const basisTls = ramBasis(ramTls, 25);
  const basisClr = ramBasis(ramClr, 12);
  const ramUntrusted = R.ram.length && (!basisTls.trusted || !basisClr.trusted);

  // Constantes du calculateur : des µs de boucle par unité de travail.
  const K = {
    usMsgTls: wsTls ? usOf(wsTls.ceiling) : 110,
    usMsgClear: wsClr ? usOf(wsClr.ceiling) : 150,
    usDelivery: fan ? usOf(fan.ceiling) : 1,
    usHttp: R.http.length ? usOf(R.http[R.http.length - 1].ceiling) : 480,
    kbSocketTls: basisTls.kb,
    kbSocketClear: basisClr.kb,
    rssIdleMB: env.rssIdleMB,
  };

  const secs = [];

  /* ── 1. Le verdict, d'abord ──────────────────────────────────────────── */
  secs.push(
    section(
      "Ce qu'un process encaisse",
      cards([
        { k: "Environnement", v: env.env, sub: `Nodefony ${env.version}` },
        ...(wsTls
          ? [
              {
                k: "Messages WS",
                v: n0(wsTls.ceiling),
                unit: "/s",
                sub: "plafond d'une boucle",
              },
            ]
          : []),
        ...(fan
          ? [
              {
                k: "Livraisons fan-out",
                v: n0(fan.ceiling),
                unit: "/s",
                sub: `1 → ${fan.n} sockets`,
              },
            ]
          : []),
        ...(R.http.length
          ? [
              {
                k: "Requêtes HTTP",
                v: n0(R.http[R.http.length - 1].ceiling),
                unit: "/s",
                sub: "route session-free",
              },
            ]
          : []),
      ]) +
        (env.env !== "production"
          ? warn(
              `<strong>Mesuré en <code>${env.env}</code></strong> — le profiler et la sonde de timing sont
               ACTIFS, et un watcher tourne à côté. Ces chiffres sont une <strong>borne basse</strong> :
               un pod de production fait strictement moins de travail par message.`,
            )
          : note(
              `<strong>Mesuré en production.</strong> Profiler et timing éteints, aucun watcher —
               ce sont les chiffres sur lesquels on peut engager un dimensionnement.`,
            )),
      {
        lead:
          `Un process Node = <strong>une boucle d'événements</strong>. Tout le dimensionnement se ramène ` +
          `à deux questions : combien de microsecondes de boucle coûte une unité de travail, et combien ` +
          `de mémoire coûte une socket. Le reste est de l'arithmétique — faite pour vous plus bas.`,
      },
    ),
  );

  /* ── 2. Mémoire par socket ───────────────────────────────────────────── */
  if (R.ram.length && ramTls.heapPts) {
    const fitLine = (r) => (x) =>
      r.heapPts[0].y + (r.heapKB * 1024 * x) / 1048576;
    secs.push(
      section(
        "Combien de sockets tiennent en mémoire",
        scatterFit(
          [
            {
              points: ramTls.heapPts,
              color: COLORS.blue,
              fit: fitLine(ramTls),
            },
            {
              points: ramClr.heapPts,
              color: COLORS.green,
              fit: fitLine(ramClr),
            },
          ],
          { xLabel: "sockets ouvertes", yLabel: "Mo (heap)" },
        ) +
          legend([
            { label: "wss — TLS terminé par Node", color: COLORS.blue },
            {
              label: "ws — TLS terminé par le load-balancer",
              color: COLORS.green,
            },
          ]) +
          table(
            [
              { label: "Transport" },
              { label: "Heap / socket", align: "right", strong: true },
              { label: "ajust.", align: "right", dim: true },
              { label: "RSS / socket", align: "right" },
              { label: "ajust.", align: "right", dim: true },
            ],
            R.ram.map((r) => [
              r.label,
              r.heapR2 >= FIT_OK
                ? `${fmt.dec(r.heapKB)} Ko`
                : "non exploitable",
              `R² ${f2(r.heapR2)}`,
              r.rssR2 >= FIT_OK && r.rssKB > 0
                ? `${fmt.dec(r.rssKB)} Ko`
                : "non exploitable",
              `R² ${f2(r.rssR2)}`,
            ]),
          ) +
          (ramUntrusted
            ? warn(
                `<strong>Le RSS n'est pas exploitable ici</strong> (ajustement trop faible, pente parfois
                 négative) : sur cette machine, l'empreinte du process bouge toute seule pendant la mesure.
                 Le calculateur retombe donc sur le <strong>heap</strong> — qui est un <strong>plancher</strong>,
                 pas le coût réel (les tampons TLS et TCP vivent hors du heap). Pour un chiffre engageable,
                 rejouez ce banc sur un pod dédié.`,
              )
            : note(
                `Le <strong>RSS</strong> est la grandeur qui dimensionne un pod : il inclut les tampons TLS et
                 TCP, invisibles du heap. C'est lui qu'utilise le calculateur.`,
              )),
        {
          lead:
            `Mesuré par <strong>paliers croissants</strong> puis régressé : la <strong>pente</strong> est le ` +
            `coût par socket, et elle élimine le bruit du ramasse-miettes. Un simple avant/après peut sortir ` +
            `un coût <em>négatif</em> — c'est arrivé en écrivant ce banc. Le R² dit si la mesure vaut quelque chose.`,
        },
      ),
    );
  }

  /* ── 3. Coût unitaire + débits ───────────────────────────────────────── */
  const costRows = [
    ...(fan
      ? [
          {
            label: "1 livraison (fan-out)",
            value: usOf(fan.ceiling),
            color: COLORS.green,
          },
        ]
      : []),
    ...(wsTls
      ? [
          {
            label: "1 message WS (wss)",
            value: usOf(wsTls.ceiling),
            color: COLORS.blue,
          },
        ]
      : []),
    ...(wsClr
      ? [
          {
            label: "1 message WS (ws)",
            value: usOf(wsClr.ceiling),
            color: COLORS.blue,
          },
        ]
      : []),
    ...R.http.map((h) => ({
      label: `1 requête ${h.label}`,
      value: usOf(h.ceiling),
      color: COLORS.vermillion,
    })),
  ];

  secs.push(
    section(
      "Ce que coûte une unité de travail",
      barChart(costRows, {
        unit: "µs de boucle",
        logScale: true,
        title: "Coût en temps de boucle par unité de travail",
        desc: costRows
          .map((r) => `${r.label} : ${r.value} microsecondes`)
          .join(" · "),
      }) +
        `<p><strong>Une livraison de fan-out est environ cent fois moins chère qu'un aller-retour.</strong>
         Elle ne traverse ni analyse ni routage : c'est une écriture. Un canal temps réel se dimensionne
         donc sur les <em>livraisons</em>, pas sur les publications :
         <code>livraisons/s = publications/s × abonnés</code>. C'est ce qui rend le temps réel tenable
         — et c'est aussi ce qui explique qu'il s'effondre si l'on diffuse sans compter.</p>` +
        details(
          "Pourquoi une échelle logarithmique",
          `<p>Les ordres de grandeur vont de 1 µs à ~500 µs. En échelle linéaire, la barre du fan-out
           serait invisible — et une barre invisible, c'est une information perdue. Le log est
           légitime ici parce que le sujet EST le rapport entre les grandeurs.</p>`,
        ),
      { break: "before" },
    ),
  );

  if (R.http.length) {
    secs.push(
      section(
        "Débit HTTP par transport",
        table(
          [
            { label: "Transport" },
            { label: "Observé", align: "right" },
            { label: "Écart", align: "right", dim: true },
            { label: "p50", align: "right" },
            { label: "p95", align: "right" },
            { label: "p99", align: "right" },
            { label: "ELU", align: "right" },
            { label: "Plafond", align: "right", strong: true },
            { label: "Cible 70 %", align: "right" },
          ],
          R.http.map((h) => [
            h.label,
            { html: `${n0(h.observed)} rps`, sort: h.observed },
            spreadOf(h),
            `${f2(h.p50)} ms`,
            `${f2(h.p95)} ms`,
            `${f2(h.p99)} ms`,
            f2(h.elu),
            { html: `${n0(h.ceiling)} rps`, sort: h.ceiling },
            `${n0(h.ceiling * 0.7)} rps`,
          ]),
          { sortable: true, id: "t-http" },
        ) +
          note(
            `<strong>ELU</strong> = fraction de temps où la boucle travaille. Le plafond n'est pas le débit
             observé (le banc lui-même peut être le goulot) : c'est <code>débit ÷ ELU</code>. On dimensionne
             à <strong>70 %</strong> — au-delà, la latence p99 décroche brutalement, les événements font la queue.`,
          ) +
          warn(
            `Route <strong>sans session et sans ORM</strong> : c'est le pipeline nu. Une route authentifiée
             paie en plus le store de session, qui domine tout le reste. <strong>Ne dimensionnez jamais sur
             cette route-ci</strong> — rejouez le banc sur la vôtre.`,
          ),
        {
          lead: `Médiane de ${REPEAT} runs, dispersion affichée. Un chiffre sans son incertitude est un piège.`,
        },
      ),
    );
  }

  /* ── 4. Le calculateur (le vrai livrable) ────────────────────────────── */
  secs.push(
    section(
      "Combien de pods pour VOTRE charge",
      calculator({
        id: "cap",
        constants: K,
        inputs: [
          {
            id: "clients",
            label: "Clients simultanés (sockets)",
            value: 5000,
            min: 0,
          },
          {
            id: "upmsg",
            label: "Messages montants /s par client",
            value: 0.2,
            step: 0.1,
            min: 0,
          },
          { id: "pubs", label: "Publications /s (serveur)", value: 10, min: 0 },
          { id: "subs", label: "Abonnés par publication", value: 500, min: 0 },
          { id: "http", label: "Requêtes HTTP /s", value: 200, min: 0 },
          {
            id: "ram",
            label: "RAM par pod (Go)",
            value: 2,
            step: 0.5,
            min: 0.25,
          },
          {
            id: "tlsNode",
            label: "TLS terminé par Node (sinon : au load-balancer)",
            type: "checkbox",
            value: false,
          },
        ],
        compute: `(v, K) => {
          const usMsg = v.tlsNode ? K.usMsgTls : K.usMsgClear;
          const kbSocket = v.tlsNode ? K.kbSocketTls : K.kbSocketClear;
          // Charge de boucle : chaque unité de travail consomme des µs. 1 s = 1e6 µs.
          const loops = (v.clients * v.upmsg * usMsg + v.pubs * v.subs * K.usDelivery + v.http * K.usHttp) / 1e6;
          const podsCpu = Math.max(1, Math.ceil(loops / 0.7));
          // Mémoire : RSS au repos + 30 % de marge pour le GC.
          const usableMB = v.ram * 1024 * 0.7 - K.rssIdleMB;
          const perPod = usableMB > 0 ? Math.floor((usableMB * 1024) / kbSocket) : 0;
          const podsRam = perPod > 0 ? Math.ceil(v.clients / perPod) : Infinity;
          const pods = perPod > 0 ? Math.max(podsCpu, podsRam) : podsCpu;
          const binding = podsRam > podsCpu ? "la mémoire" : podsCpu > podsRam ? "le CPU" : "les deux";
          const eluPct = Math.min(100, (loops / pods) * 100);
          const alerts = [];
          if (perPod <= 0) alerts.push("Ce pod est trop petit : le process au repos consomme déjà toute la RAM allouée.");
          if (v.clients / pods > 1000) alerts.push("Plus de 1 000 sockets par pod : vérifiez <code>ulimit -n</code> (défaut 1024 = un plafond invisible).");
          if (pods > 1) alerts.push("Plusieurs pods : les publications doivent traverser un <strong>backplane Redis</strong> pour atteindre les abonnés des autres pods.");
          if (v.tlsNode && v.clients > 2000) alerts.push("Terminer TLS au load-balancer réduirait nettement la mémoire par socket.");
          if (eluPct > 70) alerts.push("Au-delà de 70 % de boucle, la latence p99 décroche. Ajoutez un pod.");
          if (v.pubs * v.subs > 500000) alerts.push("Plus de 500 000 livraisons/s : c'est le fan-out qui domine. Réduisez la cadence par canal, ou segmentez les canaux.");
          return {
            html:
              '<div style="font-size:17px;font-weight:650;margin-bottom:10px">Il faut ' +
              '<span style="font-size:32px;color:var(--accent)">' + pods + '</span> pod(s)' +
              ' <span style="font-weight:400;color:var(--dim);font-size:14px">— la contrainte qui décide est ' + binding + '</span></div>' +
              '<p style="font-size:13px;color:var(--dim)">Un pod tient <strong>' + perPod.toLocaleString("fr-FR") +
              ' sockets</strong> (' + kbSocket.toFixed(1) + ' Ko chacune) et ' +
              Math.round(0.7 * 1e6 / usMsg).toLocaleString("fr-FR") + ' msg/s à 70 % de boucle.<br>' +
              'Votre charge : ' + Math.round(v.clients * v.upmsg).toLocaleString("fr-FR") + ' msg/s montants · ' +
              Math.round(v.pubs * v.subs).toLocaleString("fr-FR") + ' livraisons/s · ' +
              Math.round(v.http).toLocaleString("fr-FR") + ' req/s → <strong>' + loops.toFixed(2) +
              ' boucle(s)</strong> nécessaires, soit ' + Math.round(eluPct) + ' % par pod.</p>',
            alerts,
          };
        }`,
      }),
      {
        lead:
          `Les constantes mesurées ci-dessus sont injectées ici. Décrivez votre charge : le calcul rend le ` +
          `nombre de pods, ce que tient un pod, et <strong>ce qui cassera en premier</strong>.`,
        break: "before",
      },
    ),
  );

  /* ── 5. Ce que le calcul ne voit pas ─────────────────────────────────── */
  secs.push(
    section(
      "Ce que le calcul ne voit pas",
      `<ul>
        <li><strong>Les descripteurs de fichiers.</strong> Une socket = un fd. Avec <code>ulimit -n</code>
            à 1024, le pod plafonnera à ~1 000 sockets quelle que soit sa RAM. À poser explicitement dans
            le manifeste.</li>
        <li><strong>Les ports éphémères.</strong> Côté client ou load-balancer : environ 28 000 ports par
            IP source. Au-delà, il faut plusieurs IP.</li>
        <li><strong>Les connexions par seconde ≠ les connexions simultanées.</strong> Un handshake TLS suivi
            d'une authentification coûte bien plus qu'un message. Le vrai danger n'est pas le régime
            permanent : c'est le <em>troupeau</em> qui se reconnecte après un déploiement. Nodefony
            reconnecte avec un back-off exponentiel ; ajoutez un rate-limit du handshake.</li>
        <li><strong>Le backplane.</strong> Dès deux pods, une publication traverse Redis. Son débit devient
            une contrainte à part entière — mesurez-la (<code>cluster-realtime-e2e.mjs</code>).</li>
        <li><strong>Le store de session.</strong> Sur une route authentifiée, il pèse l'essentiel du coût.
            Redis, pas SQLite.</li>
        <li><strong>La latence, pas seulement le débit.</strong> À 70 % d'ELU la p99 tient ; au-delà de
            ~85 %, elle s'effondre. C'est pourquoi on ne dimensionne jamais à 100 %.</li>
      </ul>`,
    ),
  );

  /* ── 6. Écrire la spécification ──────────────────────────────────────── */
  secs.push(
    section(
      "Si l'on vous demande une spécification de déploiement",
      `<ol>
        <li><strong>La charge, en clair.</strong> Clients simultanés, messages/s par client (montants et
            descendants), taille des payloads, ratio de diffusion (une publication touche combien
            d'abonnés ?), pic contre moyenne, et le scénario de reconnexion de masse.</li>
        <li><strong>Le contrat de service.</strong> Latence p99 visée, perte de message tolérée (zéro ?),
            durée de reprise acceptable quand un pod tombe.</li>
        <li><strong>La topologie.</strong> Où TLS est terminé (cela change la mémoire par socket) ; sticky
            sessions ou backplane Redis ; politique d'autoscaling — <em>sur l'ELU ou le CPU, jamais sur le
            nombre de requêtes</em>, qui ne dit rien du travail réel.</li>
        <li><strong>Les limites du pod.</strong> CPU (un cœur utile par process, le reste sert au GC), RAM
            (calculée ci-dessus), <code>ulimit -n</code>, et les garde-fous applicatifs : taille max de
            frame, connexions max, rate-limit.</li>
        <li><strong>Les points de rupture.</strong> À quel niveau ça casse, et <em>comment</em> — refus
            propre ou effondrement ? (<code>ws-connections.mjs --rupture</code>.)</li>
        <li><strong>La preuve.</strong> Rejouer ce banc sur l'image de production, à la charge cible, et
            joindre le rapport. Un dimensionnement sans mesure sur l'artefact réel n'est qu'une intention.</li>
      </ol>` +
        `<div class="row">${printButton("Imprimer / PDF")} ${deckControls()}</div>`,
    ),
  );

  return doc({
    title: "Que peut encaisser un process Nodefony ?",
    subtitle:
      "Constantes mesurées sur cette machine, et le calcul de dimensionnement qui en découle — " +
      "sockets simultanées, débit temps réel, requêtes HTTP, nombre de pods.",
    sections: secs,
    // Les données sources voyagent AVEC le rapport : rejouable, comparable d'un
    // run à l'autre, et ré-ingérable par une machine.
    data: R,
    footer:
      `<strong>Provenance</strong> — ${generatedAt} · <code>${command}</code><br>` +
      `${env.env} · Nodefony ${env.version} · node ${env.node} (${env.platform}) · ${env.cores} cœurs · ` +
      `payload WS ${PAYLOAD} o · ${REPEAT} runs par mesure.`,
  });
}
