"use client";

// SayItPayIt custom AG Studio widgets. Each reads its fields through Studio's data engine
// (widgetApi.getData with the widget's data mapping), so filters and cross-filtering apply.
import type { AgWidgetField, AgWidgetFormParams, AgWidgetParams } from "ag-studio";
import { AgIncompleteDataMappingOverlay, AgLoadingOverlay, AgNoDataOverlay } from "ag-studio-react";
import { useEffect, useState } from "react";

type Mapping = Record<string, AgWidgetField[] | undefined>;
type Props = AgWidgetParams & { dataMapping: Mapping };

/** Load rows for the given mapping keys; re-runs whenever Studio re-renders the widget (filters, data). */
function useRows(props: Props, keys: string[]) {
  const fields = keys.flatMap((k) => props.dataMapping?.[k] ?? []);
  const complete = keys.every((k) => (props.dataMapping?.[k]?.length ?? 0) > 0);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const sig = JSON.stringify(fields.map((f) => [f.key, f.aggregation]));
  useEffect(() => {
    if (!complete) return;
    let live = true;
    props.widgetApi
      .getData({ fields }, { queryId: "rows" })
      .then((r) => {
        if (live && !r.replaced) setRows(r.results.rows);
      })
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sig captures the field set
  }, [props.widgetApi, sig, complete, props]);
  const key = (k: string) => props.dataMapping?.[k]?.[0]?.key ?? k;
  return { rows, complete, key };
}

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const box: React.CSSProperties = { height: "100%", display: "flex", flexDirection: "column", gap: 10, color: "var(--color-paper)", fontFamily: "var(--font-sans)" };

// ---------- Guardian shield: risk gauge ----------

export function GuardianGauge(props: Props) {
  const { rows, complete, key } = useRows(props, ["risk", "interventions", "checks"]);
  if (!complete) return <AgIncompleteDataMappingOverlay />;
  if (!rows) return <AgLoadingOverlay />;
  if (!rows.length) return <AgNoDataOverlay />;
  const r = rows[0];
  const risk = Math.round(Number(r[key("risk")] ?? 0));
  const stepped = Number(r[key("interventions")] ?? 0);
  const checks = Number(r[key("checks")] ?? 0);
  const color = risk >= 60 ? "var(--color-coral)" : risk >= 30 ? "var(--color-amber)" : "var(--color-signal)";
  const R = 70;
  const len = Math.PI * R;
  return (
    <div style={{ ...box, alignItems: "center", justifyContent: "center" }}>
      <svg viewBox="0 0 170 98" style={{ width: "min(100%, 260px)" }} role="img" aria-label={`Average risk ${risk} out of 100`}>
        <path d={`M15 88 A${R} ${R} 0 0 1 155 88`} fill="none" stroke="var(--color-line)" strokeWidth="14" strokeLinecap="round" />
        <path d={`M15 88 A${R} ${R} 0 0 1 155 88`} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - Math.max(0.02, risk / 100))} />
        <text x="85" y="84" textAnchor="middle" style={{ fill: "var(--color-paper)", font: "700 34px var(--font-display)" }}>
          {risk}
        </text>
      </svg>
      <p style={{ margin: 0, color: "var(--color-mist)" }}>Average risk across {checks} checks</p>
      <p style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: stepped ? "var(--color-amber)" : "var(--color-signal)" }}>
        {stepped ? `Guardian stepped in ${stepped} time${stepped === 1 ? "" : "s"}` : "No interventions needed"}
      </p>
    </div>
  );
}

// ---------- Who owes what: friendly scoreboard ----------

const AVATAR = ["#3fd0b6", "#7aa7ff", "#c7a6ff", "#f2b544", "#8fd3ff", "#9be27a"];

