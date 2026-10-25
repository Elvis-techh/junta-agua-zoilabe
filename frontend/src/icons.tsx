/**
 * Every button has an icon AND a word (App Plan, design rules). Simple line
 * icons, drawn inline so they work with no signal.
 */
const PATHS = {
  home: "M3 11 12 3l9 8M5 9.5V21h5v-6h4v6h5V9.5",
  house: "M3 11 12 3l9 8M5 9.5V21h14V9.5M10 14h4v7h-4z",
  search: "M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15ZM16 16l5 5",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  cash: "M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9v.01M18 15v.01",
  receipt: "M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2zM9 7h6M9 11h6M9 15h4",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  alert: "M12 3 2 20h20L12 3ZM12 10v4M12 17v.01",
  check: "M4 12.5 9.5 18 20 6",
  print: "M6 9V3h12v6M6 18H3v-8h18v8h-3M6 14h12v7H6z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 3",
  people: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 6v1",
  key: "M15 9a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM13.5 13.5 21 21M17 17l2-2M19 19l2-2",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3Z",
  exit: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l-5-5 5-5M5 12h11",
  plus: "M12 5v14M5 12h14",
  phone: "M7 2h10v20H7zM11 18h2",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  whatsapp: "M3 21l1.6-4.8A9 9 0 1 1 8 19.6L3 21ZM9 9c.5 2.5 3 5 6 6l1.5-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2L9 9Z",
  back: "M15 5l-7 7 7 7",
  x: "M6 6l12 12M18 6 6 18",
  pin: "M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  edit: "M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4",
  upload: "M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19.5 10 4 4 0 0 1 18 18M12 12v9M8.5 15.5 12 12l3.5 3.5",
  paper: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  signal: "M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 26 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
