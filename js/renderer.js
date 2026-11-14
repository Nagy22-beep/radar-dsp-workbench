/**
 * @file renderer.js
 * @description High-DPI HTML5 Canvas Oscilloscope & Physical Scene Rendering Engine.
 * Uses zero-reallocation buffer syncing for smooth 60 FPS scientific visualization.
 */

(function (global) {
  'use strict';

  /**
   * Synchronizes canvas backing store dimensions with CSS layout size & DevicePixelRatio
   * ONLY when dimensions actually change (prevents GPU memory thrashing at 60 FPS).
   */
  function prepareCanvas(canvas) {
    if (!canvas) return null;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const targetW = Math.max(1, Math.floor(rect.width * dpr));
    const targetH = Math.max(1, Math.floor(rect.height * dpr));

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, W: rect.width, H: rect.height };
  }

  /** Draws standard dark laboratory oscilloscope graticule grid */
  function drawOscilloscopeGrid(ctx, W, H, stepX, stepY) {
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(30, 41, 59, 0.65)';
    ctx.lineWidth = 1;
    const gx = stepX || 40;
    const gy = stepY || 32;

    ctx.beginPath();
    for (let x = 0; x < W; x += gx) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = 0; y < H; y += gy) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
  }

  /**
   * 1. Renders View 1: Synchronized f(t) and s(t) Chirp Scope
   */
  function renderFMScope(canvas, fmData, phaseOffset) {
    const surface = prepareCanvas(canvas);
    if (!surface) return;
    const { ctx, W, H } = surface;

    drawOscilloscopeGrid(ctx, W, H, 42, 34);
    const midY = H * 0.48;

    // Horizontal center divider
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.8)';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(W, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    const numCycles = 2.5;
    const topMargin = 26;
    const topPlotH = Math.max(20, midY - topMargin - 16);
    const visualDeviation = 2 + (fmData.bwMHz / 2000) * 12;

    // Trace 1: Instantaneous Frequency f(t)
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const normT = ((x / W) * numCycles + phaseOffset * 0.35) % 1;
      let modVal = 0;
      if (fmData.pattern === 'sawtooth') {
        modVal = normT;
      } else if (fmData.pattern === 'triangle') {
        modVal = normT < 0.5 ? normT * 2 : 2 - normT * 2;
      } else {
        modVal = 0.5 + 0.5 * Math.sin(2 * Math.PI * normT);
      }
      const y = (midY - 12) - modVal * topPlotH;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Trace 2: Time-Domain Chirp Signal s(t) = cos(integral of 2*pi*f(t) dt)
    const botCenterY = midY + (H - midY) * 0.53;
    const botAmp = (H - midY) * 0.36;
    let accumulatedPhase = 0;
    const dt = numCycles / Math.max(1, W);

    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const normT = ((x / W) * numCycles + phaseOffset * 0.35) % 1;
      let modVal = 0;
      if (fmData.pattern === 'sawtooth') {
        modVal = normT;
      } else if (fmData.pattern === 'triangle') {
        modVal = normT < 0.5 ? normT * 2 : 2 - normT * 2;
      } else {
        modVal = 0.5 + 0.5 * Math.sin(2 * Math.PI * normT);
      }
      const instFreq = fmData.fcScale + modVal * visualDeviation * 2.1;
      accumulatedPhase += 2 * Math.PI * instFreq * dt;
      const y = botCenterY - Math.cos(accumulatedPhase) * botAmp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Annotations
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('1) Instantaneous Frequency Law f(t) = f_c + S·t', 12, 18);
    ctx.fillStyle = '#34d399';
    ctx.fillText('2) Time-Domain RF Waveform s(t) = cos(∫ 2π·f(t) dt)', 12, midY + 18);
  }

  /**
   * 2. Renders View 2: Pulsed Radar Physical Scene & A-Scope Timing Diagram
   */
  function renderPulsedView(sceneCanvas, scopeCanvas, pData, pulseTimerUs) {
    // A) Physical Propagation Scene
    const sSurf = prepareCanvas(sceneCanvas);
    if (sSurf) {
      const { ctx, W, H } = sSurf;
      drawOscilloscopeGrid(ctx, W, H, 45, 32);

      const radarX = 55;
      const maxScaleKm = 30;
      const laneW = Math.max(50, W - 95);
      const targetX = radarX + (pData.rangeKm / maxScaleKm) * laneW;
      const blindPx = (pData.blindZoneKm / maxScaleKm) * laneW;
      const maxUnambigPx = Math.min(laneW, (pData.maxUnambiguousKm / maxScaleKm) * laneW);

      // Blind Zone Shaded Area
      ctx.fillStyle = 'rgba(244, 63, 94, 0.16)';
      ctx.fillRect(radarX, 16, blindPx, H - 46);
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.65)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(radarX + blindPx, 16);
      ctx.lineTo(radarX + blindPx, H - 30);
      ctx.stroke();
      ctx.setLineDash([]);

      // R_max Unambiguous Boundary
      if (pData.maxUnambiguousKm <= maxScaleKm) {
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)';
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(radarX + maxUnambigPx, 16);
        ctx.lineTo(radarX + maxUnambigPx, H - 30);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(`R_max (${pData.maxUnambiguousKm.toFixed(1)} km)`, radarX + maxUnambigPx - 48, 28);
      }

      // Range Axis Ruler
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(radarX, H - 30);
      ctx.lineTo(W - 25, H - 30);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      for (let km = 0; km <= maxScaleKm; km += 5) {
        const x = radarX + (km / maxScaleKm) * laneW;
        ctx.fillText(`${km}km`, x - 10, H - 12);
      }

      // Propagating Wave Packet
      const curT = pulseTimerUs % pData.priUs;
      const oneWayUs = pData.timeDelayUs / 2;
      const packetW = Math.max(12, blindPx * 0.65);

      if (curT <= oneWayUs) {
        const prog = curT / Math.max(0.001, oneWayUs);
        const px = radarX + prog * (targetX - radarX);
        ctx.fillStyle = 'rgba(6, 182, 212, 0.35)';
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2;
        ctx.fillRect(px - packetW / 2, H / 2 - 18, packetW, 24);
        ctx.strokeRect(px - packetW / 2, H / 2 - 18, packetW, 24);
      } else if (curT <= pData.timeDelayUs) {
        const prog = (curT - oneWayUs) / Math.max(0.001, oneWayUs);
        const px = targetX - prog * (targetX - radarX);
        ctx.fillStyle = 'rgba(244, 63, 94, 0.35)';
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2;
        ctx.fillRect(px - 8, H / 2 - 14, 16, 18);
        ctx.strokeRect(px - 8, H / 2 - 14, 16, 18);
      }

      // Radar Dish & Target Icons
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(radarX - 8, H / 2 - 6, 14, -Math.PI / 2.2, Math.PI / 2.2);
      ctx.stroke();

      ctx.fillStyle = pData.isInBlindZone ? '#f43f5e' : '#f59e0b';
      ctx.beginPath();
      ctx.arc(targetX, H / 2 - 6, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 10.5px monospace';
      ctx.fillText(`Target (${pData.rangeKm.toFixed(1)} km)`, Math.min(W - 95, targetX - 35), H / 2 - 20);
    }

    // B) A-Scope Timing Diagram
    const oSurf = prepareCanvas(scopeCanvas);
    if (oSurf) {
      const { ctx, W, H } = oSurf;
      drawOscilloscopeGrid(ctx, W, H, 42, 32);

      const maxTimeWinUs = Math.max(pData.priUs * 1.38, 180);
      const timeToX = (tUs) => 36 + (tUs / maxTimeWinUs) * (W - 56);
      const baseLineY = H - 32;

      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(26, baseLineY);
      ctx.lineTo(W - 16, baseLineY);
      ctx.stroke();

      // Draw TX Pulse #1 (t = 0) and TX Pulse #2 (t = PRI)
      [0, pData.priUs].forEach((startT, idx) => {
        const x1 = timeToX(startT);
        const x2 = timeToX(startT + pData.tauUs);
        const pw = Math.max(4, x2 - x1);

        ctx.fillStyle = 'rgba(6, 182, 212, 0.16)';
        ctx.fillRect(x1, 28, pw, baseLineY - 28);

        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(x1, baseLineY);
        ctx.lineTo(x1, 32);
        ctx.lineTo(x1 + pw, 32);
        ctx.lineTo(x1 + pw, baseLineY);
        ctx.stroke();

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(idx === 0 ? `TX #1 (τ=${pData.tauUs}µs)` : `TX #2 (PRI=${pData.priUs}µs)`, x1, 22);
      });

      // Draw Returning Target Echo at t = timeDelayUs
      const rxX1 = timeToX(pData.timeDelayUs);
      const rxX2 = timeToX(pData.timeDelayUs + pData.tauUs);
      const rxW = Math.max(4, rxX2 - rxX1);

      ctx.fillStyle = 'rgba(244, 63, 94, 0.26)';
      ctx.fillRect(rxX1, 68, rxW, baseLineY - 68);

      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(rxX1, baseLineY);
      ctx.lineTo(rxX1, 68);
      ctx.lineTo(rxX1 + rxW, 68);
      ctx.lineTo(rxX1 + rxW, baseLineY);
      ctx.stroke();

      ctx.fillStyle = '#fb7185';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`RX Echo (Δt=${pData.timeDelayUs.toFixed(1)}µs)`, Math.min(W - 135, Math.max(10, rxX1 - 8)), 58);
    }
  }

  /**
   * 3. Renders View 3: CW Doppler Time-Domain & Baseband FFT Spectrum
   */
  function renderCWView(timeCanvas, fftCanvas, cwData, animPhase) {
    // A) Time Domain Waveforms
    const tSurf = prepareCanvas(timeCanvas);
    if (tSurf) {
      const { ctx, W, H } = tSurf;
      drawOscilloscopeGrid(ctx, W, H, 42, 32);

      const fTxVis = 8;
      const dopplerVis = (cwData.velocityMps / 150) * 4.5;
      const fRxVis = fTxVis + dopplerVis;
      const phaseShiftVis = (cwData.distanceM / 50) * Math.PI;

      const topY = H * 0.31;
      const ampTop = H * 0.17;

      // TX Wave (Cyan)
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let x = 0; x < W; x++) {
        const t = x / W;
        const y = topY - Math.cos(2 * Math.PI * fTxVis * t - animPhase) * ampTop;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // RX Wave (Rose)
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let x = 0; x < W; x++) {
        const t = x / W;
        const y = topY - Math.cos(2 * Math.PI * fRxVis * t - animPhase + phaseShiftVis) * ampTop;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Bottom Track: Homodyne Mixer Beat Wave
      const botY = H * 0.76;
      const ampBot = H * 0.17;
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.3;
      ctx.beginPath();
      for (let x = 0; x < W; x++) {
        const t = x / W;
        const y = botY - Math.cos(2 * Math.PI * Math.abs(dopplerVis) * t - animPhase * 0.5 + phaseShiftVis) * ampBot;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.font = 'bold 10.5px monospace';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('TX Carrier (Cyan) & Doppler/Phase-Shifted RX Echo (Rose)', 12, 16);
      ctx.fillStyle = '#34d399';
      ctx.fillText(`Homodyne Mixer LPF Output: |f_RX - f_TX| = ${Math.abs(cwData.dopplerKHz).toFixed(2)} kHz`, 12, H * 0.55);
    }

    // B) Doppler FFT Spectrum
    const fSurf = prepareCanvas(fftCanvas);
    if (fSurf) {
      const { ctx, W, H } = fSurf;
      drawOscilloscopeGrid(ctx, W, H, 42, 32);

      const centerX = W / 2;
      const baseY = H - 28;

      // Zero Doppler Reference Line
      ctx.strokeStyle = '#475569';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(centerX, 14);
      ctx.lineTo(centerX, baseY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px monospace';
      ctx.fillText('f_c (v = 0)', centerX - 28, H - 10);
      ctx.fillText('+f_d (Approaching)', W - 115, H - 10);
      ctx.fillText('-f_d (Receding)', 14, H - 10);

      const peakX = centerX + (cwData.velocityMps / 150) * (W * 0.38);

      ctx.strokeStyle = '#a855f7';
      ctx.fillStyle = 'rgba(168, 85, 247, 0.25)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(20, baseY);
      for (let x = 20; x <= W - 20; x++) {
        const dist = Math.abs(x - peakX);
        const lobe = Math.exp(-(dist * dist) / 110) * (H - 58);
        const noise = 3 + Math.sin(x * 0.8 + animPhase) * 1.5;
        ctx.lineTo(x, baseY - Math.max(noise, lobe));
      }
      ctx.lineTo(W - 20, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#e9d5ff';
      ctx.font = 'bold 11px monospace';
      const signStr = cwData.dopplerKHz > 0 ? '+' : '';
      ctx.fillText(`f_d = ${signStr}${cwData.dopplerKHz.toFixed(2)} kHz`, Math.min(W - 125, Math.max(14, peakX - 42)), 24);
    }
  }

  /**
   * 4. Renders View 4: FMCW System Workbench (f-t De-chirp, IF Beat Signal, Range FFT)
   */
  function renderFMCWView(ftCanvas, ifCanvas, fftCanvas, fData, animPhase) {
    // A) Frequency vs Time (f-t Chirp Diagram)
    const ftSurf = prepareCanvas(ftCanvas);
    if (ftSurf) {
      const { ctx, W, H } = ftSurf;
      drawOscilloscopeGrid(ctx, W, H, 40, 28);

      const padX = 32;
      const padY = 22;
      const plotW = Math.max(60, W - padX * 2);
      const plotH = Math.max(30, H - padY * 2);

      const tau1ShiftX = (fData.range1 / 200) * (plotW * 0.22);
      const dopplerShiftY = (fData.vel1 / 100) * 14;

      const drawTrace = (offsetX, offsetY, color, isDashed) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        ctx.setLineDash(isDashed ? [6, 4] : []);
        ctx.beginPath();

        if (fData.chirpMode === 'sawtooth') {
          const sweepW = plotW / 2;
          for (let i = 0; i < 2; i++) {
            const x0 = padX + i * sweepW + offsetX;
            const x1 = x0 + sweepW * 0.88;
            ctx.moveTo(x0, H - padY - offsetY);
            ctx.lineTo(x1, padY - offsetY);
          }
        } else {
          const halfW = plotW * 0.46;
          const x0 = padX + offsetX;
          const xMid = padX + halfW + offsetX;
          const xEnd = padX + halfW * 2 + offsetX;
          ctx.moveTo(x0, H - padY - offsetY);
          ctx.lineTo(xMid, padY - offsetY);
          ctx.lineTo(xEnd, H - padY - offsetY);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      };

      // Draw TX Solid & Target 1 Delayed RX Dashed
      drawTrace(0, 0, '#06b6d4', false);
      drawTrace(tau1ShiftX, dopplerShiftY, '#f43f5e', true);

      if (fData.enableTarget2) {
        const tau2ShiftX = (fData.range2 / 200) * (plotW * 0.22);
        drawTrace(tau2ShiftX, 0, '#f59e0b', true);
      }

      // Legend & Beat annotation
      ctx.font = 'bold 10.5px monospace';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('━━ TX Chirp f_TX(t)', 12, 15);
      ctx.fillStyle = '#fb7185';
      ctx.fillText('╌╌ RX Target 1 (Delayed τ_1)', 145, 15);
      if (fData.enableTarget2) {
        ctx.fillStyle = '#fbbf24';
        ctx.fillText('╌╌ RX Target 2 (Delayed τ_2)', 335, 15);
      }

      ctx.fillStyle = '#34d399';
      if (fData.chirpMode === 'sawtooth') {
        ctx.fillText(`Sawtooth Beat: f_b,up = |f_r - f_d| = ${fData.fbUpKHz.toFixed(0)} kHz`, W - 295, H - 7);
      } else {
        ctx.fillText(`Triangular: f_up=${fData.fbUpKHz.toFixed(0)} kHz | f_dn=${fData.fbDownKHz.toFixed(0)} kHz`, W - 310, H - 7);
      }
    }

    // B) Mixer Output IF Beat Signal Time-Domain (with AWGN Noise)
    const ifSurf = prepareCanvas(ifCanvas);
    if (ifSurf) {
      const { ctx, W, H } = ifSurf;
      drawOscilloscopeGrid(ctx, W, H, 38, 28);

      const midY = H / 2;
      const amp = H * 0.34;
      const visF1 = 2 + (fData.range1 / 200) * 15;
      const visF2 = 2 + (fData.range2 / 200) * 15;
      const noiseStd = Math.pow(10, -fData.snrDb / 20) * 0.85;

      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      for (let x = 0; x < W; x++) {
        const t = x / W;
        let sample = Math.cos(2 * Math.PI * visF1 * t - animPhase);
        if (fData.enableTarget2) {
          sample = 0.55 * sample + 0.45 * Math.cos(2 * Math.PI * visF2 * t - animPhase * 0.8);
        }
        // Deterministic pseudo-random AWGN visualization
        const awgn = Math.sin(x * 13.7 + animPhase * 3.1) * noiseStd;
        const y = midY - (sample + awgn) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(
        fData.enableTarget2
          ? `s_IF(t) = cos(2π·f_b1·t) + cos(2π·f_b2·t) + n(t) [SNR=${fData.snrDb}dB]`
          : `s_IF(t) = cos(2π·f_b1·t) + n(t) [f_b1=${fData.fbUpKHz.toFixed(0)}kHz]`,
        10,
        15
      );
    }

    // C) Range Profile FFT Spectrum (with Windowing & Sidelobes)
    const fftSurf = prepareCanvas(fftCanvas);
    if (fftSurf) {
      const { ctx, W, H } = fftSurf;
      drawOscilloscopeGrid(ctx, W, H, 38, 28);

      const baseLineY = H - 24;
      const maxRangeM = 200;
      const rangeToX = (r) => 28 + (r / maxRangeM) * (W - 48);

      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(28, baseLineY);
      ctx.lineTo(W - 20, baseLineY);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '9.5px monospace';
      for (let r = 0; r <= maxRangeM; r += 40) {
        ctx.fillText(`${r}m`, rangeToX(r) - 10, H - 8);
      }

      const lobeWidthPx = Math.max(3.2, (fData.effectiveResM / maxRangeM) * (W - 48) * 0.85);
      const peak1X = rangeToX(fData.measuredRange1);
      const peak2X = rangeToX(fData.range2);
      const noiseFloorPx = Math.pow(10, -fData.snrDb / 28) * (H - 55) + 3;

      ctx.strokeStyle = '#a855f7';
      ctx.fillStyle = 'rgba(168, 85, 247, 0.25)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(28, baseLineY);

      for (let x = 28; x <= W - 20; x++) {
        const d1 = (x - peak1X) / lobeWidthPx;
        const main1 = Math.exp(-d1 * d1);
        const side1 = fData.sidelobeGain * Math.exp(-Math.abs(d1) * 0.45) * Math.abs(Math.sin(d1 * Math.PI));
        let mag = main1 + side1;

        if (fData.enableTarget2) {
          const d2 = (x - peak2X) / lobeWidthPx;
          const main2 = 0.85 * Math.exp(-d2 * d2);
          const side2 = 0.85 * fData.sidelobeGain * Math.exp(-Math.abs(d2) * 0.45) * Math.abs(Math.sin(d2 * Math.PI));
          mag += main2 + side2;
        }

        const envPx = Math.min(1.12, mag) * (H - 52);
        const thermalNoise = noiseFloorPx * (0.65 + 0.35 * Math.abs(Math.sin(x * 0.9 + animPhase)));
        const y = baseLineY - Math.max(thermalNoise, envPx);
        ctx.lineTo(x, y);
      }

      ctx.lineTo(W - 20, baseLineY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`T1: ${fData.measuredRange1.toFixed(1)}m`, Math.max(28, peak1X - 24), 16);
      if (fData.enableTarget2) {
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(`T2: ${fData.range2}m`, Math.min(W - 55, peak2X - 18), 28);
      }
    }
  }

  global.RadarRenderer = {
    renderFMScope,
    renderPulsedView,
    renderCWView,
    renderFMCWView
  };
})(window);