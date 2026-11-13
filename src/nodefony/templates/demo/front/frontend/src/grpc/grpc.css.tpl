/*
 * La page gRPC (`GrpcLesson.tsx`) : la machine en direct, la trame octet par
 * octet, les refus, la suite. Tout passe par les variables de `demo.css` :
 * les deux thèmes suivent sans une ligne de plus.
 */

.grpc-live {
  display: grid;
  gap: 12px;
  margin: 8px 0 20px;
  padding: 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  min-width: 0;
}
.grpc-live-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.grpc-live-head h2 {
  margin: 0;
  font-size: 1.05rem;
}
.grpc-state.is-on {
  color: var(--green);
  border-color: var(--green);
}
.grpc-state.is-off {
  color: var(--muted);
}

.grpc-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin: 0;
}
.grpc-metrics div {
  display: grid;
}
.grpc-metrics dt {
  font-size: 0.78rem;
  color: var(--muted);
}
.grpc-metrics dd {
  margin: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.grpc-curve {
  margin: 0;
}
.grpc-curve svg {
  display: block;
  width: 100%;
  height: 150px;
  background: var(--bg-soft);
  border-radius: 8px;
}
.grpc-curve polyline {
  stroke: var(--blue);
  stroke-width: 2;
}
.grpc-curve figcaption,
.grpc-log figcaption,
.grpc-wire figcaption,
.grpc-refusals figcaption {
  font-size: 0.82rem;
  color: var(--muted);
  margin-top: 4px;
}

.grpc-run p,
.grpc-step-run p {
  margin: 0 0 4px;
}
.grpc-closed {
  margin-top: 8px;
  font-weight: 600;
}

.grpc-doc {
  font-size: 0.85rem;
  color: var(--muted);
}
/* Le bleu seul passe sous 4,5:1 sur la carte en thème sombre (mesuré 3,26). */
.grpc-doc a {
  color: color-mix(in srgb, var(--blue) 50%, var(--fg));
}

.grpc-log {
  margin: 8px 0;
}
.grpc-log pre {
  margin: 4px 0 0;
  padding: 8px 10px;
  max-height: 180px;
  overflow: auto;
  font:
    0.75rem/1.5 ui-monospace,
    SFMono-Regular,
    Menlo,
    Consolas,
    monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
}

/* La trame : un groupe par morceau, une couleur par nature — mêlée au texte,
   sans quoi le violet passe sous 4,5:1 en thème sombre (mesuré 3,08). */
.grpc-wire {
  margin: 8px 0;
  min-width: 0;
}
.grpc-bytes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 4px;
  margin-top: 6px;
  font:
    0.8rem/1 ui-monospace,
    SFMono-Regular,
    Menlo,
    Consolas,
    monospace;
}
.grpc-seg {
  display: inline-block;
  padding: 4px 6px;
  border-radius: 5px;
  border: 1px solid currentColor;
}
.grpc-wire .is-envelope {
  color: color-mix(in srgb, var(--violet) 60%, var(--fg));
}
.grpc-wire .is-key {
  color: var(--muted);
}
.grpc-wire .is-text {
  color: color-mix(in srgb, var(--green) 60%, var(--fg));
}
.grpc-wire .is-number {
  color: color-mix(in srgb, var(--blue) 60%, var(--fg));
}
.grpc-wire .is-trailer {
  color: color-mix(in srgb, var(--amber) 60%, var(--fg));
}
.grpc-wire .is-rest {
  color: color-mix(in srgb, var(--danger) 60%, var(--fg));
}
.grpc-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.82rem;
  font-weight: 600;
}
.grpc-segments {
  margin: 8px 0 0;
  padding-left: 1.4rem;
  font-size: 0.8rem;
}
.grpc-segments code {
  white-space: nowrap;
}

.grpc-refusals {
  margin: 8px 0;
  min-width: 0;
  overflow-x: auto;
}
.grpc-refusals table {
  border-collapse: collapse;
  font-size: 0.85rem;
  margin-bottom: 8px;
}
.grpc-refusals th,
.grpc-refusals td {
  text-align: left;
  padding: 4px 10px 4px 0;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

.grpc-next {
  margin: 24px 0;
}
.grpc-next-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 16px;
}
.grpc-next article {
  min-width: 0;
}
.grpc-next h3 {
  font-size: 1rem;
  margin: 0 0 6px;
}
