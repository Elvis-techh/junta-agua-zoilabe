import type { Me } from "../api.ts";
import { BackButton } from "../components/BackButton.tsx";
import type { Go } from "../components/Shell.tsx";
import { Icon } from "../icons.tsx";
import { reportsFor } from "../reports.ts";

/**
 * Reportes: every report this person may make, in one list, each with a line
 * saying what it is for. A tap opens the screen that makes it, whose way back
 * returns here. Nothing is made, numbered or sent from this screen.
 */
export function ReportsScreen({ me, onOpen }: { me: Me; onOpen: Go }) {
  const reports = reportsFor(me.permissions);

  return (
    <main className="screen stack">
      <BackButton onClick={() => onOpen("/")} />
      <h1>Reportes</h1>
      {reports.length === 0 && <p className="message error">Su cargo no tiene permiso para ningún reporte. Pregunte al presidente.</p>}
      {reports.map((report) => (
        <button key={report.title} className="card household-card" onClick={() => onOpen(report.route)}>
          <strong className="row" style={{ alignItems: "center", gap: 8 }}>
            <Icon name={report.icon} /> {report.title}
          </strong>
          <div className="muted">{report.about}</div>
        </button>
      ))}
    </main>
  );
}
