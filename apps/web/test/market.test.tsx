import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Costs, FigureCard } from "../src/market/Figures";
import { Comparison } from "../src/market/Comparison";
import { Observations } from "../src/market/Observations";
import { FIGURE_SECTIONS, groupFigures, humanAge, LABELS, plainHeadline, type ComparisonRow, type CostAssumption, type Figure, type MarketObservation, type MarketView } from "../src/market/data";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => undefined;

const impact: Figure = {
  key: "BALANCE_IMPACT",
  label: "EVENT_IMPACT",
  headline: "Every QSRx balance on X Layer was scaled by 1.0066516577977895 / 1.",
  value: "0.665165779779",
  unit: "% of a holder's token balance",
  signed: true,
  inputs: [{ name: "multiplier after", value: "1.0066516577977895", unit: "multiplier", evidenceId: "EV-CA", observedAt: "2026-09-18T00:30:00.000Z" }],
  limitations: ["This is a change in the number of tokens, not a price return."],
  missing: [],
};

const missing: Figure = {
  key: "QUOTED_SPREAD",
  label: "INSUFFICIENT_DATA",
  headline: "No spread is shown, because no two-sided quote exists in the sources this desk is allowed to read.",
  value: null,
  unit: "USD",
  signed: false,
  inputs: [{ name: "bid", value: null, unit: "USD", evidenceId: null, observedAt: null }],
  limitations: ["The issuer publishes one reference number per asset."],
  missing: ["no buy-side ask price", "no quote expiry"],
};

