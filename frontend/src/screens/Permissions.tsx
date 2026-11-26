import { useCallback, useEffect, useState } from "react";

import type { Me } from "../api.ts";
import { ApiError, api } from "../api.ts";
import { BackButton } from "../components/BackButton.tsx";
import { Dialog } from "../components/Dialog.tsx";
import type { Go } from "../components/Shell.tsx";
import { Icon } from "../icons.tsx";
import type { CargoGrants, Matrix, PermissionInfo, SwitchGroup } from "../permissions.ts";
import { cannotLine, changes, groupLine, isOn, readOnlyReason, rowNotes, saveWarnings, switchGroups, toggle, working } from "../permissions.ts";
import { roleName } from "../roles.ts";

/**
 * Permisos (App Plan, "Roles and permissions"): what each cargo may do. First
 * the cargo, then its switches. Nothing is saved until "¿Está correcto?". The
 * server decides every save and every request; this screen only shows it.
 */
export function PermissionsScreen({
  me,
  roleCode,
  onOpen,
}: {
  me: Me;
  /** The cargo being looked at; null for the list of cargos. */
  roleCode: string | null;
  onOpen: Go;
}) {
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = me.permissions.includes("permissions:edit");

  const load = useCallback(async () => {
    try {
      setMatrix(await api<Matrix>("GET", "/permissions"));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loading = !matrix && <p className={error ? "message error" : "muted"}>{error ?? "Cargando…"}</p>;

  if (roleCode) {
    const cargo = matrix?.roles.find((role) => role.code === roleCode);
    const back = <BackButton label="Permisos" onClick={() => onOpen("/permisos")} />;
    if (!matrix || !cargo) {
      return (
        <main className="screen stack">
          {back}
          <h1>{roleName(roleCode)}</h1>
          {loading}
        </main>
      );
    }
    return (
      <Cargo
        me={me}
        cargo={cargo}
        permissions={matrix.permissions}
        back={back}
        reload={load}
        onSaved={(granted) =>
          setMatrix({ ...matrix, roles: matrix.roles.map((role) => (role.code === cargo.code ? { ...role, granted } : role)) })
        }
      />
    );
  }

  const groups = matrix ? switchGroups(matrix.permissions) : [];
  return (
    <main className="screen stack">
      <BackButton onClick={() => onOpen("/")} />
      <h1>Permisos</h1>
      <p>{canEdit ? "Elija un cargo para ver o cambiar lo que puede hacer." : "Elija un cargo para ver lo que puede hacer."}</p>
      {loading}
      <div className="choice-grid cargo-grid">
        {matrix?.roles.map((role) => (
          <button key={role.code} className="btn choice cargo-choice" onClick={() => onOpen(`/permisos/${role.code}`)}>
            <span>{role.name}</span>
            <small>
              {cannotLine(groups, working(role.granted, matrix.permissions))}
              {role.code === me.roleCode ? " · el suyo" : ""}
            </small>
          </button>
        ))}
      </div>
    </main>
  );
}

/** One cargo: its switches, what has been tapped and not saved, and the save. */
function Cargo({
  me,
  cargo,
  permissions,
  back,
  reload,
  onSaved,
}: {
  me: Me;
  cargo: CargoGrants;
  permissions: PermissionInfo[];
  back: React.ReactNode;
  reload: () => Promise<void>;
  onSaved: (granted: string[]) => void;
}) {
  /** What the switches show while something is tapped and not saved; null when nothing is. */
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const readOnly = readOnlyReason(me.permissions.includes("permissions:edit"), me.roleCode, cargo.code);
  const groups = switchGroups(permissions);
  const saved = working(cargo.granted, permissions);
  const shown = draft ?? saved;
  const diff = changes(groups, saved, shown);
  const count = diff.removed.length + diff.added.length;

  const save = async () => {
    setBusy(true);
    setSaveError(null);
    const granted = [...shown];
    try {
      // `expected` makes the server refuse a save made from a screen someone else has since changed.
      await api("PUT", `/permissions/${cargo.code}`, { granted, expected: cargo.granted });
      setConfirming(false);
      setDraft(null);
      onSaved(granted);
      setMessage({ kind: "ok", text: "Guardado. Vale desde ahora. En otro teléfono, los botones cambian al volver a abrir la app." });
    } catch (err) {
      if (err instanceof ApiError && err.code === "stale") {
        await reload();
        setConfirming(false);
        setDraft(null);
        setMessage({ kind: "error", text: err.message });
      } else {
        setSaveError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <div className="stack">
        {back}
        <h1>{cargo.name}</h1>
        <p>{readOnly ?? "Toque un permiso para cambiarlo. Nada cambia hasta que guarde."}</p>
        <CargoSwitches
          groups={groups}
          permissions={permissions}
          saved={saved}
          shown={shown}
          locked={cargo.locked}
          onToggle={
            readOnly
              ? undefined
              : (next) => {
                  setMessage(null);
                  setDraft(next);
                }
          }
        />
      </div>

      {/* Outside the list, so it stays at the bottom of the screen however far down the person is. */}
      {(count > 0 || message) && (
        <div className="save-bar" role="status">
          {count > 0 ? (
            <>
              <strong>{count === 1 ? "1 cambio sin guardar" : `${count} cambios sin guardar`}</strong>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <button className="btn" onClick={() => setDraft(null)}>
                  Deshacer
                </button>
                <button
                  className="btn go"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setSaveError(null);
                    setConfirming(true);
                  }}
                >
                  Revisar y guardar
                </button>
              </div>
            </>
          ) : (
            <p className={`message ${message!.kind}`}>{message!.text}</p>
          )}
        </div>
      )}

      {confirming && (
        <Dialog title="¿Está correcto?" onClose={() => setConfirming(false)}>
          <p style={{ margin: 0 }}>
            Cargo: <strong>{cargo.name}</strong>
          </p>
          <ChangeList title="Ya no podrá:" items={diff.removed} />
          <ChangeList title="Ahora podrá:" items={diff.added} />
          {saveWarnings(saved, shown).map((warning) => (
            <p key={warning} className="message warn">
              {warning}
            </p>
          ))}
          {saveError && <p className="message error">{saveError}</p>}
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <button className="btn" onClick={() => setConfirming(false)}>
              Corregir
            </button>
            <button className="btn go" style={{ flex: 1 }} disabled={busy} onClick={() => void save()}>
              <Icon name="check" /> Sí, guardar
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}

function ChangeList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <strong>{title}</strong>
      <ul className="change-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The cargo's permissions, a switch each: word, icon and color say whether it
 * is on. Without `onToggle` they are only read.
 */
export function CargoSwitches({
  groups,
  permissions,
  saved,
  shown,
  locked,
  onToggle,
}: {
  groups: SwitchGroup[];
  permissions: PermissionInfo[];
  saved: ReadonlySet<string>;
  shown: ReadonlySet<string>;
  locked: readonly string[];
  onToggle?: ((next: Set<string>) => void) | undefined;
}) {
  return (
    <>
      {groups.map((group) => {
        const line = onToggle ? groupLine(group, permissions) : null;
        return (
          <section key={group.title} className="stack" style={{ gap: 8 }}>
            <h2 style={{ margin: 0 }}>{group.title}</h2>
            {line && <p className="muted">{line}</p>}
            {group.switches.map((sw) => {
              const on = isOn(sw, shown);
              const kept = sw.codes.some((code) => locked.includes(code));
              const notes = rowNotes(group, sw, permissions);
              if (kept) notes.push("El Administrador siempre lo conserva.");
              const inside = (
                <>
                  <span className="permission-words">
                    <span>{sw.label}</span>
                    {notes.map((note) => (
                      <small key={note}>{note}</small>
                    ))}
                  </span>
                  <span className="permission-answer">
                    {kept ? (
                      <span className="status ok">
                        <Icon name="lock" size={18} /> Siempre
                      </span>
                    ) : (
                      <span className={`status ${on ? "ok" : "danger"}`}>
                        <Icon name={on ? "check" : "x"} size={18} /> {on ? "Sí" : "No"}
                      </span>
                    )}
                    {on !== isOn(sw, saved) && <small>sin guardar</small>}
                  </span>
                </>
              );
              return onToggle && !kept ? (
                <button
                  key={sw.codes[0]}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  className="permission-row"
                  onClick={() => onToggle(toggle(shown, sw, permissions))}
                >
                  {inside}
                </button>
              ) : (
                <div key={sw.codes[0]} className="permission-row fixed">
                  {inside}
                </div>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
