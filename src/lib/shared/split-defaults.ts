/**
 * Saved default splits per kind of house bill, and the editable "draft" form
 * of a split used by the entry form and Settings (inputs are strings while
 * someone is typing).
 */
import { round2 } from "./money";
import type { SplitConfig, SplitMode, UserSettings } from "./types";

export interface SplitDraft {
  mode: SplitMode;
  participants: string[];
  ratios: Record<string, string>;
  fixed: Record<string, string>;
}

/** Percentages that add up to exactly 100, e.g. 33.34 / 33.33 / 33.33 (first person gets the extra). */
export function evenPercents(names: string[]): Record<string, string> {
  if (names.length === 0) return {};
  const hundredths = 10000;
  const base = Math.floor(hundredths / names.length);
  let extra = hundredths - base * names.length;
  const out: Record<string, string> = {};
  for (const n of names) {
    const v = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    out[n] = String(v / 100);
  }
  return out;
}

/** Turn a saved split into an editable draft for the current household. */
export function draftFromConfig(config: SplitConfig | null | undefined, people: string[], adminName: string): SplitDraft {
  const known = (config?.participants ?? []).filter((p) => people.includes(p));
  const participants = known.length ? people.filter((p) => known.includes(p)) : [...people];
  const even = evenPercents(participants);
  return {
    mode: config && known.length ? config.mode : "equal",
    participants,
    ratios: Object.fromEntries(people.map((p) => [p, config?.ratios?.[p] != null ? String(config.ratios[p]) : even[p] ?? "0"])),
    fixed: Object.fromEntries(
      people.filter((p) => p !== adminName).map((p) => [p, config?.fixedAmounts?.[p] != null ? String(config.fixedAmounts[p]) : ""]),
    ),
  };
}

function num(s: string | undefined): number {
  const n = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Turn a draft back into a split config (people kept in household order). */
export function configFromDraft(d: SplitDraft, people: string[]): SplitConfig {
  const participants = people.filter((p) => d.participants.includes(p));
  return {
    mode: d.mode,
    participants,
    ...(d.mode === "ratio" ? { ratios: Object.fromEntries(participants.map((p) => [p, round2(num(d.ratios[p]))])) } : {}),
    ...(d.mode === "fixed"
      ? { fixedAmounts: Object.fromEntries(participants.filter((p) => p in d.fixed).map((p) => [p, round2(num(d.fixed[p]))])) }
      : {}),
  };
}

/** Sum of the entered percentages for people taking part. */
export function percentTotal(d: SplitDraft): number {
  return round2(d.participants.reduce((s, p) => s + num(d.ratios[p]), 0));
}

/** The default split for a kind of house bill (everyone equally if none is saved). */
export function defaultSplitDraft(
  settings: Pick<UserSettings, "defaultSplits">,
  subCategory: string,
  people: string[],
  adminName: string,
): SplitDraft {
  return draftFromConfig(settings.defaultSplits?.[subCategory] ?? null, people, adminName);
}

/** Short description, e.g. "Alia & Nana, equally" or "Alia 50% · Nana 30% · Alisa 20%". */
export function describeSplit(config: SplitConfig | null | undefined, people: string[]): string {
  const who = (config?.participants ?? people).filter((p) => people.includes(p));
  if (!config || who.length === 0) return `${joinNames(people)}, equally`;
  if (config.mode === "equal") return `${joinNames(who)}, equally`;
  if (config.mode === "ratio") return who.map((p) => `${p} ${round2(config.ratios?.[p] ?? 0)}%`).join(" · ");
  const fixed = who.filter((p) => config.fixedAmounts?.[p] != null).map((p) => `${p} RM${(config.fixedAmounts?.[p] ?? 0).toFixed(2)}`);
  const rest = who.filter((p) => config.fixedAmounts?.[p] == null);
  return [...fixed, ...(rest.length ? [`${joinNames(rest)} the rest`] : [])].join(" · ");
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}
