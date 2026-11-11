// AG Studio data sources: SayItPayIt's money activity, Guardian decisions and open requests.
import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat } from "ag-studio";
import type { DashboardData } from "@/lib/dashboard-data";

type Spec = [id: string, name: string, format: AgFormat, hide?: boolean];
const fields = (specs: Spec[]): AgFieldDefinition[] => specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));

export function buildStudioData(data: DashboardData): AgDataSourcesDefinition {
  return {
    sources: [
      {
        id: "transactions",
        name: "Money activity",
        description:
          "Every payment the user sent and every request/split share they asked for. amountUsd is in USD for totals across currencies; amount is in the original currency. risk is Guardian's 0-100 risk score (payments only).",
        data: data.transactions,
        fields: fields([
          ["id", "Transaction ID", "textFormat", true],
          ["date", "Date", "dateFormat"],
          ["kind", "Kind", "textFormat"],
          ["person", "Person", "textFormat"],
          ["country", "Country", "textFormat"],
          ["currency", "Currency", "textFormat"],
          ["amount", "Amount (original)", "decimalFormat"],
          ["amountUsd", "Amount (USD)", "currencyFormat"],
          ["feeUsd", "Fees (USD)", "currencyFormat"],
          ["status", "Status", "textFormat"],
          ["risk", "Risk score", "integerFormat"],
          ["decision", "Guardian decision", "textFormat"],
          ["category", "Payment type", "textFormat"],
          ["route", "Route", "textFormat"],
          ["channel", "How it was made", "textFormat"],
          ["note", "For", "textFormat"],
        ]),
      },
      {
        id: "guardian",
        name: "Guardian checks",
        description: "Every Guardian check before money moved: decision, risk score (0-100), scam-language score (0-100), the warning signs. intervened is 1 when Guardian questioned, held or stopped a payment.",
        data: data.guardian,
        fields: fields([
          ["id", "Check ID", "textFormat", true],
          ["date", "Date", "dateFormat"],
          ["decision", "Decision", "textFormat"],
          ["risk", "Risk score", "integerFormat"],
          ["scam", "Scam-language score", "integerFormat"],
          ["signals", "Warning signs", "textFormat"],
          ["person", "Person", "textFormat"],
          ["intervened", "Interventions", "integerFormat"],
        ]),
      },
      {
        id: "owed",
        name: "Who owes what",
        description: "Open requests and bill-split shares people still owe the user (in USD), and how many days each has been open.",
        data: data.owed,
        fields: fields([
          ["id", "Request ID", "textFormat", true],
          ["person", "Person", "textFormat"],
          ["forWhat", "For", "textFormat"],
          ["amountUsd", "Owed (USD)", "currencyFormat"],
          ["currency", "Currency", "textFormat"],
          ["amount", "Owed (original)", "decimalFormat"],
          ["daysOpen", "Days open", "integerFormat"],
        ]),
      },
    ],
  };
}
