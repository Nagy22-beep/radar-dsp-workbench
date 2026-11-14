/**
 * @file physics.js
 * @description Pure Mathematical & Physical Engine for Radar Systems & DSP Workbench.
 * Implements validated closed-form equations for Linear FM, Pulsed ToF, CW Doppler, and FMCW Radar.
 */

(function (global) {
  'use strict';

  /** Speed of electromagnetic wave propagation in vacuum (m/s) */
  const SPEED_OF_LIGHT = 3.0e8;

  /**
   * Safely validates and clamps a numeric input within [min, max].
   * Prevents NaN, Infinity, or out-of-range injection.
   */
  function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, num));
  }

  /**
   * 1. Frequency Modulation & Chirp Synthesizer Calculations
   * @param {Object} params - { pattern, bwMHz, tcUs, fcScale }
   */
  function computeFM(params) {
    const bwMHz = clampNumber(params.bwMHz, 100, 2000, 500);
    const tcUs = clampNumber(params.tcUs, 10, 200, 50);
    const fcScale = clampNumber(params.fcScale, 2, 10, 4);
    const pattern = ['sawtooth', 'triangle', 'sine'].includes(params.pattern)
      ? params.pattern
      : 'sawtooth';

    // Chirp Slope S = B / Tc (MHz/us == THz/s)
    const slopeMHzPerUs = bwMHz / tcUs;

    // Theoretical Range Resolution dR = c / (2 * B) in centimeters
    const rangeResCm = (SPEED_OF_LIGHT / (2 * bwMHz * 1e6)) * 100;

    // Time-Bandwidth Product (Pulse Compression Ratio) TBP = B * Tc
    const timeBwProduct = Math.round(bwMHz * tcUs);

    return {
      pattern,
      bwMHz,
      tcUs,
      fcScale,
      slopeMHzPerUs,
      rangeResCm,
      timeBwProduct
    };
  }

  /**
   * 2. Pulsed Radar (Time-of-Flight, Blind Zone & Ambiguity) Calculations
   * @param {Object} params - { rangeKm, tauUs, priUs }
   */
  function computePulsed(params) {
    const rangeKm = clampNumber(params.rangeKm, 0.5, 28, 12);
    const tauUs = clampNumber(params.tauUs, 2, 40, 10);
    const priUs = clampNumber(params.priUs, 50, 200, 120);

    // Round-trip time-of-flight in microseconds: dt = 2R / c
    const timeDelayUs = ((2 * rangeKm * 1000) / SPEED_OF_LIGHT) * 1e6;

    // Near-field Blind Zone R_min = c * tau / 2 (km)
    const blindZoneKm = (SPEED_OF_LIGHT * (tauUs * 1e-6)) / 2 / 1000;

    // Maximum Unambiguous Range R_max = c * PRI / 2 (km)
    const maxUnambiguousKm = (SPEED_OF_LIGHT * (priUs * 1e-6)) / 2 / 1000;

    // Pulse Repetition Frequency (kHz) & Transmitter Duty Cycle (%)
    const prfKHz = 1000 / priUs;
    const dutyCyclePct = (tauUs / priUs) * 100;

    // Boundary Conditions
    const isInBlindZone = rangeKm <= blindZoneKm;
    const isAmbiguous = rangeKm > maxUnambiguousKm;

    // Folded apparent range measured by single-PRI timer
    const apparentDelayUs = timeDelayUs % priUs;
    const apparentRangeKm = ((apparentDelayUs * 1e-6) * SPEED_OF_LIGHT) / 2 / 1000;

    return {
      rangeKm,
      tauUs,
      priUs,
      timeDelayUs,
      blindZoneKm,
      maxUnambiguousKm,
      prfKHz,
      dutyCyclePct,
      isInBlindZone,
      isAmbiguous,
      apparentRangeKm
    };
  }

  /**
   * 3. Continuous-Wave (CW) Doppler Radar Calculations
   * @param {Object} params - { velocityMps, distanceM, fcGHz }
   */
  function computeCW(params) {
    const velocityMps = clampNumber(params.velocityMps, -140, 140, 60);
    const distanceM = clampNumber(params.distanceM, 10, 500, 120);
    const fcGHz = clampNumber(params.fcGHz, 10, 77, 24);

    // Wavelength lambda = c / fc (meters and millimeters)
    const lambdaM = SPEED_OF_LIGHT / (fcGHz * 1e9);
    const lambdaMm = lambdaM * 1000;

    // Doppler frequency shift fd = (2 * v * fc) / c (Hz and kHz)
    const dopplerHz = (2 * velocityMps * (fcGHz * 1e9)) / SPEED_OF_LIGHT;
    const dopplerKHz = dopplerHz / 1000;

    // Two-way phase shift phi_0 = (4 * pi * R / lambda) modulo 2*pi
    const rawPhaseRad = (4 * Math.PI * distanceM) / lambdaM;
    const phaseMod2Pi = ((rawPhaseRad % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

    const speedKmh = Math.abs(velocityMps) * 3.6;
    let motionDirection = 'Stationary';
    if (velocityMps > 0) motionDirection = 'Approaching';
    else if (velocityMps < 0) motionDirection = 'Receding';

    return {
      velocityMps,
      distanceM,
      fcGHz,
      lambdaMm,
      dopplerKHz,
      phaseMod2Pi,
      speedKmh,
      motionDirection
    };
  }

  /**
   * 4. FMCW System Workbench Calculations (De-chirp, Resolution, Windowing, Coupling)
   * @param {Object} params
   */
  function computeFMCW(params) {
    const chirpMode = params.chirpMode === 'triangle' ? 'triangle' : 'sawtooth';
    const range1 = clampNumber(params.range1, 10, 185, 85);
    const vel1 = clampNumber(params.vel1, -80, 80, 35);
    const enableTarget2 = Boolean(params.enableTarget2);
    const range2 = clampNumber(params.range2, 10, 185, 92);
    const bwMHz = clampNumber(params.bwMHz, 15, 600, 150);
    const tcUs = clampNumber(params.tcUs, 10, 100, 40);
    const fcGHz = clampNumber(params.fcGHz, 24, 77, 77);
    const windowType = ['rect', 'hann', 'hamming'].includes(params.windowType)
      ? params.windowType
      : 'hann';
    const snrDb = clampNumber(params.snrDb, 5, 40, 30);

    // 1. Chirp Slope S = B / Tc
    const slopeMHzPerUs = bwMHz / tcUs;
    const slopeHzPerSec = (bwMHz * 1e6) / (tcUs * 1e-6);

    // 2. Round-Trip Delays tau = 2R / c
    const tau1Sec = (2 * range1) / SPEED_OF_LIGHT;
    const tau1Ns = tau1Sec * 1e9;
    const tau2Sec = (2 * range2) / SPEED_OF_LIGHT;

    // 3. Pure Range Beat Frequencies fr = S * tau (kHz)
    const fr1KHz = (slopeHzPerSec * tau1Sec) / 1000;
    const fr2KHz = (slopeHzPerSec * tau2Sec) / 1000;

    // 4. Target 1 Doppler Shift fd = (2 * v1 * fc) / c (kHz)
    const fd1KHz = ((2 * vel1 * (fcGHz * 1e9)) / SPEED_OF_LIGHT) / 1000;

    // 5. Up-Chirp & Down-Chirp Beat Frequencies
    const fbUpKHz = Math.abs(fr1KHz - fd1KHz);
    const fbDownKHz = Math.abs(fr1KHz + fd1KHz);

    // 6. Range-Doppler Coupling Error in Sawtooth vs Exact Decoupling in Triangular Mode
    // In Sawtooth mode, radar assumes f_b,up is purely due to range:
    const sawtoothMeasuredR1 = ((fbUpKHz * 1000) * SPEED_OF_LIGHT * (tcUs * 1e-6)) / (2 * bwMHz * 1e6);
    const measuredRange1 = chirpMode === 'triangle' ? range1 : sawtoothMeasuredR1;

    // 7. Window Function Main-Lobe Broadening & Sidelobe Level
    let windowBroadening = 1.0;
    let sidelobeGain = 0.22; // Rectangular (-13 dB)
    if (windowType === 'hann') {
      windowBroadening = 1.44;
      sidelobeGain = 0.026; // Hann (-31.5 dB)
    } else if (windowType === 'hamming') {
      windowBroadening = 1.30;
      sidelobeGain = 0.018; // Hamming (-42 dB)
    }

    // 8. Effective Range Resolution dR = (c / 2B) * windowBroadening
    const fundamentalResM = SPEED_OF_LIGHT / (2 * bwMHz * 1e6);
    const effectiveResM = fundamentalResM * windowBroadening;
    const targetSeparationM = Math.abs(range2 - range1);
    const areTargetsResolved = !enableTarget2 || targetSeparationM >= effectiveResM;

    return {
      chirpMode,
      range1,
      vel1,
      enableTarget2,
      range2,
      bwMHz,
      tcUs,
      fcGHz,
      windowType,
      snrDb,
      slopeMHzPerUs,
      tau1Ns,
      fr1KHz,
      fr2KHz,
      fd1KHz,
      fbUpKHz,
      fbDownKHz,
      measuredRange1,
      fundamentalResM,
      effectiveResM,
      targetSeparationM,
      areTargetsResolved,
      windowBroadening,
      sidelobeGain
    };
  }

  // Expose pure calculation module to global namespace
  global.RadarPhysics = {
    SPEED_OF_LIGHT,
    clampNumber,
    computeFM,
    computePulsed,
    computeCW,
    computeFMCW
  };
})(window);