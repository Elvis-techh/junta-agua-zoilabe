import { useEffect, useState } from "react";

import type { Me } from "../api.ts";
import { api } from "../api.ts";
import type { CensusOptions, HouseholdRow } from "../census.ts";
import type { CensusList, CensusListFormat, CensusListStatus } from "../censusList.ts";
import {
  CENSUS_LIST_COLUMNS,
  STATUS_CHOICES,
  censusListCsv,
  censusListFileName,
  censusListHeading,
  householdCount,
} from "../censusList.ts";
import { BackButton } from "../components/BackButton.tsx";
import type { Go } from "../components/Shell.tsx";
import { Icon } from "../icons.tsx";
import { recall } from "../queue.ts";

/** A list that was handed out, and how: printed, or saved as a file. */
interface Made {
  list: CensusList;
  format: CensusListFormat;
  fileUrl: string;
}

/**
 * Lista del censo (App Plan, "Reports"): the census filtered by sector and
 * status, to print or to save for Excel. Choosing changes nothing; "Imprimir"
 * and "Guardar para Excel" give the list a document number, then print it or
 * save the file, with the same heading and columns either way.
 */
export function CensusListScreen({ me, onOpen }: { me: Me; onOpen: Go }) {
  const [sectorId, setSectorId] = useState("");
  const [status, setStatus] = useState<CensusListStatus>("active");
  const [count, setCount] = useState<number | null>(null);
  const [sectors, setSectors] = useState(() => recall<CensusOptions>("options")?.sectors ?? []);
  const [made, setMade] = useState<Made | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CensusOptions>("GET", "/census/options")
      .then((options) => setSectors(options.sectors))
      .catch(() => undefined);
  }, []);

  // How many houses the list will have, as Censo counts them.
  useEffect(() => {
    let current = true;
    setCount(null);
    const query = new URLSearchParams();
    if (sectorId) query.set("sectorId", sectorId);
    if (status !== "all") query.set("status", status);
    api<{ households: HouseholdRow[] }>("GET", `/census/households?${query}`)
      .then((data) => current && setCount(data.households.length))
      .catch((err: Error) => current && setError(err.message));
    return () => {
      current = false;
    };
  }, [sectorId, status]);

  // The file is let go of when another is made or the screen closes.
  useEffect(() => () => {
    if (made) URL.revokeObjectURL(made.fileUrl);
  }, [made]);

  // Printing waits until the list is on the page.
  useEffect(() => {
    if (made?.format === "print") {
      window.print();
    }
  }, [made]);

  const handOut = async (format: CensusListFormat) => {
    setBusy(true);
    setError(null);
    try {
      const list = await api<CensusList>("POST", "/census/list", {
        ...(sectorId ? { sectorId: Number(sectorId) } : {}),
        status,
        format,
      });
      const file = new Blob([censusListCsv(list)], { type: "text/csv;charset=utf-8" });
      const fileUrl = URL.createObjectURL(file);
      if (format === "csv") {
        const link = document.createElement("a");
        link.href = fileUrl;
        link.download = censusListFileName(list);
        link.click();
      }
      setMade({ list, format, fileUrl });
      window.scrollTo(0, 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const hidden = !me.permissions.includes("census:view_sensitive");

  if (made) {
    const { list } = made;
    return (
      <main className="screen wide stack">
        <BackButton label="Censo" onClick={() => onOpen("/censo")} />
        <h1>Lista del censo</h1>
        <p className="message ok">
          {made.format === "print"
            ? `Lista del censo nº ${list.document.number}, lista para imprimir.`
            : `Lista del censo nº ${list.document.number}, guardada como archivo para Excel.`}
        </p>
        <div className="row">
          {made.format === "print" ? (
            <button className="btn go" onClick={() => window.print()}>
              <Icon name="print" /> Imprimir otra vez
            </button>
          ) : (
            <a className="btn go" href={made.fileUrl} download={censusListFileName(list)}>
              <Icon name="down" /> Guardar otra vez
            </a>
          )}
          <button
            className="btn"
            onClick={() => {
              setMade(null);
              window.scrollTo(0, 0);
            }}
          >
            <Icon name="edit" /> Hacer otra
          </button>
        </div>
        <CensusListDocument list={list} />
      </main>
    );
  }

  return (
    <main className="screen stack">
      <BackButton label="Censo" onClick={() => onOpen("/censo")} />
      <h1>Lista del censo</h1>
      <div className="filters">
        <label>
          Sector
          <select value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
            <option value="">Todos</option>
            {sectors.map((sector) => (
              <option key={sector.id} value={sector.id}>
                {sector.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Viviendas
          <select value={status} onChange={(e) => setStatus(e.target.value as CensusListStatus)}>
            {(Object.keys(STATUS_CHOICES) as CensusListStatus[]).map((choice) => (
              <option key={choice} value={choice}>
                {STATUS_CHOICES[choice]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {count === null ? "Contando…" : householdCount(count)}
        {hidden ? " · con la identidad y el teléfono ocultos, porque su cargo no los ve completos." : ""}
      </p>
      {error && <p className="message error">{error}</p>}
      <div className="row">
        <button className="btn go" disabled={busy || count === 0} onClick={() => void handOut("print")}>
          <Icon name="print" /> {busy ? "Haciendo…" : "Imprimir"}
        </button>
        <button className="btn" disabled={busy || count === 0} onClick={() => void handOut("csv")}>
          <Icon name="down" /> Guardar para Excel
        </button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Cada lista que se imprime o se guarda lleva su número de documento.
      </p>
    </main>
  );
}

/** The list as it is printed: the heading lines, then the table, from the same columns as the file. */
export function CensusListDocument({ list }: { list: CensusList }) {
  const [board, title, ...rest] = censusListHeading(list);
  return (
    <section className="print-document print-table">
      <p className="print-board">{board}</p>
      <h2>{title}</h2>
      {rest.map((line, index) => (
        <p key={index} className="muted">
          {line}
        </p>
      ))}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {CENSUS_LIST_COLUMNS.map((column) => (
                <th key={column.title}>{column.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.households.map((row) => (
              <tr key={row.code}>
                {CENSUS_LIST_COLUMNS.map((column) => (
                  <td key={column.title}>{column.value(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