describe("a figure on the Market Desk", () => {
  it("shows what kind of claim it is before it shows the number", () => {
    const html = render(createElement(FigureCard, { figure: impact, onOpenEvidence: noop }));
    expect(html).toContain("EVENT IMPACT");
    expect(html.indexOf("EVENT IMPACT")).toBeLessThan(html.indexOf("0.665165779779"));
  });

  it("signs a figure that has a direction", () => {
    expect(render(createElement(FigureCard, { figure: impact, onOpenEvidence: noop }))).toContain("+0.665165779779");
    const fell: Figure = { ...impact, value: "-0.66077056013" };
    const html = render(createElement(FigureCard, { figure: fell, onOpenEvidence: noop }));
    expect(html).toContain("-0.66077056013");
    expect(html).not.toContain("+-");
  });

  it("is never rendered in the verified colour, because no figure here is an amount anyone offered", () => {
    for (const f of [impact, missing]) {
      expect(render(createElement(FigureCard, { figure: f, onOpenEvidence: noop })), f.key).not.toContain("--verified");
    }
  });

  it("puts the missing inputs where the number would have been, and prints no number at all", () => {
    const html = render(createElement(FigureCard, { figure: missing, onOpenEvidence: noop }));
    expect(html).toContain("INSUFFICIENT DATA");
    expect(html).toContain("Not shown");
    expect(html).toContain("no buy-side ask price");
    expect(html).toContain("no quote expiry");
    // nothing that could be read as a value for a figure the desk refused to compute
    expect(html).not.toMatch(/mk-value">[+-]?\d/);
  });

  it("names an input the desk does not have rather than leaving the row blank", () => {
    expect(render(createElement(FigureCard, { figure: missing, onOpenEvidence: noop }))).toContain("not available");
  });

  it("offers the evidence item behind each input", () => {
    expect(render(createElement(FigureCard, { figure: impact, onOpenEvidence: noop }))).toContain("EV-CA");
  });
});

describe("the four labels", () => {
  it("each say in one sentence what kind of claim they are", () => {
    for (const [key, label] of Object.entries(LABELS)) {
      expect(label.text, key).toMatch(/^[A-Z ]+$/);
      expect(label.meaning.length, key).toBeGreaterThan(30);
    }
    expect(LABELS.REFERENCE_DISCREPANCY.meaning).toMatch(/not an executable quote/i);
    expect(LABELS.INSUFFICIENT_DATA.meaning).toMatch(/withheld/i);
  });
});

describe("the observations chart", () => {
  const points: MarketObservation[] = [
    { at: "2026-09-18T00:30:00.000Z", multiplier: "1", source: "ISSUER", key: "PUBLISHED_BEFORE", evidenceId: "EV-CA", blockNumber: null, mode: "HISTORICAL" },
    { at: "2026-09-18T00:30:00.000Z", multiplier: "1.0066516577977895", source: "ISSUER", key: "PUBLISHED_AFTER", evidenceId: "EV-CA", blockNumber: null, mode: "HISTORICAL" },
    { at: "2026-09-18T00:29:00.000Z", multiplier: "1", source: "CHAIN", key: "BEFORE", evidenceId: "EV-CHAIN-BEFORE", blockNumber: 70922304, mode: "HISTORICAL" },
    { at: "2026-09-18T19:27:53.000Z", multiplier: "1.0066516577977895", source: "CHAIN", key: "HEAD", evidenceId: "EV-CHAIN-LATEST", blockNumber: 70990637, mode: "HISTORICAL" },
  ];

  it("draws one mark per recorded observation and nothing joining them", () => {
    const html = render(createElement(Observations, { points, eventMarkerAt: "2026-09-18T00:30:00.000Z", note: "Nothing is drawn between them.", chainWithheld: false, chainReadCount: 4 }));
    expect((html.match(/<circle/g) ?? []).length).toBe(4);
    // a line or a path between observations would claim the desk knows the value in between
    expect(html).not.toContain("<polyline");
    expect(html).not.toContain("<path");
    expect(html).not.toContain("<rect");
  });

  it("marks the effective time and says how many observations there are", () => {
    const html = render(createElement(Observations, { points, eventMarkerAt: "2026-09-18T00:30:00.000Z", note: "n", chainWithheld: false, chainReadCount: 4 }));
    expect(html).toContain("EFFECTIVE");
    expect(html).toContain("4 observations");
  });

  it("draws nothing at all when nothing was observed", () => {
    const html = render(createElement(Observations, { points: [], eventMarkerAt: null, note: "n", chainWithheld: false, chainReadCount: 0 }));
    expect(html).not.toContain("<circle");
    expect(html).toContain("nothing to draw");
  });

  it("leaves out a point whose timestamp or value it cannot read, instead of placing it at zero", () => {
    const broken = [...points, { at: "not a time", multiplier: "1.5", source: "CHAIN" as const, key: "HEAD", evidenceId: null, blockNumber: null, mode: null }, { at: "2026-09-18T01:00:00.000Z", multiplier: "1,024.5", source: "CHAIN" as const, key: "HEAD", evidenceId: null, blockNumber: null, mode: null }];
    const html = render(createElement(Observations, { points: broken, eventMarkerAt: null, note: "n", chainWithheld: false, chainReadCount: 4 }));
    expect((html.match(/<circle/g) ?? []).length).toBe(4);
  });

  it("says how many on-chain reads are withheld when the chain side is paid content", () => {
    const issuerOnly = points.filter((p) => p.source === "ISSUER");
    const html = render(createElement(Observations, { points: issuerOnly, eventMarkerAt: "2026-09-18T00:30:00.000Z", note: "part of the Brief", chainWithheld: true, chainReadCount: 4 }));
    expect(html).toContain("4 on-chain reads withheld");
    expect((html.match(/<circle/g) ?? []).length).toBe(2);
  });
});

describe("the cost table", () => {
  const costs: CostAssumption[] = [
    { name: "withholding tax on the distribution", value: "0", unit: "rate", basis: "ISSUER_PUBLISHED", note: "the issuer states 0" },
    { name: "slippage at size", value: null, unit: "unknown", basis: "UNKNOWN", note: "no depth or book is published" },
  ];

  it("prints an unknown cost as unknown and never as zero", () => {
    const html = render(createElement(Costs, { costs }));
    expect(html).toContain("unknown");
    // the one zero on screen is the withholding rate the issuer actually published
    const zeros = (html.match(/>0</g) ?? []).length;
    expect(zeros).toBe(1);
    expect(html).toContain("the issuer states 0");
  });
});

describe("the comparison panel", () => {
  const rows: ComparisonRow[] = [
    { what: "Issuer reference price", source: "api.xstocks.fi", url: "https://api.xstocks.fi/x", evidenceId: "EV-PRICE", value: "72.75", unit: "USD per unit", observedAt: "2026-09-18T19:28:23.114Z", fetchedAt: "2026-09-18T19:28:23.114Z", ageSeconds: 58, stale: false, mode: "HISTORICAL", sha256: "a".repeat(64), note: "One number, no side, no size." },
    { what: "Executable buy quote (ask)", source: "—", url: null, evidenceId: null, value: null, unit: "USD", observedAt: null, fetchedAt: null, ageSeconds: null, stale: true, mode: null, sha256: null, note: "No source in the permitted set publishes one." },
  ];

  it("keeps the rows it has no value for, and says so in them", () => {
    const html = render(createElement(Comparison, { rows, evidence: [], onOpenEvidence: noop }));
    expect(html).toContain("Executable buy quote (ask)");
    expect(html).toContain("none published");
    expect(html).toContain("No source in the permitted set publishes one.");
  });

  it("renders the provenance word for a row that has a mode", () => {
    const html = render(createElement(Comparison, { rows, evidence: [], onOpenEvidence: noop }));
    expect(html).toContain("HISTORICAL<");
  });

  it("offers an evidence button only for a row whose item is present", () => {
    const withItem = render(
      createElement(Comparison, {
        rows,
        evidence: [{ id: "EV-PRICE", kind: "REFERENCE_PRICE", observedAt: "2026-09-18T19:28:23.114Z", staleAfter: "2026-09-18T19:58:23.114Z", stale: false, summary: null, values: null, valuesWithheld: false, provenance: { mode: "HISTORICAL", source: "api.xstocks.fi", url: "https://api.xstocks.fi/x", fetchedAt: "2026-09-18T19:28:23.114Z", sha256: "a".repeat(64) } }],
        onOpenEvidence: noop,
      }),
    );
    expect(withItem).toContain("mk-evi-btn");
    expect(render(createElement(Comparison, { rows, evidence: [], onOpenEvidence: noop }))).not.toContain("mk-evi-btn");
  });
});

describe("the plain-English headline", () => {
  const view = (value: string | null): MarketView =>
    ({
      asset: { symbol: "QSRx", name: "Restaurant Brands International xStock", underlyingSymbol: "QSR", tokenIsin: null, network: "XLayer", chainId: 196, tokenAddress: "0x" },
      figures: value === null ? [] : [{ ...impact, value }],
    }) as unknown as MarketView;

  it("says which way the balance moved rather than assuming it rose", () => {
    expect(plainHeadline(view("0.665165779779"))).toContain("grew by 0.665165779779%");
    expect(plainHeadline(view("-0.5"))).toContain("fell by 0.5%");
    expect(plainHeadline(view("-0.5"))).not.toContain("-0.5%");
  });

  it("does not claim a direction it has no figure for", () => {
    expect(plainHeadline(view(null))).toContain("changed how QSRx balances are scaled");
    expect(plainHeadline(view("0"))).toContain("leaves every QSRx balance unchanged");
  });
});

describe("an age a reader has to judge freshness by", () => {
  it("reads in the units the gap deserves", () => {
    expect(humanAge(null)).toBe("unknown");
    expect(humanAge(58)).toBe("58 s");
    expect(humanAge(3600)).toBe("60 min");
    expect(humanAge(68246)).toBe("18 h 57 min");
    expect(humanAge(-58)).toBe("58 s");
  });
});

describe("how figures are grouped into sections", () => {
  const fig = (key: string, label: Figure["label"] = "EVENT_IMPACT"): Figure => ({ ...impact, key, label });

  it("keeps a figure on screen when its label changes to INSUFFICIENT_DATA", () => {
    // the comparison with the chain is withheld both when no read exists and when the reads are
    // part of the Brief. Grouping by label dropped the card in exactly those two cases.
    const withheld = fig("ISSUER_VERSUS_CHAIN", "INSUFFICIENT_DATA");
    const sections = groupFigures([fig("BALANCE_IMPACT"), withheld]);
    const shown = sections.flatMap((s) => s.figures.map((f) => f.key));
    expect(shown).toContain("ISSUER_VERSUS_CHAIN");
  });

  it("drops nothing, and puts a figure it does not recognise in a section of its own", () => {
    const all = [fig("BALANCE_IMPACT"), fig("QUOTED_SPREAD", "INSUFFICIENT_DATA"), fig("SOMETHING_NEW")];
    const sections = groupFigures(all);
    const shown = sections.flatMap((s) => s.figures.map((f) => f.key));
    expect(shown.sort()).toEqual(all.map((f) => f.key).sort());
    expect(sections.at(-1)?.title).toBe("Also computed");
  });

  it("puts every figure in exactly one section", () => {
    const keys = FIGURE_SECTIONS.flatMap((s) => s.keys as readonly string[]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
