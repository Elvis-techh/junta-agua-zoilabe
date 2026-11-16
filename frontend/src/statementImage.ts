/**
 * The statement as a picture, to send by WhatsApp (App Plan, Module 5:
 * "PDF or image"; the owner chose the image on 15 November 2026).
 *
 * Drawn by hand on a canvas from the same lines the screen shows
 * (src/statement.ts): no library, and nothing leaves the phone to make it.
 */
import type { StatementLine } from "./statement.ts";

const WIDTH = 1080;
const MARGIN = 64;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** How each kind of line is written: its size, weight and colour, and the space above it. */
const STYLE: Record<StatementLine["kind"], { size: number; weight: number; color: string; above: number }> = {
  title: { size: 46, weight: 700, color: "#0b5c8c", above: 0 },
  heading: { size: 40, weight: 700, color: "#14212b", above: 44 },
  row: { size: 34, weight: 500, color: "#14212b", above: 22 },
  total: { size: 38, weight: 700, color: "#14212b", above: 28 },
  text: { size: 34, weight: 400, color: "#14212b", above: 12 },
  small: { size: 28, weight: 400, color: "#55626d", above: 12 },
};
const SUB = { size: 27, color: "#55626d" };

/** Words broken into lines no wider than `width`, as `measure` sees them. */
export function wrapText(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const longer = line ? `${line} ${word}` : word;
    if (line && measure(longer) > width) {
      lines.push(line);
      line = word;
    } else {
      line = longer;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

/** The app's icon, for the top of the picture; null if it cannot be read. */
async function loadLogo(): Promise<HTMLImageElement | null> {
  try {
    const image = new Image();
    image.src = "/icon-192.png";
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

/** The statement drawn as a PNG. */
export async function statementImage(lines: readonly StatementLine[]): Promise<Blob> {
  const logo = await loadLogo();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("No se pudo hacer la imagen en este teléfono.");
  }
  const font = (size: number, weight: number) => `${weight} ${size}px ${FONT}`;
  const inner = WIDTH - 2 * MARGIN;

  // Twice over the same steps: once to measure the height, once to draw.
  const pass = (draw: boolean): number => {
    let y = MARGIN;
    if (logo) {
      if (draw) context.drawImage(logo, MARGIN, y, 96, 96);
      y += 96 + 24;
    }
    for (const line of lines) {
      const style = STYLE[line.kind];
      y += style.above;
      if (line.kind === "heading") {
        if (draw) {
          context.fillStyle = "#d5dde3";
          context.fillRect(MARGIN, y, inner, 2);
        }
        y += 28;
      }
      context.font = font(style.size, style.weight);
      const amountWidth = line.amount ? context.measureText(line.amount).width + 32 : 0;
      const wrapped = wrapText(line.text, inner - amountWidth, (text) => context.measureText(text).width);
      wrapped.forEach((text, index) => {
        y += Math.round(style.size * 1.3);
        if (draw) {
          context.fillStyle = style.color;
          context.textAlign = "left";
          context.fillText(text, MARGIN, y);
          if (index === 0 && line.amount) {
            context.textAlign = "right";
            context.fillText(line.amount, WIDTH - MARGIN, y);
          }
        }
      });
      if (line.sub) {
        context.font = font(SUB.size, 400);
        for (const text of wrapText(line.sub, inner, (sub) => context.measureText(sub).width)) {
          y += Math.round(SUB.size * 1.35);
          if (draw) {
            context.fillStyle = SUB.color;
            context.textAlign = "left";
            context.fillText(text, MARGIN, y);
          }
        }
      }
    }
    return y + MARGIN;
  };

  canvas.width = WIDTH;
  canvas.height = pass(false);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textBaseline = "alphabetic";
  pass(true);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("No se pudo hacer la imagen en este teléfono.");
  }
  return blob;
}
