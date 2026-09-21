import satori, { init, type SatoriOptions } from "satori/standalone";
import yoga from "satori/yoga.wasm";
import latin from "@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff";
import cyrillic from "@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff";
import latinBold from "@fontsource/noto-sans/files/noto-sans-latin-600-normal.woff";
import cyrillicBold from "@fontsource/noto-sans/files/noto-sans-cyrillic-600-normal.woff";
import type { CampaignReport } from "./campaignReport.js";

const fonts: SatoriOptions["fonts"] = [
  { name: "Report", data: latin, weight: 400, style: "normal" },
  { name: "Cyrillic", data: cyrillic, weight: 400, style: "normal" },
  { name: "Report", data: latinBold, weight: 600, style: "normal" },
  { name: "Cyrillic", data: cyrillicBold, weight: 600, style: "normal" },
];
let initialized: Promise<void> | undefined;

type Element = Parameters<typeof satori>[0];
type Style = Record<string, string | number>;
function box(style: Style, children: Element | Element[]): Element {
  return {
    type: "div",
    props: { style: { display: "flex", ...style }, children },
  } as Element;
}
function text(value: string, style: Style = {}): Element {
  return box(
    { whiteSpace: "pre-wrap", wordBreak: "break-word", ...style },
    value,
  );
}

export async function campaignReportSvg(
  report: CampaignReport,
  onNodeDetected?: SatoriOptions["onNodeDetected"],
): Promise<string> {
  initialized ??= init(yoga).catch((error: unknown) => {
    initialized = undefined;
    throw error;
  });
  await initialized;
  const ink = "#202b32";
  const muted = "#607078";
  const cells = (row: string[], header: boolean, index: number) =>
    box(
      {
        width: "100%",
        minHeight: header ? 60 : 100,
        backgroundColor: header ? "#e8edf0" : index % 2 ? "#f6f8fa" : "#ffffff",
        borderBottom: "1px solid #dae1e5",
        alignItems: "stretch",
      },
      row.map((cell, column) =>
        box(
          {
            width: `${report.columns[column]!.width}%`,
            padding: "18px 16px",
            flexShrink: 0,
            alignItems: "center",
            fontSize: header ? 20 : 23,
            fontWeight: header || column === 0 ? 600 : 400,
            color: header ? muted : ink,
          },
          text(cell),
        ),
      ),
    );
  return satori(
    box(
      {
        width: 1200,
        minHeight: 580,
        padding: 40,
        backgroundColor: "#f3f5f6",
        color: ink,
        flexDirection: "column",
        fontFamily: "Report, Cyrillic",
        fontSize: 23,
        lineHeight: 1.4,
      },
      [
        text(report.subtitle, {
          fontSize: 22,
          color: "#147b70",
          marginBottom: 8,
        }),
        text(report.title, { fontSize: 38, fontWeight: 600, marginBottom: 26 }),
        box(
          { flexWrap: "wrap", gap: 14, marginBottom: 28 },
          report.fields.map((field) =>
            box(
              {
                width: report.fields.length === 3 ? 364 : 553,
                minHeight: 110,
                padding: "16px 20px",
                backgroundColor: "#ffffff",
                border: "1px solid #d5dde1",
                borderRadius: 6,
                flexDirection: "column",
              },
              [
                text(field.label, {
                  color: muted,
                  fontSize: 20,
                  marginBottom: 8,
                }),
                text(field.value, { fontWeight: 600, fontSize: 26 }),
              ],
            ),
          ),
        ),
        box(
          {
            flexDirection: "column",
            width: "100%",
            border: "1px solid #d5dde1",
            borderRadius: 6,
          },
          [
            cells(
              report.columns.map((column) => column.label),
              true,
              0,
            ),
            ...report.rows.map((row, index) => cells(row, false, index)),
          ],
        ),
      ],
    ),
    { width: 1200, fonts, onNodeDetected },
  );
}

export async function renderCampaignReport(
  report: CampaignReport,
): Promise<Uint8Array> {
  const svg = await campaignReportSvg(report);
  const { Resvg } = await import("@cf-wasm/resvg/legacy/workerd");
  const renderer = await Resvg.async(svg, {
    fitTo: { mode: "width", value: 1200 },
  });
  try {
    const rendered = renderer.render();
    try {
      return rendered.asPng();
    } finally {
      rendered.free();
    }
  } finally {
    renderer.free();
  }
}
