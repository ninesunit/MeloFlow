/**
 * Appliance-based consumption estimates for the bill estimator.
 */
import { round2 } from "./money";
import type { Appliance } from "./types";

/** Days used to turn daily usage into a monthly figure. */
export const DAYS_PER_MONTH = 30;
export const WEEKS_PER_MONTH = 52 / 12;

/**
 * Rough electrical input power per horsepower for a split-unit air-conditioner.
 * Real units vary (inverter models draw less once the room is cool), which is
 * what the duty cycle accounts for.
 */
export const AIRCON_WATTS_PER_HP = 850;

export function airconWatts(horsepower: number): number {
  return Math.round(Math.max(0, horsepower) * AIRCON_WATTS_PER_HP);
}

/** Effective wattage: the rating if given, otherwise derived from horsepower. */
export function effectiveWatts(a: Pick<Appliance, "powerRatingWatts" | "horsepower">): number {
  if (a.powerRatingWatts && a.powerRatingWatts > 0) return a.powerRatingWatts;
  if (a.horsepower && a.horsepower > 0) return airconWatts(a.horsepower);
  return 0;
}

export function monthlyKwh(a: Appliance): number {
  if (a.type !== "Electrical") return 0;
  const watts = effectiveWatts(a);
  const duty = Math.min(100, Math.max(0, a.dutyCyclePercent ?? 100)) / 100;
  const qty = Math.max(0, a.quantity ?? 1);
  return round2((watts * qty * Math.max(0, a.estimatedDailyHours) * duty * DAYS_PER_MONTH) / 1000);
}

export function monthlyWaterM3(a: Appliance): number {
  if (a.type !== "Water") return 0;
  const qty = Math.max(0, a.quantity ?? 1);
  return round2(Math.max(0, a.waterVolumeCubicMeters) * Math.max(0, a.usesPerWeek) * qty * WEEKS_PER_MONTH);
}

export function totals(appliances: Appliance[]): { kwh: number; m3: number } {
  let kwh = 0;
  let m3 = 0;
  for (const a of appliances) {
    kwh += monthlyKwh(a);
    m3 += monthlyWaterM3(a);
  }
  return { kwh: round2(kwh), m3: round2(m3) };
}

type Preset = Omit<Appliance, "id">;

function electrical(name: string, watts: number, hours: number, duty = 100, extra: Partial<Preset> = {}): Preset {
  return {
    name,
    type: "Electrical",
    quantity: 1,
    powerRatingWatts: watts,
    estimatedDailyHours: hours,
    dutyCyclePercent: duty,
    horsepower: null,
    waterVolumeCubicMeters: 0,
    usesPerWeek: 0,
    ...extra,
  };
}

function water(name: string, litresPerUse: number, usesPerWeek: number): Preset {
  return {
    name,
    type: "Water",
    quantity: 1,
    powerRatingWatts: 0,
    estimatedDailyHours: 0,
    dutyCyclePercent: 100,
    horsepower: null,
    waterVolumeCubicMeters: litresPerUse / 1000,
    usesPerWeek,
  };
}

/** Typical starting values; edit them to match your own appliances. */
export const APPLIANCE_PRESETS: Preset[] = [
  electrical("Air-conditioner 1.0 HP", 0, 8, 70, { horsepower: 1 }),
  electrical("Air-conditioner 1.5 HP", 0, 8, 70, { horsepower: 1.5 }),
  electrical("Refrigerator", 150, 24, 40),
  electrical("Ceiling fan", 75, 10),
  electrical("LED lights (each)", 10, 6),
  electrical("Water heater", 3000, 0.5),
  electrical("Washing machine", 500, 1),
  electrical("Rice cooker", 700, 0.75),
  electrical("Electric kettle", 2200, 0.2),
  electrical("Microwave", 1000, 0.25),
  electrical("Television", 100, 4),
  electrical("Laptop / charger", 65, 6),
  electrical("Clothes iron", 1000, 0.3),
  electrical("Wi-Fi router", 12, 24),
  water("Shower (8 min)", 72, 14),
  water("Washing machine load", 80, 4),
  water("Toilet flush", 6, 35),
  water("Washing dishes by hand", 40, 7),
  water("Cooking & drinking", 10, 7),
];
