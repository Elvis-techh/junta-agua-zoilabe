import { useCallback, useEffect, useState } from "react";

import type { Invitation, Me, StaffUser } from "../api.ts";
import { api } from "../api.ts";
import { ConfirmPin } from "../components/ConfirmPin.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { Icon } from "../icons.tsx";
import { ROLES, roleName } from "../roles.ts";
import { formatDate, formatDateTime } from "../time.ts";

/** Status as word + icon + color together, never color alone. */
function StatusBadge({ user }: { user: StaffUser }) {
  if (user.locked) {
    return <span className="status danger"><Icon name="lock" size={18} /> Bloqueada</span>;
  }
  switch (user.status) {
    case "active":
      return <span className="status ok"><Icon name="check" size={18} /> Activa</span>;
    case "invited":
      return <span className="status warn"><Icon name="clock" size={18} /> Invitada</span>;
    case "suspended":
      return <span className="status danger"><Icon name="x" size={18} /> Suspendida</span>;
    case "deactivated":
      return <span className="status danger"><Icon name="x" size={18} /> Desactivada</span>;
  }
}

export function UsersScreen({ me }: { me: Me }) {
  const [users, setUsers] = useState<StaffUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<StaffUser | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ users: StaffUser[] }>("GET", "/users");
      setUsers(data.users);
      setSelected((current) => (current ? data.users.find((u) => u.id === current.id) ?? null : null));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="screen stack">
      <h1>Usuarios</h1>
      <button className="btn primary block" onClick={() => setCreating(true)}>
        <Icon name="plus" /> Nueva cuenta
      </button>
      {error && <p className="message error">{error}</p>}
      {!users && !error && <p className="muted">Cargando…</p>}

      <div className="list">
        {users?.map((user) => (
          <button
            key={user.id}
            className="card"
            style={{ textAlign: "left", font: "inherit", cursor: "pointer" }}
            onClick={() => setSelected(user)}
          >
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <strong>{user.name}</strong>
              <StatusBadge user={user} />
            </div>
            <div className="muted">
              {user.roleName} · {user.phone}
            </div>
            <div className="muted">
              {user.lastLoginAt ? `Último ingreso: ${formatDateTime(user.lastLoginAt)}` : "Todavía no ha entrado"}
            </div>
          </button>
        ))}
      </div>

      {creating && (
        <CreateUser
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            // Open the new account straight away: the next step is its invitation.
            void api<{ users: StaffUser[] }>("GET", "/users").then((data) => {
              setUsers(data.users);
              setSelected(data.users.find((u) => u.id === id) ?? null);
            });
          }}
        />
      )}

      {selected && (
        <UserActions user={selected} isSelf={selected.id === me.id} onClose={() => setSelected(null)} onChanged={load} />
      )}
    </main>
  );
}

/** Nueva cuenta: name, WhatsApp, role, then "¿Está correcto?". */
function CreateUser({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: { id: string } }>("POST", "/users", { name, phone, roleCode });
      onCreated(user.id);
    } catch (err) {
      setError((err as Error).message);
      setReviewing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Nueva cuenta" onClose={onClose}>
      {!reviewing ? (
        <>
          <label>
            Nombre completo
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus autoCapitalize="words" />
          </label>
          <label>
            Número de WhatsApp
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              placeholder="8 números"
            />
          </label>
          <label>
            Cargo
            <select value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
              <option value="">Elija un cargo</option>
              {ROLES.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="message error">{error}</p>}
          <button
            className="btn go block"
            disabled={name.trim().length < 3 || phone.length !== 8 || !roleCode}
            onClick={() => setReviewing(true)}
          >
            Siguiente
          </button>
        </>
      ) : (
        <>
          <p style={{ fontSize: "1.2rem" }}>¿Está correcto?</p>
          <div className="card">
            <strong>{name.trim()}</strong>
            <div>WhatsApp: {phone}</div>
            <div>Cargo: {roleName(roleCode)}</div>
          </div>
          <button className="btn go block" disabled={busy} onClick={() => void save()}>
            <Icon name="check" /> Sí, crear la cuenta
          </button>
          <button className="btn block" onClick={() => setReviewing(false)}>
            <Icon name="back" /> Corregir
          </button>
        </>
      )}
    </Dialog>
  );
}

