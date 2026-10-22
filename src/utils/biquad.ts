import type { FilterBand, FilterType } from '../types/eq';

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
}

/**
 * Robert Bristow-Johnson Audio EQ Cookbook biquad coefficient calculations.
 */
export function calcBiquadCoeffs(
  type: FilterType,
  freq: number,
  gainDb: number,
  q: number,
  sampleRate = 48000
): BiquadCoeffs {
  const f0 = Math.max(10, Math.min(freq, sampleRate / 2 - 100));
  const Q = Math.max(0.1, Math.min(q, 20.0));
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);

  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

  switch (type) {
    case 'PK': {
      // Peaking EQ
      b0 = 1 + alpha * A;
      b1 = -2 * cosw0;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosw0;
      a2 = 1 - alpha / A;
      break;
    }
    case 'LSC': {
      // Low Shelf with Q
      const sqrtA = Math.sqrt(A);
      const alphaShelf = (sinw0 / 2) * Math.sqrt((A + 1 / A) * (1 / Q - 1) + 2);
      b0 = A * (A + 1 - (A - 1) * cosw0 + 2 * sqrtA * alphaShelf);
      b1 = 2 * A * (A - 1 - (A + 1) * cosw0);
      b2 = A * (A + 1 - (A - 1) * cosw0 - 2 * sqrtA * alphaShelf);
      a0 = A + 1 + (A - 1) * cosw0 + 2 * sqrtA * alphaShelf;
      a1 = -2 * (A - 1 + (A + 1) * cosw0);
      a2 = A + 1 + (A - 1) * cosw0 - 2 * sqrtA * alphaShelf;
      break;
    }
    case 'HSC': {
      // High Shelf with Q
      const sqrtA = Math.sqrt(A);
      const alphaShelf = (sinw0 / 2) * Math.sqrt((A + 1 / A) * (1 / Q - 1) + 2);
      b0 = A * (A + 1 + (A - 1) * cosw0 + 2 * sqrtA * alphaShelf);
      b1 = -2 * A * (A - 1 + (A + 1) * cosw0);
      b2 = A * (A + 1 + (A - 1) * cosw0 - 2 * sqrtA * alphaShelf);
      a0 = A + 1 - (A - 1) * cosw0 + 2 * sqrtA * alphaShelf;
      a1 = 2 * (A - 1 - (A + 1) * cosw0);
      a2 = A + 1 - (A - 1) * cosw0 - 2 * sqrtA * alphaShelf;
      break;
    }
  }

  return { b0, b1, b2, a0, a1, a2 };
}

/**
 * Evaluates the frequency response magnitude in dB for a biquad filter.
 */
export function evaluateBiquadMagnitudeDb(
  coeffs: BiquadCoeffs,
  freq: number,
  sampleRate = 48000
): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cosw = Math.cos(w);
  const sinw = Math.sin(w);
  const cos2w = Math.cos(2 * w);
  const sin2w = Math.sin(2 * w);

  const numRe = coeffs.b0 + coeffs.b1 * cosw + coeffs.b2 * cos2w;
  const numIm = -coeffs.b1 * sinw - coeffs.b2 * sin2w;

  const denRe = coeffs.a0 + coeffs.a1 * cosw + coeffs.a2 * cos2w;
  const denIm = -coeffs.a1 * sinw - coeffs.a2 * sin2w;

  const numMagSq = numRe * numRe + numIm * numIm;
  const denMagSq = denRe * denRe + denIm * denIm;

  if (denMagSq === 0) return 0;
  const magSq = numMagSq / denMagSq;
  if (magSq <= 0) return -100;

  return 10 * Math.log10(magSq);
}

export function generateLogFrequencies(count = 300, minFreq = 20, maxFreq = 20000): number[] {
  const minLog = Math.log10(minFreq);
  const maxLog = Math.log10(maxFreq);
  const freqs: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    freqs[i] = Math.pow(10, minLog + t * (maxLog - minLog));
  }
  return freqs;
}

export const DEFAULT_EVAL_FREQS = generateLogFrequencies(300);

export interface FastCurveResult {
  freqs: number[];
  totalCurve: number[];
  filterCurves: number[][];
  recommendedPreamp: number;
}

export function computeFastCurves(
  filters: FilterBand[],
  freqs: number[] = DEFAULT_EVAL_FREQS,
  sampleRate = 48000
): FastCurveResult {
  const activeCoeffs = filters.map((f) =>
    f.enabled ? calcBiquadCoeffs(f.filter_type, f.freq, f.gain, f.q, sampleRate) : null
  );

  const numFreqs = freqs.length;
  const numFilters = filters.length;
  const totalCurve: number[] = new Array(numFreqs);
  const filterCurves: number[][] = Array.from({ length: numFilters }, () => new Array(numFreqs));
  let maxBoost = 0;

  for (let fi = 0; fi < numFreqs; fi++) {
    const freq = freqs[fi];
    let total = 0;
    for (let bi = 0; bi < numFilters; bi++) {
      const coeffs = activeCoeffs[bi];
      const db = coeffs ? evaluateBiquadMagnitudeDb(coeffs, freq, sampleRate) : 0;
      filterCurves[bi][fi] = db;
      total += db;
    }
    totalCurve[fi] = total;
    if (total > maxBoost) {
      maxBoost = total;
    }
  }

  const recommendedPreamp = maxBoost > 0 ? -maxBoost : 0;
  return { freqs, totalCurve, filterCurves, recommendedPreamp };
}

