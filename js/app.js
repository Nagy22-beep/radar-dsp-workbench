/**
 * @file app.js
 * @description Main Application Controller, State Store, Tab Router & Event Binder.
 * Enforces strict XSS-safe DOM updates and preserves simulation state across views.
 */

(function () {
  'use strict';

  const Physics = window.RadarPhysics;
  const Renderer = window.RadarRenderer;

  /** Hardware Block Inspector Dictionary for View 4 */
  const ARCH_BLOCKS = {
    synth: {
      title: 'PLL / VCO Linear Chirp Synthesizer:',
      desc: 'Generates a continuous electromagnetic carrier whose instantaneous frequency sweeps linearly across bandwidth B over duration T_c.',
      formula: 'f_TX(t) = f_c + (B / T_c)·t'
    },
    ant: {
      title: 'TX/RX Apertures & Two-Way Propagation Channel:',
      desc: 'Radiates the chirp at c = 3×10⁸ m/s; target reflection returns attenuated with round-trip delay τ = 2R/c and Doppler shift f_d.',
      formula: 'τ = 2R / c , f_d = 2·v·f_c / c'
    },
    mixer: {
      title: 'RF Homodyne Mixer (De-chirping Stage):',
      desc: 'Multiplies instantaneous TX chirp with delayed RX echo to extract the low-frequency IF beat signal.',
      formula: 'f_IF = f_TX(t) - f_RX(t) = S·τ ∓ f_d'
    },
    lpf: {
      title: 'Anti-Aliasing Low-Pass Filter & Baseband ADC:',
      desc: 'Rejects the sum-frequency component (2·f_c ≈ 154 GHz) and digitizes the MHz/kHz beat tone using a low-cost Nyquist ADC.',
      formula: 's_IF(t) = ½ cos(2π·f_b·t + Δφ)'
    },
    fft: {
      title: 'Windowed Range & Doppler Fast Fourier Transform (FFT):',
      desc: 'Applies a spectral window (Hann/Hamming) and resolves beat frequencies into discrete target range bins with resolution ΔR = c / 2B.',
      formula: 'R = (c · T_c · f_r) / (2 · B)'
    }
  };

  /** Tab Titles for Footer Status Bar */
  const TAB_TITLES = {
    fm: '01. FM & Chirp Synthesizer',
    pulsed: '02. Pulsed Radar (ToF)',
    cw: '03. CW Doppler Radar',
    fmcw: '04. FMCW System Workbench',
    compare: '05. Architecture Comparison & Math'
  };

  /** Default Engineering State */
  function createDefaultState() {
    return {
      activeTab: 'fmcw',
      isRunning: true,
      animPhase: 0,
      pulseTimerUs: 0,
      fm: {
        pattern: 'sawtooth',
        bwMHz: 500,
        tcUs: 50,
        fcScale: 4
      },
      pulsed: {
        rangeKm: 12.0,
        tauUs: 10,
        priUs: 120
      },
      cw: {
        velocityMps: 60,
        distanceM: 120,
        fcGHz: 24
      },
      fmcw: {
        selectedBlock: 'mixer',
        chirpMode: 'sawtooth',
        range1: 85,
        vel1: 35,
        enableTarget2: true,
        range2: 92,
        bwMHz: 150,
        tcUs: 40,
        fcGHz: 77,
        windowType: 'hann',
        snrDb: 30
      }
    };
  }

  let state = createDefaultState();

  /** Safe DOM text setter (prevents XSS) */
  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  /** Updates all DOM readouts, badges, and warning states from current state */
  function updateUIReadouts() {
    // 1. FM Tab Readouts
    const fmOut = Physics.computeFM(state.fm);
    setText('fm-bw-val', `${fmOut.bwMHz} MHz`);
    setText('fm-tc-val', `${fmOut.tcUs} µs`);
    setText('fm-fc-val', `${fmOut.fcScale}x`);
    setText('fm-metric-slope', fmOut.slopeMHzPerUs.toFixed(2));
    setText('fm-metric-res', fmOut.rangeResCm.toFixed(1));
    setText('fm-metric-tbp', fmOut.timeBwProduct);
    setText('fm-scope-badge', `Slope S = ${fmOut.slopeMHzPerUs.toFixed(2)} MHz/µs`);

    // 2. Pulsed Radar Readouts
    const pOut = Physics.computePulsed(state.pulsed);
    setText('pulsed-range-val', `${pOut.rangeKm.toFixed(1)} km`);
    setText('pulsed-tau-val', `${pOut.tauUs} µs`);
    setText('pulsed-pri-val', `${pOut.priUs} µs (${pOut.prfKHz.toFixed(2)} kHz)`);
    setText('pulsed-metric-delay', pOut.timeDelayUs.toFixed(1));
    setText('pulsed-metric-rmin', pOut.blindZoneKm.toFixed(2));
    setText('pulsed-metric-rmax', pOut.maxUnambiguousKm.toFixed(1));
    setText('pulsed-metric-duty', `Duty: ${pOut.dutyCyclePct.toFixed(1)}%`);
    setText('pulsed-scene-badge', `R = ${pOut.rangeKm.toFixed(1)} km`);
    setText('pulsed-scope-badge', `Δt = ${pOut.timeDelayUs.toFixed(1)} µs`);

    const rminCard = document.getElementById('card-pulsed-rmin');
    const rmaxCard = document.getElementById('card-pulsed-rmax');
    const alertBox = document.getElementById('pulsed-alert-box');

    if (rminCard) rminCard.classList.toggle('alert-pulse', pOut.isInBlindZone);
    if (rmaxCard) rmaxCard.classList.toggle('alert-pulse', pOut.isAmbiguous);

    if (pOut.isInBlindZone) {
      setText('pulsed-metric-rmeas', 'BLIND');
      setText('pulsed-metric-rmeas-unit', '');
      if (alertBox) alertBox.classList.remove('hidden');
      setText(
        'pulsed-alert-text',
        `BLIND ZONE ALERT: Target range (${pOut.rangeKm.toFixed(1)} km) is inside R_min (${pOut.blindZoneKm.toFixed(2)} km). Echo arrives while transmitter is still firing!`
      );
    } else if (pOut.isAmbiguous) {
      setText('pulsed-metric-rmeas', pOut.apparentRangeKm.toFixed(2));
      setText('pulsed-metric-rmeas-unit', 'km (Folded)');
      if (alertBox) alertBox.classList.remove('hidden');
      setText(
        'pulsed-alert-text',
        `RANGE AMBIGUITY ALERT: Echo delay (${pOut.timeDelayUs.toFixed(1)} µs) exceeds PRI (${pOut.priUs} µs). Radar aliases target to ${pOut.apparentRangeKm.toFixed(2)} km!`
      );
    } else {
      setText('pulsed-metric-rmeas', pOut.apparentRangeKm.toFixed(2));
      setText('pulsed-metric-rmeas-unit', 'km');
      if (alertBox) alertBox.classList.add('hidden');
    }

    // 3. CW Doppler Readouts
    const cwOut = Physics.computeCW(state.cw);
    const vSign = cwOut.velocityMps > 0 ? '+' : '';
    const fdSign = cwOut.dopplerKHz > 0 ? '+' : '';
    setText('cw-vel-val', `${vSign}${cwOut.velocityMps} m/s (${cwOut.speedKmh.toFixed(0)} km/h)`);
    setText('cw-dist-val', `${cwOut.distanceM} m`);
    setText('cw-fc-val', `${cwOut.fcGHz} GHz`);
    setText('cw-metric-fd', `${fdSign}${cwOut.dopplerKHz.toFixed(2)}`);
    setText('cw-metric-lambda', cwOut.lambdaMm.toFixed(2));
    setText('cw-metric-phase', cwOut.phaseMod2Pi.toFixed(2));
    setText('cw-metric-dir', cwOut.motionDirection);
    setText('cw-time-badge', `v = ${vSign}${cwOut.velocityMps} m/s`);
    setText('cw-fft-badge', `f_d = ${fdSign}${cwOut.dopplerKHz.toFixed(2)} kHz`);

    // 4. FMCW System Workbench Readouts
    const fmcwOut = Physics.computeFMCW(state.fmcw);
    const v1Sign = fmcwOut.vel1 > 0 ? '+' : '';
    const fd1Sign = fmcwOut.fd1KHz > 0 ? '+' : '';

    setText('fmcw-r1-val', `${fmcwOut.range1} m`);
    setText('fmcw-v1-val', `${v1Sign}${fmcwOut.vel1} m/s`);
    setText('fmcw-r2-val', `${fmcwOut.range2} m (Δd = ${fmcwOut.targetSeparationM.toFixed(1)} m)`);
    setText('fmcw-bw-val', `${fmcwOut.bwMHz} MHz`);
    setText('fmcw-tc-val', `${fmcwOut.tcUs} µs`);
    setText('fmcw-snr-val', `${fmcwOut.snrDb} dB`);

    setText('fmcw-metric-slope', fmcwOut.slopeMHzPerUs.toFixed(2));
    setText('fmcw-metric-tau', fmcwOut.tau1Ns.toFixed(0));
    setText('fmcw-metric-fb', fmcwOut.fbUpKHz.toFixed(0));
    setText('fmcw-metric-dr', fmcwOut.effectiveResM.toFixed(2));
    setText('fmcw-metric-rmeas', fmcwOut.measuredRange1.toFixed(2));
    setText('fmcw-metric-fd', `${fd1Sign}${fmcwOut.fd1KHz.toFixed(1)}`);

    setText('fmcw-ft-badge', `f_b,up = ${fmcwOut.fbUpKHz.toFixed(0)} kHz`);
    setText('fmcw-fft-badge', `ΔR = ${fmcwOut.effectiveResM.toFixed(2)} m`);

    // Architecture Block Inspector
    const blk = ARCH_BLOCKS[state.fmcw.selectedBlock] || ARCH_BLOCKS.mixer;
    setText('fmcw-blk-title', blk.title);
    setText('fmcw-blk-desc', blk.desc);
    setText('fmcw-blk-formula', blk.formula);

    // Target Lane Pins & Resolution Pill
    const pin1 = document.getElementById('fmcw-marker-t1');
    const pin2 = document.getElementById('fmcw-marker-t2');
    if (pin1) pin1.style.left = `${12 + (fmcwOut.range1 / 200) * 82}%`;
    setText('fmcw-marker-t1-label', `T1: ${fmcwOut.range1}m`);

    if (pin2) {
      pin2.style.display = fmcwOut.enableTarget2 ? 'flex' : 'none';
      pin2.style.left = `${12 + (fmcwOut.range2 / 200) * 82}%`;
    }
    setText('fmcw-marker-t2-label', `T2: ${fmcwOut.range2}m`);

    const resStatus = document.getElementById('fmcw-res-status');
    const drCard = document.getElementById('card-fmcw-dr');
    if (drCard) drCard.classList.toggle('alert-pulse', !fmcwOut.areTargetsResolved);

    if (resStatus) {
      if (!fmcwOut.enableTarget2) {
        resStatus.className = 'res-pill res-ok';
        resStatus.textContent = 'Single Target Tracking Mode';
      } else if (fmcwOut.areTargetsResolved) {
        resStatus.className = 'res-pill res-ok';
        resStatus.textContent = `✓ Targets Resolved (Δd = ${fmcwOut.targetSeparationM.toFixed(1)}m ≥ ΔR = ${fmcwOut.effectiveResM.toFixed(2)}m)`;
      } else {
        resStatus.className = 'res-pill res-warn';
        resStatus.textContent = `⚠ Targets Merged in FFT! (Δd = ${fmcwOut.targetSeparationM.toFixed(1)}m < ΔR = ${fmcwOut.effectiveResM.toFixed(2)}m — Increase B!)`;
      }
    }
  }

  /** Synchronizes HTML form input values with state object (used on init & reset) */
  function syncInputsFromState() {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = String(val);
    };

    setVal('fm-bw', state.fm.bwMHz);
    setVal('fm-tc', state.fm.tcUs);
    setVal('fm-fc', state.fm.fcScale);

    setVal('pulsed-range', state.pulsed.rangeKm);
    setVal('pulsed-tau', state.pulsed.tauUs);
    setVal('pulsed-pri', state.pulsed.priUs);

    setVal('cw-vel', state.cw.velocityMps);
    setVal('cw-dist', state.cw.distanceM);
    setVal('cw-fc', state.cw.fcGHz);

    setVal('fmcw-r1', state.fmcw.range1);
    setVal('fmcw-v1', state.fmcw.vel1);
    setVal('fmcw-r2', state.fmcw.range2);
    setVal('fmcw-bw', state.fmcw.bwMHz);
    setVal('fmcw-tc', state.fmcw.tcUs);
    setVal('fmcw-window', state.fmcw.windowType);
    setVal('fmcw-snr', state.fmcw.snrDb);

    const t2Check = document.getElementById('fmcw-t2-enable');
    if (t2Check) t2Check.checked = state.fmcw.enableTarget2;

    document.querySelectorAll('.fm-pattern-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.pattern === state.fm.pattern);
    });
    document.querySelectorAll('.fmcw-mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === state.fmcw.chirpMode);
    });
    document.querySelectorAll('.fmcw-block-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.block === state.fmcw.selectedBlock);
    });
  }

  /** Renders only the currently active tab canvases */
  function renderActiveView() {
    if (state.activeTab === 'fm') {
      Renderer.renderFMScope(
        document.getElementById('canvas-fm-scope'),
        Physics.computeFM(state.fm),
        state.animPhase
      );
    } else if (state.activeTab === 'pulsed') {
      Renderer.renderPulsedView(
        document.getElementById('canvas-pulsed-scene'),
        document.getElementById('canvas-pulsed-scope'),
        Physics.computePulsed(state.pulsed),
        state.pulseTimerUs
      );
    } else if (state.activeTab === 'cw') {
      Renderer.renderCWView(
        document.getElementById('canvas-cw-time'),
        document.getElementById('canvas-cw-fft'),
        Physics.computeCW(state.cw),
        state.animPhase
      );
    } else if (state.activeTab === 'fmcw') {
      Renderer.renderFMCWView(
        document.getElementById('canvas-fmcw-ft'),
        document.getElementById('canvas-fmcw-if'),
        document.getElementById('canvas-fmcw-fft'),
        Physics.computeFMCW(state.fmcw),
        state.animPhase
      );
    }
  }

  /** Master 60 FPS Animation Loop */
  function tick() {
    if (state.isRunning) {
      state.animPhase += 0.035;
      state.pulseTimerUs = (state.pulseTimerUs + 0.65) % 10000;
    }
    renderActiveView();
    window.requestAnimationFrame(tick);
  }

  /** Binds all UI events */
  function bindEvents() {
    // Top Tab Navigation
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        if (!targetTab) return;
        state.activeTab = targetTab;

        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-view').forEach((v) => {
          v.classList.toggle('active-view', v.id === `view-${targetTab}`);
        });

        setText('status-active-tab', TAB_TITLES[targetTab] || targetTab);
        renderActiveView();
      });
    });

    // Global Playback Controls
    const playBtn = document.getElementById('btn-play-pause');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        state.isRunning = !state.isRunning;
        playBtn.className = state.isRunning ? 'ctrl-btn btn-amber' : 'ctrl-btn btn-emerald';
        setText('play-pause-icon', state.isRunning ? '❚❚' : '▶');
        setText('play-pause-text', state.isRunning ? 'Pause Waveforms' : 'Run Simulation');
        setText('status-sim-state', state.isRunning ? 'RUNNING (60 FPS)' : 'PAUSED (STATIC)');
      });
    }

    const stepBtn = document.getElementById('btn-step');
    if (stepBtn) {
      stepBtn.addEventListener('click', () => {
        state.isRunning = false;
        if (playBtn) playBtn.className = 'ctrl-btn btn-emerald';
        setText('play-pause-icon', '▶');
        setText('play-pause-text', 'Run Simulation');
        setText('status-sim-state', 'STEP MODE (PAUSED)');

        state.animPhase += 0.12;
        state.pulseTimerUs += 4.0;
        renderActiveView();
      });
    }

    const resetBtn = document.getElementById('btn-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const currentTab = state.activeTab;
        state = createDefaultState();
        state.activeTab = currentTab;
        syncInputsFromState();
        updateUIReadouts();
        renderActiveView();
      });
    }

    // Helper for slider binding
    const bindSlider = (id, section, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', (e) => {
        state[section][key] = Number(e.target.value);
        updateUIReadouts();
      });
    };

    // View 1: FM bindings
    document.querySelectorAll('.fm-pattern-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.fm.pattern = btn.dataset.pattern;
        document.querySelectorAll('.fm-pattern-btn').forEach((b) => b.classList.toggle('active', b === btn));
        updateUIReadouts();
      });
    });
    bindSlider('fm-bw', 'fm', 'bwMHz');
    bindSlider('fm-tc', 'fm', 'tcUs');
    bindSlider('fm-fc', 'fm', 'fcScale');

    // View 2: Pulsed bindings
    bindSlider('pulsed-range', 'pulsed', 'rangeKm');
    bindSlider('pulsed-tau', 'pulsed', 'tauUs');
    bindSlider('pulsed-pri', 'pulsed', 'priUs');

    // View 3: CW bindings
    bindSlider('cw-vel', 'cw', 'velocityMps');
    bindSlider('cw-dist', 'cw', 'distanceM');
    bindSlider('cw-fc', 'cw', 'fcGHz');

    // View 4: FMCW bindings
    document.querySelectorAll('.fmcw-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.fmcw.chirpMode = btn.dataset.mode;
        document.querySelectorAll('.fmcw-mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
        updateUIReadouts();
      });
    });

    document.querySelectorAll('.fmcw-block-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.fmcw.selectedBlock = btn.dataset.block;
        document.querySelectorAll('.fmcw-block-btn').forEach((b) => b.classList.toggle('active', b === btn));
        updateUIReadouts();
      });
    });

    bindSlider('fmcw-r1', 'fmcw', 'range1');
    bindSlider('fmcw-v1', 'fmcw', 'vel1');
    bindSlider('fmcw-r2', 'fmcw', 'range2');
    bindSlider('fmcw-bw', 'fmcw', 'bwMHz');
    bindSlider('fmcw-tc', 'fmcw', 'tcUs');
    bindSlider('fmcw-snr', 'fmcw', 'snrDb');

    const t2Check = document.getElementById('fmcw-t2-enable');
    if (t2Check) {
      t2Check.addEventListener('change', (e) => {
        state.fmcw.enableTarget2 = Boolean(e.target.checked);
        updateUIReadouts();
      });
    }

    const winSelect = document.getElementById('fmcw-window');
    if (winSelect) {
      winSelect.addEventListener('change', (e) => {
        state.fmcw.windowType = e.target.value;
        updateUIReadouts();
      });
    }

    // UI Zoom Controls for Presentation Embedding
    let uiScale = 1.0;
    const appShell = document.querySelector('.app-shell');

    const applyZoom = (newScale) => {
      uiScale = Math.min(1.3, Math.max(0.5, Math.round(newScale * 20) / 20));
      if (appShell) {
        appShell.style.setProperty('--ui-scale', String(uiScale));
      }
      setText('zoom-level-text', `${Math.round(uiScale * 100)}%`);
      window.requestAnimationFrame(renderActiveView);
    };

    const zoomOutBtn = document.getElementById('btn-zoom-out');
    const zoomInBtn = document.getElementById('btn-zoom-in');
    const zoomResetBtn = document.getElementById('btn-zoom-reset');

    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => applyZoom(uiScale - 0.05));
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => applyZoom(uiScale + 0.05));
    if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => applyZoom(1.0));


  }

  // Initialize Workbench on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    syncInputsFromState();
    bindEvents();
    updateUIReadouts();
    window.requestAnimationFrame(tick);
  });
})();