export function OwesBoard(props: Props) {
  const { rows, complete, key } = useRows(props, ["person", "owed", "days"]);
  if (!complete) return <AgIncompleteDataMappingOverlay />;
  if (!rows) return <AgLoadingOverlay />;
  if (!rows.length) return <AgNoDataOverlay />;
  const list = rows
    .map((r) => ({ person: String(r[key("person")] ?? "?"), owed: Number(r[key("owed")] ?? 0), days: Number(r[key("days")] ?? 0) }))
    .sort((a, b) => b.owed - a.owed);
  const total = list.reduce((a, x) => a + x.owed, 0);
  return (
    <div style={box}>
      <p style={{ margin: 0, color: "var(--color-mist)" }}>
        {usd(total)} on its way back to you from {list.length} {list.length === 1 ? "person" : "people"}
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8, overflow: "auto" }}>
        {list.map((x, i) => (
          <li key={x.person} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", borderRadius: 12, background: "rgba(14,26,43,0.55)" }}>
            <span aria-hidden style={{ width: 36, height: 36, borderRadius: 999, display: "grid", placeItems: "center", fontWeight: 700, color: "var(--color-ink)", background: AVATAR[i % AVATAR.length] }}>
              {x.person.slice(0, 1).toUpperCase()}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 700 }}>{x.person}</span>
              <span style={{ fontSize: 13, color: x.days > 14 ? "var(--color-amber)" : "var(--color-mist)" }}>
                {x.days <= 1 ? "asked today" : x.days > 14 ? `${x.days} days — a friendly nudge?` : `${x.days} days ago`}
              </span>
            </span>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700 }}>{usd(x.owed)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Cross-border tracker ----------

export function CrossBorder(props: Props) {
  const { rows, complete, key } = useRows(props, ["route", "amount", "fees"]);
  if (!complete) return <AgIncompleteDataMappingOverlay />;
  if (!rows) return <AgLoadingOverlay />;
  if (!rows.length) return <AgNoDataOverlay />;
  const by = Object.fromEntries(rows.map((r) => [String(r[key("route")]), { amount: Number(r[key("amount")] ?? 0), fees: Number(r[key("fees")] ?? 0) }]));
  const abroad = by["Abroad"] ?? { amount: 0, fees: 0 };
  const home = by["Domestic"] ?? { amount: 0, fees: 0 };
  const total = abroad.amount + home.amount || 1;
  const pct = Math.round((abroad.amount / total) * 100);
  const feePct = abroad.amount ? ((abroad.fees / abroad.amount) * 100).toFixed(1) : "0";
  return (
    <div style={box}>
      <p style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 700 }}>{usd(abroad.amount)}</p>
      <p style={{ margin: 0, color: "var(--color-mist)" }}>sent abroad, {pct}% of everything you sent</p>
      <div aria-hidden style={{ height: 12, borderRadius: 999, background: "var(--color-line)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--color-signal)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "var(--color-mist)" }}>
        <span>Abroad {usd(abroad.amount)}</span>
        <span>At home {usd(home.amount)}</span>
      </div>
      <p style={{ margin: "4px 0 0" }}>
        Fees on money sent abroad: <strong>{usd(abroad.fees)}</strong> <span style={{ color: "var(--color-mist)" }}>({feePct}% of it, shown upfront in every read-back)</span>
      </p>
    </div>
  );
}

// ---------- Definitions for createWidgets ----------

const formFor = (items: { key: string; label: string }[]) => (params: AgWidgetFormParams<never>) => params.createDefaults({ dataMappingItems: items } as never);

export const CUSTOM_WIDGETS = [
  {
    id: "guardian-gauge",
    label: "Guardian shield",
    icon: { url: "/file.svg" },
    dataMapping: {
      risk: { type: "field", supportedRoles: ["numeric"], requires: { cardinality: "one" }, required: true, aiDescription: "Average Guardian risk score (0-100)." },
      interventions: { type: "field", supportedRoles: ["numeric"], requires: { cardinality: "one" }, required: true, aiDescription: "Total number of Guardian interventions." },
      checks: { type: "field", supportedRoles: ["numeric", "category"], requires: { cardinality: "one" }, required: true, aiDescription: "Count of Guardian checks." },
    },
    form: formFor([
      { key: "risk", label: "Risk" },
      { key: "interventions", label: "Interventions" },
      { key: "checks", label: "Checks" },
    ]),
    comp: GuardianGauge,
    defaultSize: { width: 400, height: 300 },
    minSize: { width: 260, height: 220 },
  },
  {
    id: "owes-board",
    label: "Who owes what",
    icon: { url: "/file.svg" },
    dataMapping: {
      person: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "Person who owes money." },
      owed: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.person", cardinality: "one" }, required: true, aiDescription: "Amount owed per person." },
      days: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.person", cardinality: "one" }, required: true, aiDescription: "Days the oldest request has been open." },
    },
    form: formFor([
      { key: "person", label: "Person" },
      { key: "owed", label: "Owed" },
      { key: "days", label: "Days open" },
    ]),
    comp: OwesBoard,
    defaultSize: { width: 420, height: 360 },
    minSize: { width: 300, height: 240 },
  },
  {
    id: "cross-border",
    label: "Cross-border tracker",
    icon: { url: "/globe.svg" },
    dataMapping: {
      route: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "Abroad or Domestic." },
      amount: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.route", cardinality: "one" }, required: true, aiDescription: "USD amount per route." },
      fees: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.route", cardinality: "one" }, required: true, aiDescription: "Fees per route." },
    },
    form: formFor([
      { key: "route", label: "Route" },
      { key: "amount", label: "Amount" },
      { key: "fees", label: "Fees" },
    ]),
    comp: CrossBorder,
    defaultSize: { width: 420, height: 300 },
    minSize: { width: 300, height: 220 },
  },
] as const;