/**
 * Calculates the total composite frequency response in dB for a set of filters + preamp.
 */
export function calcCompositeResponse(
  filters: FilterBand[],
  preampDb: number,
  freqs: number[],
  sampleRate = 48000
): number[] {
  const activeCoeffs = filters
    .filter((f) => f.enabled)
    .map((f) => calcBiquadCoeffs(f.filter_type, f.freq, f.gain, f.q, sampleRate));

  return freqs.map((f) => {
    let total = preampDb;
    for (const c of activeCoeffs) {
      total += evaluateBiquadMagnitudeDb(c, f, sampleRate);
    }
    return total;
  });
}

/**
 * Coordinate conversions: logarithmic frequency (20Hz - 20kHz) <-> canvas X
 */
export const MIN_FREQ = 20;
export const MAX_FREQ = 20000;
export const MIN_GAIN = -20;
export const MAX_GAIN = 20;

export function freqToX(freq: number, width: number, paddingLeft = 50, paddingRight = 20): number {
  const graphWidth = width - paddingLeft - paddingRight;
  const clamped = Math.max(MIN_FREQ, Math.min(MAX_FREQ, freq));
  const logMin = Math.log10(MIN_FREQ);
  const logMax = Math.log10(MAX_FREQ);
  const norm = (Math.log10(clamped) - logMin) / (logMax - logMin);
  return paddingLeft + norm * graphWidth;
}

export function xToFreq(x: number, width: number, paddingLeft = 50, paddingRight = 20): number {
  const graphWidth = width - paddingLeft - paddingRight;
  const norm = Math.max(0, Math.min(1, (x - paddingLeft) / graphWidth));
  const logMin = Math.log10(MIN_FREQ);
  const logMax = Math.log10(MAX_FREQ);
  return Math.pow(10, logMin + norm * (logMax - logMin));
}

export function gainToY(
  gain: number,
  height: number,
  paddingTop = 20,
  paddingBottom = 30,
  minGain = MIN_GAIN,
  maxGain = MAX_GAIN
): number {
  const graphHeight = height - paddingTop - paddingBottom;
  const clamped = Math.max(minGain, Math.min(maxGain, gain));
  const norm = (clamped - minGain) / (maxGain - minGain);
  // Y is inverted: max gain (+20dB) is top (paddingTop)
  return paddingTop + (1 - norm) * graphHeight;
}

export function yToGain(
  y: number,
  height: number,
  paddingTop = 20,
  paddingBottom = 30,
  minGain = MIN_GAIN,
  maxGain = MAX_GAIN
): number {
  const graphHeight = height - paddingTop - paddingBottom;
  const norm = 1 - (y - paddingTop) / graphHeight;
  const clampedNorm = Math.max(0, Math.min(1, norm));
  return minGain + clampedNorm * (maxGain - minGain);
}

export function getGainTicks(maxGain: number): number[] {
  let step = 5;
  if (maxGain <= 4) step = 1;
  else if (maxGain <= 8) step = 2;
  else if (maxGain <= 15) step = 3;
  else if (maxGain <= 20) step = 5;
  else step = 10;

  const ticks: number[] = [];
  for (let g = maxGain; g >= -maxGain; g -= step) {
    ticks.push(g);
  }
  if (!ticks.includes(-maxGain)) {
    ticks.push(-maxGain);
  }
  return ticks;
}

/**
 * Standard frequency grid ticks for plotting.
 */
export const FREQ_TICKS = [
  20, 30, 40, 50, 60, 70, 80, 100,
  200, 300, 400, 500, 600, 800, 1000,
  2000, 3000, 4000, 5000, 6000, 8000, 10000,
  20000,
];

export const GAIN_TICKS = [20, 15, 10, 5, 0, -5, -10, -15, -20];

export function formatFreq(f: number): string {
  if (f >= 1000) {
    const k = f / 1000;
    return k >= 10 ? `${k.toFixed(0)}k` : `${k.toFixed(1)}k`;
  }
  return `${Math.round(f)}`;
}

export function formatFreqFull(f: number): string {
  if (f >= 1000) {
    return `${(f / 1000).toFixed(2)} kHz`;
  }
  return `${Math.round(f)} Hz`;
}
