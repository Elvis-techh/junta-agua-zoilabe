/**
 * Permisos: what a cargo's screen shows, and what a tap changes. The server
 * sends the permissions, the one each needs and which are locked
 * (GET /permissions) and checks every save; here they are grouped into
 * switches, so a person sees the result before saving it.
 */

export interface PermissionInfo {
  code: string;
  /** The server's words for it. */
  label: string;
  /** The permission it does nothing without, or null. */
  requires: string | null;
}

export interface CargoGrants {
  code: string;
  name: string;
  granted: string[];
  /** What this cargo always keeps: the administrator's way back in. */
  locked: string[];
}

export interface Matrix {
  permissions: PermissionInfo[];
  roles: CargoGrants[];
}

export interface PermissionSwitch {
  /** More than one only for codes the app cannot tell apart: they go on and off together. The first names the switch. */
  codes: string[];
  label: string;
}

export interface SwitchGroup {
  title: string;
  switches: PermissionSwitch[];
}

/** Not shown, and saved as they are: guest invitations are set aside (owner, 25 November 2026). */
export const HIDDEN: readonly string[] = ["guests:manage"];

const GROUPS: ReadonlyArray<{ title: string; switches: string[][] }> = [
  {
    title: "Censo",
    switches: [
      ["census:view"],
      ["census:view_sensitive"],
      ["census:edit"],
      ["census:deactivate"],
      // The only place a different fee is set today is while registering, and either code allows it.
      ["household_fee:set_at_registration", "household_fee:set"],
      ["export:census"],
    ],
  },
  {
    title: "Finanzas",
    switches: [["finance:view"], ["finance:record"], ["finance:reverse"], ["month:prepare"], ["month:approve"], ["export:finance"]],
  },
  { title: "Historial", switches: [["log:view"], ["export:log"]] },
  { title: "Administración", switches: [["users:manage"], ["settings:edit"], ["permissions:view"], ["permissions:edit"]] },
];

/** What the board should know before changing a switch, beyond its name. */
const NOTES: Readonly<Record<string, string>> = {
  "finance:view": "Muestra también los nombres de quienes deben.",
  "finance:record": "Para cobrar también necesita ver el censo.",
  "users:manage": "Con esto puede crear cuentas de cualquier cargo.",
  "permissions:edit": "Sirve para cambiar los otros cargos, no el propio.",
};

/** The server's permissions as switches. One that no group has yet is shown too, under "Otros", never lost. */
export function switchGroups(permissions: readonly PermissionInfo[]): SwitchGroup[] {
  const known = new Map(permissions.map((info) => [info.code, info]));
  const placed = new Set<string>(HIDDEN);
  const groups: SwitchGroup[] = GROUPS.map((group) => ({
    title: group.title,
    switches: group.switches.flatMap((codes) => {
      const here = codes.filter((code) => known.has(code));
      here.forEach((code) => placed.add(code));
      return here.length ? [{ codes: here, label: known.get(here[0]!)!.label }] : [];
    }),
  }));
  const others = permissions.filter((info) => !placed.has(info.code));
  if (others.length) {
    groups.push({ title: "Otros", switches: others.map((info) => ({ codes: [info.code], label: info.label })) });
  }
  return groups.filter((group) => group.switches.length > 0);
}

export function isOn(sw: PermissionSwitch, granted: ReadonlySet<string>): boolean {
  return sw.codes.some((code) => granted.has(code));
}

const needsOf = (permissions: readonly PermissionInfo[]) => new Map(permissions.map((info) => [info.code, info.requires]));

/** Takes out whatever needs something that is not there, and then whatever needed that. */
function dropUnmet(granted: Set<string>, needs: Map<string, string | null>): Set<string> {
  for (let removed = true; removed; ) {
    removed = false;
    for (const code of granted) {
      const needed = needs.get(code);
      if (needed && !granted.has(needed)) {
        granted.delete(code);
        removed = true;
      }
    }
  }
  return granted;
}

