/**
 * Malaysian utility tariff calculators used by the bill estimator.
 *
 * Electricity: TNB domestic tariff for Peninsular Malaysia from 1 July 2025.
 * Water: Air Selangor domestic tariff from 1 September 2025.
 * Rates change from time to time — edit the constants below if they do.
 * Results are estimates; the real bill also depends on billing-day counts,
 * rounding rules and any government rebates in force.
 */
import { round2 } from "./money";
import type { TariffSettings } from "./types";

export const TNB = {
  /** Energy (generation) charge, sen/kWh, by monthly usage band. */
  energyTiers: [
    { upTo: 1500, sen: 27.03 },
    { upTo: Infinity, sen: 37.03 },
  ],
  capacitySen: 4.55,
  networkSen: 12.85,
  /** RM per month, waived at or below the threshold. */
  retailChargeRM: 10,
  retailWaivedUpToKwh: 600,
  /** Energy Efficiency Incentive rebate (sen/kWh) by total monthly usage, for usage up to 1,000 kWh. */
  eeiBands: [
    { upTo: 200, sen: 25.0 },
    { upTo: 250, sen: 24.5 },
    { upTo: 300, sen: 22.5 },
    { upTo: 350, sen: 21.0 },
    { upTo: 400, sen: 17.0 },
    { upTo: 450, sen: 14.5 },
    { upTo: 500, sen: 12.0 },
    { upTo: 550, sen: 10.5 },
    { upTo: 600, sen: 9.0 },
    { upTo: 650, sen: 7.5 },
    { upTo: 700, sen: 5.5 },
    { upTo: 750, sen: 4.5 },
    { upTo: 800, sen: 4.0 },
    { upTo: 850, sen: 2.5 },
    { upTo: 900, sen: 1.0 },
    { upTo: 1000, sen: 0.5 },
  ],
  /** Renewable energy fund (KWTBB), % of the bill, for usage above the threshold. */
  kwtbbPercent: 1.6,
  kwtbbAboveKwh: 300,
  /** Service tax on the portion of usage above the threshold. */
  sstPercent: 8,
  sstAboveKwh: 600,
};

export const AIR_SELANGOR = {
  /** Domestic blocks in RM per m³. */
  blocks: [
    { upTo: 20, rm: 0.65 },
    { upTo: 35, rm: 1.62 },
    { upTo: Infinity, rm: 3.51 },
  ],
  minimumChargeRM: 6.5,
};

export interface ElectricityBreakdown {
  kwh: number;
  energy: number;
  capacity: number;
  network: number;
  retail: number;
  afa: number;
  eei: number;
  kwtbb: number;
  sst: number;
  total: number;
  lines: { label: string; amount: number }[];
}

/** Estimated monthly TNB bill for a domestic account. */
export function electricityCost(kwhInput: number, settings: TariffSettings): ElectricityBreakdown {
  const kwh = Math.max(0, kwhInput);

  let energySen = 0;
  let prev = 0;
  for (const tier of TNB.energyTiers) {
    if (kwh <= prev) break;
    const units = Math.min(kwh, tier.upTo) - prev;
    energySen += units * tier.sen;
    prev = tier.upTo;
  }
  const energy = energySen / 100;
  const capacity = (kwh * TNB.capacitySen) / 100;
  const network = (kwh * TNB.networkSen) / 100;
  const retail = kwh > TNB.retailWaivedUpToKwh ? TNB.retailChargeRM : 0;
  const afa = (kwh * (settings.afaSenPerKwh || 0)) / 100;

  let eei = 0;
  if (settings.includeEei && kwh > 0) {
    const band = TNB.eeiBands.find((b) => kwh <= b.upTo);
    if (band) eei = -(kwh * band.sen) / 100;
  }

  const subtotal = energy + capacity + network + retail + afa + eei;

  // Service tax applies only to the share of the bill for usage above 600 kWh.
  let sst = 0;
  if (settings.includeSst && kwh > TNB.sstAboveKwh) {
    const taxableShare = (kwh - TNB.sstAboveKwh) / kwh;
    sst = Math.max(0, subtotal * taxableShare * (TNB.sstPercent / 100));
  }

  let kwtbb = 0;
  if (settings.includeKwtbb && kwh > TNB.kwtbbAboveKwh) {
    kwtbb = Math.max(0, subtotal * (TNB.kwtbbPercent / 100));
  }

  const total = Math.max(0, subtotal + sst + kwtbb);
  const lines = [
    { label: "Energy charge", amount: round2(energy) },
    { label: "Capacity charge", amount: round2(capacity) },
    { label: "Network charge", amount: round2(network) },
    { label: "Retail charge", amount: round2(retail) },
    { label: `Fuel adjustment (AFA ${settings.afaSenPerKwh || 0} sen/kWh)`, amount: round2(afa) },
    { label: "Energy efficiency rebate", amount: round2(eei) },
    { label: "Service tax (above 600 kWh)", amount: round2(sst) },
    { label: "KWTBB 1.6%", amount: round2(kwtbb) },
  ];
  return {
    kwh,
    energy: round2(energy),
    capacity: round2(capacity),
    network: round2(network),
    retail: round2(retail),
    afa: round2(afa),
    eei: round2(eei),
    kwtbb: round2(kwtbb),
    sst: round2(sst),
    total: round2(total),
    lines,
  };
}

export interface WaterBreakdown {
  m3: number;
  total: number;
  lines: { label: string; amount: number }[];
}

/** Estimated monthly Air Selangor bill for a domestic account. */
export function waterCost(m3Input: number): WaterBreakdown {
  const m3 = Math.max(0, m3Input);
  const lines: { label: string; amount: number }[] = [];
  let total = 0;
  let prev = 0;
  for (const block of AIR_SELANGOR.blocks) {
    if (m3 <= prev) break;
    const units = Math.min(m3, block.upTo) - prev;
    const amount = units * block.rm;
    total += amount;
    const range = block.upTo === Infinity ? `above ${prev} m³` : `${prev}–${block.upTo} m³`;
    lines.push({ label: `${round2(units)} m³ × RM${block.rm.toFixed(2)} (${range})`, amount: round2(amount) });
    prev = block.upTo;
  }
  if (total < AIR_SELANGOR.minimumChargeRM) {
    lines.push({ label: "Topped up to minimum charge", amount: round2(AIR_SELANGOR.minimumChargeRM - total) });
    total = AIR_SELANGOR.minimumChargeRM;
  }
  return { m3, total: round2(total), lines };
}
