// The built-in "My money" report: AG Studio state with SayItPayIt's custom widgets and built-ins.
// Canvas is 24 tracks wide; field ids ("transactions.amountUsd") refer to studio-data.ts.
import type { AgReportState } from "ag-studio";

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number) => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string, subtitle?: string) => ({
  title: { enabled: true, text },
  ...(subtitle && { subtitle: { enabled: true, text: subtitle } }),
});
const f = (id: string, aggregation?: "sum" | "avg" | "count" | "countd" | "max") => ({ id, ...(aggregation && { aggregation }) });

export const initialReport = {
  panels: { filters: { collapsed: true }, edit: { collapsed: true }, data: { collapsed: true }, ai: { collapsed: false, width: 420 } },
  selectedPageId: "money",
  pages: [
    {
      id: "money",
      widgets: {
        guardian: {
          type: "guardian-gauge",
          dataMapping: { risk: [f("guardian.risk", "avg")], interventions: [f("guardian.intervened", "sum")], checks: [f("guardian.id", "count")] },
          format: title("Guardian shield", "Checks before any money moves"),
        },
        owes: {
          type: "owes-board",
          dataMapping: { person: [f("owed.person")], owed: [f("owed.amountUsd", "sum")], days: [f("owed.daysOpen", "max")] },
          format: title("Who owes what"),
        },
        crossBorder: {
          type: "cross-border",
          dataMapping: { route: [f("transactions.route")], amount: [f("transactions.amountUsd", "sum")], fees: [f("transactions.feeUsd", "sum")] },
          format: title("Cross-border tracker"),
        },
        byPerson: {
          type: "bar-chart-grouped",
          dataMapping: { categoryKey: [f("transactions.person")], valueKey: [f("transactions.amountUsd", "sum")] },
          format: title("Money by person", "USD, sent and requested"),
        },
        overTime: {
          type: "line-chart",
          dataMapping: { categoryKey: [f("transactions.date")], valueKey: [f("transactions.amountUsd", "sum")] },
          format: title("Activity over time"),
        },
        ledger: {
          type: "grid",
          dataMapping: {
            cols: [
              f("transactions.date"),
              f("transactions.kind"),
              f("transactions.person"),
              f("transactions.amount"),
              f("transactions.currency"),
              f("transactions.amountUsd"),
              f("transactions.risk"),
              f("transactions.decision"),
              f("transactions.category"),
              f("transactions.channel"),
              f("transactions.status"),
            ],
          },
          format: title("Every transaction, with Guardian's risk score"),
        },
      },
      widgetLayout: {
        guardian: at(0, 0, 8, 17),
        owes: at(8, 0, 8, 17),
        crossBorder: at(16, 0, 8, 17),
        byPerson: at(0, 17, 12, 17),
        overTime: at(12, 17, 12, 17),
        ledger: at(0, 34, 24, 24),
      },
    },
    {
      id: "guardian-page",
      widgets: {
        decisions: {
          type: "donut-chart",
          dataMapping: { categoryKey: [f("guardian.decision")], valueKey: [f("guardian.id", "count")] },
          format: title("What Guardian decided"),
        },
        channels: {
          type: "bar-chart-grouped",
          dataMapping: { categoryKey: [f("transactions.category")], valueKey: [f("transactions.amountUsd", "sum")] },
          format: title("Friends & Family vs Goods & Services", "USD"),
        },
        checks: {
          type: "grid",
          dataMapping: { cols: [f("guardian.date"), f("guardian.person"), f("guardian.decision"), f("guardian.risk"), f("guardian.scam"), f("guardian.signals")] },
          format: title("Every Guardian check"),
        },
      },
      widgetLayout: {
        decisions: at(0, 0, 10, 18),
        channels: at(10, 0, 14, 18),
        checks: at(0, 18, 24, 24),
      },
    },
  ],
} as unknown as AgReportState;

export const PAGE_TITLES: Record<string, string> = { money: "My money", "guardian-page": "Guardian" };