function UserActions({
  user,
  isSelf,
  onClose,
  onChanged,
}: {
  user: StaffUser;
  isSelf: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [newRole, setNewRole] = useState(user.roleCode);
  const [askPin, setAskPin] = useState(false);
  const [devices, setDevices] = useState<Array<{ id: string; label: string | null; lastUsedAt: string | null }> | null>(null);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setMessage(null);
    try {
      await action();
      setMessage({ kind: "ok", text: done });
      await onChanged();
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
  };

  const invite = () =>
    run(async () => {
      setInvitation(await api<Invitation>("POST", `/users/${user.id}/invitation`));
    }, "Invitación lista. Envíela por WhatsApp.");

  const loadDevices = async () => {
    const data = await api<{ devices: Array<{ id: string; label: string | null; lastUsedAt: string | null }> }>(
      "GET",
      `/users/${user.id}/devices`,
    );
    setDevices(data.devices);
  };

  const canInvite = user.status === "invited" || user.status === "active";

  return (
    <Dialog title={user.name} onClose={onClose}>
      <div className="row" style={{ alignItems: "center" }}>
        <StatusBadge user={user} />
        <span className="muted">{user.roleName}</span>
      </div>

      {message && <p className={`message ${message.kind}`}>{message.text}</p>}

      {invitation ? (
        <div className="card stack">
          <p>El enlace sirve una sola vez, hasta el {formatDateTime(invitation.expiresAt)}</p>
          <a className="btn go block" href={invitation.whatsappUrl} target="_blank" rel="noreferrer">
            <Icon name="whatsapp" /> Enviar por WhatsApp
          </a>
          <button
            className="btn block"
            onClick={() => void navigator.clipboard?.writeText(invitation.message).then(() => setMessage({ kind: "ok", text: "Mensaje copiado." }))}
          >
            Copiar el mensaje
          </button>
        </div>
      ) : (
        canInvite && (
          <button className="btn primary block" onClick={() => void invite()}>
            <Icon name="whatsapp" /> {user.status === "invited" ? "Enviar invitación" : "Enviar invitación nueva (PIN nuevo)"}
          </button>
        )
      )}

      {user.locked && (
        <button
          className="btn primary block"
          onClick={() => void run(() => api("POST", `/users/${user.id}/unlock`), "Cuenta desbloqueada.")}
        >
          <Icon name="lock" /> Desbloquear (después de llamarle por teléfono)
        </button>
      )}

      {!isSelf && user.status !== "deactivated" && (
        <>
          <h2>Cargo</h2>
          <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            {ROLES.map((role) => (
              <option key={role.code} value={role.code}>
                {role.name}
              </option>
            ))}
          </select>
          <button className="btn block" disabled={newRole === user.roleCode} onClick={() => setAskPin(true)}>
            <Icon name="check" /> Cambiar cargo a {roleName(newRole)}
          </button>
        </>
      )}

      <h2>Teléfonos registrados</h2>
      {devices === null ? (
        <button className="btn block" onClick={() => void loadDevices()}>
          <Icon name="phone" /> Ver teléfonos ({user.devices})
        </button>
      ) : devices.length === 0 ? (
        <p className="muted">Ningún teléfono registrado.</p>
      ) : (
        devices.map((device) => (
          <div key={device.id} className="card row" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <strong>{device.label ?? "Teléfono"}</strong>
              <div className="muted">{device.lastUsedAt ? `Usado: ${formatDate(device.lastUsedAt)}` : "Sin usar todavía"}</div>
            </div>
            <button
              className="btn danger"
              onClick={() =>
                void run(async () => {
                  await api("POST", `/users/${user.id}/devices/${device.id}/remove`);
                  await loadDevices();
                }, "Teléfono quitado. Envíe una invitación nueva para el teléfono nuevo.")
              }
            >
              <Icon name="x" /> Quitar
            </button>
          </div>
        ))
      )}

      {!isSelf && (
        <>
          <h2>Cuenta</h2>
          {(user.status === "active" || user.status === "invited") && (
            <button
              className="btn danger block"
              onClick={() => void run(() => api("POST", `/users/${user.id}/suspend`, {}), "Cuenta suspendida.")}
            >
              Suspender
            </button>
          )}
          {user.status === "suspended" && (
            <button
              className="btn block"
              onClick={() => void run(() => api("POST", `/users/${user.id}/reactivate`), "Cuenta reactivada. Envíe una invitación nueva.")}
            >
              Reactivar
            </button>
          )}
          {user.status !== "deactivated" && (
            <button
              className="btn danger block"
              onClick={() =>
                window.confirm(`¿Desactivar la cuenta de ${user.name}? Ya no podrá entrar.`) &&
                void run(() => api("POST", `/users/${user.id}/deactivate`, {}), "Cuenta desactivada.")
              }
            >
              Desactivar
            </button>
          )}
        </>
      )}

      {askPin && (
        <ConfirmPin
          onClose={() => setAskPin(false)}
          onConfirmed={() => {
            setAskPin(false);
            void run(
              () => api("PATCH", `/users/${user.id}/role`, { roleCode: newRole }),
              `Cargo cambiado a ${roleName(newRole)}.`,
            );
          }}
        />
      )}
    </Dialog>
  );
}