/** What a cargo can really do with what is stored for it: the same rule the server applies to every request. */
export function working(granted: Iterable<string>, permissions: readonly PermissionInfo[]): Set<string> {
  return dropUnmet(new Set(granted), needsOf(permissions));
}

/**
 * One tap on a switch. Off takes with it everything that needs it (owner, 25
 * November 2026); on brings along what it needs.
 */
export function toggle(granted: ReadonlySet<string>, sw: PermissionSwitch, permissions: readonly PermissionInfo[]): Set<string> {
  const needs = needsOf(permissions);
  const next = new Set(granted);
  if (isOn(sw, granted)) {
    sw.codes.forEach((code) => next.delete(code));
    return dropUnmet(next, needs);
  }
  for (const first of sw.codes) {
    for (let code: string | null | undefined = first; code; code = needs.get(code)) {
      next.add(code);
    }
  }
  return next;
}

/** The switches that differ between two sets, by name, in the screen's order. */
export function changes(
  groups: readonly SwitchGroup[],
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
): { removed: string[]; added: string[] } {
  const all = groups.flatMap((group) => group.switches);
  return {
    removed: all.filter((sw) => isOn(sw, before) && !isOn(sw, after)).map((sw) => sw.label),
    added: all.filter((sw) => !isOn(sw, before) && isOn(sw, after)).map((sw) => sw.label),
  };
}

/** Under a cargo's name in the list: "Puede todo", "No puede 2 cosas". */
export function cannotLine(groups: readonly SwitchGroup[], granted: ReadonlySet<string>): string {
  const off = groups.flatMap((group) => group.switches).filter((sw) => !isOn(sw, granted)).length;
  if (off === 0) return "Puede todo";
  return off === 1 ? "No puede 1 cosa" : `No puede ${off} cosas`;
}

/** The group's first switch, when every other one in the group does nothing without it. */
function baseOf(group: SwitchGroup, permissions: readonly PermissionInfo[]): PermissionSwitch | null {
  const needs = needsOf(permissions);
  const [first, ...rest] = group.switches;
  if (!first || rest.length === 0) return null;
  const leadsTo = (code: string): boolean => {
    const needed = needs.get(code);
    return needed != null && (first.codes.includes(needed) || leadsTo(needed));
  };
  return rest.every((sw) => sw.codes.every(leadsTo)) ? first : null;
}

/** Said once under a group's title, so each of its switches does not have to. */
export function groupLine(group: SwitchGroup, permissions: readonly PermissionInfo[]): string | null {
  const base = baseOf(group, permissions);
  return base ? `Si quita «${base.label}», se quita también lo demás de ${group.title}.` : null;
}

/** The lines under one switch. */
export function rowNotes(group: SwitchGroup, sw: PermissionSwitch, permissions: readonly PermissionInfo[]): string[] {
  const needed = needsOf(permissions).get(sw.codes[0]!);
  const base = baseOf(group, permissions);
  const notes: string[] = [];
  if (needed && !base?.codes.includes(needed)) {
    notes.push(`Necesita «${permissions.find((info) => info.code === needed)?.label ?? needed}».`);
  }
  const note = NOTES[sw.codes[0]!];
  if (note) notes.push(note);
  return notes;
}

/**
 * Why this person may only read a cargo's permissions, in the screen's words;
 * null when they may change them. Nobody changes their own cargo's (owner, 25
 * November 2026). The server refuses both by itself.
 */
export function readOnlyReason(canEdit: boolean, myRoleCode: string, cargoCode: string): string | null {
  if (!canEdit) return "Su cargo puede ver los permisos, pero no cambiarlos.";
  if (cargoCode === myRoleCode) {
    return "Nadie puede cambiar los permisos de su propio cargo. Lo hace alguien de otro cargo con «Editar los permisos».";
  }
  return null;
}

/** What "¿Está correcto?" warns about before a save. */
export function saveWarnings(before: ReadonlySet<string>, after: ReadonlySet<string>): string[] {
  const takes = [...before].some((code) => !after.has(code));
  return takes && after.has("users:manage")
    ? ["Este cargo conserva «Administrar usuarios»: puede crear una cuenta de otro cargo."]
    : [];
}
