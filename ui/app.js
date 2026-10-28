/* ===================================================================
   Sip & Puff Controller — Application Logic
   Serial terminal, live dashboard, config sync, demo simulation
   =================================================================== */

(function () {
    'use strict';

    // ── Configurable state (mirrors the firmware #defines) ──
    const config = {
        softThreshold: 20000,
        hardThreshold: 180000,
        moveStep: 5,
        timeout: 100,
        baselineDiv: 32,
        pollInterval: 10,
    };

    // ── DOM refs ──
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => [...document.querySelectorAll(sel)];

    // Navigation
    const navToggle = $('#nav-toggle');
    const navLinks = $('.nav-links');

    // Dashboard
    const statusConn = $('#status-connection');
    const statusDot = $('#status-dot-conn');
    const statusBaseline = $('#status-baseline');
    const statusEvent = $('#status-event');
    const statusDelta = $('#status-delta');
    const gaugeNeedle = $('#gauge-needle');
    const waveformCanvas = $('#waveform-canvas');
    const waveCtx = waveformCanvas.getContext('2d');
    const cursorDot = $('#cursor-dot');
    const cursorArena = $('#cursor-arena');

    // Terminal
    const termOutput = $('#terminal-output');
    const termInput = $('#terminal-input');
    const btnConnect = $('#btn-connect');
    const btnDisconnect = $('#btn-disconnect');
    const btnClearTerm = $('#btn-clear-term');
    const btnSend = $('#btn-send');
    const btnAutoScroll = $('#btn-autoscroll');
    const btnExportLog = $('#btn-export-log');
    const btnScanPorts = $('#btn-scan-ports');
    const portSelect = $('#port-select');
    const baudSelect = $('#baud-select');

    // Demo
    const btnDemoStart = $('#btn-demo-start');
    const btnDemoStop = $('#btn-demo-stop');
    const btnDemoPuff = $('#btn-demo-puff');
    const btnDemoSip = $('#btn-demo-sip');

    // Config sliders
    const cfgSoftThresh = $('#cfg-soft-thresh');
    const cfgHardThresh = $('#cfg-hard-thresh');
    const cfgMoveStep = $('#cfg-move-step');
    const cfgTimeout = $('#cfg-timeout');
    const cfgBaselineDiv = $('#cfg-baseline-div');
    const cfgPollInterval = $('#cfg-poll-interval');
    const codePreview = $('#code-preview code');
    const btnCopyDefines = $('#btn-copy-defines');

    // Waveform controls
    const btnWaveformPause = $('#btn-waveform-pause');
    const btnWaveformClear = $('#btn-waveform-clear');

    // Hero ring
    const heroRing = $('#hero-ring');
    const heroPressureVal = $('#hero-pressure-val');

    // Mapping threshold labels
    const mapHardVal = $('#map-hard-val');
    const mapHardSipVal = $('#map-hard-sip-val');
    const mapSoftSipVal = $('#map-soft-sip-val');
    const mapSoftVal = $('#map-soft-val');
    const mapSteps = ['#map-step', '#map-step2', '#map-step3', '#map-step4'].map($);

    // ── Serial state ──
    let serialPort = null;
    let serialReader = null;
    let serialWriter = null;
    let isConnected = false;
    let autoScroll = true;
    let logLines = [];

    // ── Waveform state ──
    const WAVEFORM_MAX = 250;
    let waveformData = [];
    let waveformPaused = false;

    // ── Cursor preview state ──
    let cursorX = 50; // percent
    let cursorY = 50;

    // ── Demo state ──
    let demoInterval = null;
    let demoBaseline = 8388608; // ~mid-range for 24-bit XOR'd
    let demoPressure = 0;

    // ── Event names ──
    const EVENT_NAMES = ['IDLE', 'SOFT_PUFF', 'SOFT_SIP', 'HARD_PUFF', 'HARD_SIP'];
    const EVENT_CLASSES = ['term-info', 'term-puff', 'term-sip', 'term-hard-puff', 'term-hard-sip'];

    /* ==================================================================
       1. Navigation
    ================================================================== */
    navToggle.addEventListener('click', () => {
        navLinks.classList.toggle('open');
    });

    // Smooth-scroll & close mobile nav on link click
    $$('.nav-links a').forEach((a) => {
        a.addEventListener('click', () => navLinks.classList.remove('open'));
    });

    /* ==================================================================
       2. Configuration Panel — Sliders
    ================================================================== */
    function syncConfig() {
        config.softThreshold = +cfgSoftThresh.value;
        config.hardThreshold = +cfgHardThresh.value;
        config.moveStep = +cfgMoveStep.value;
        config.timeout = +cfgTimeout.value;
        config.baselineDiv = +cfgBaselineDiv.value;
        config.pollInterval = +cfgPollInterval.value;

        // Update output labels
        $('#cfg-soft-thresh-val').textContent = config.softThreshold;
        $('#cfg-hard-thresh-val').textContent = config.hardThreshold;
        $('#cfg-move-step-val').textContent = config.moveStep;
        $('#cfg-timeout-val').textContent = config.timeout;
        $('#cfg-baseline-div-val').textContent = config.baselineDiv;
        $('#cfg-poll-interval-val').textContent = config.pollInterval;

        // Update mapping section
        mapHardVal.textContent = config.hardThreshold;
        mapHardSipVal.textContent = config.hardThreshold;
        mapSoftSipVal.textContent = config.softThreshold;
        mapSoftVal.textContent = config.softThreshold;
        mapSteps.forEach((el) => { if (el) el.textContent = config.moveStep; });

        // Update code preview
        codePreview.textContent =
            `#define SOFT_THRESHOLD   ${config.softThreshold}\n` +
            `#define HARD_THRESHOLD   ${config.hardThreshold}\n` +
            `#define MOVE_STEP        ${config.moveStep}\n` +
            `#define HX710B_TIMEOUT_MS ${config.timeout}`;
    }

    [cfgSoftThresh, cfgHardThresh, cfgMoveStep, cfgTimeout, cfgBaselineDiv, cfgPollInterval].forEach((slider) => {
        slider.addEventListener('input', syncConfig);
    });

    btnCopyDefines.addEventListener('click', () => {
        navigator.clipboard.writeText(codePreview.textContent).then(() => {
            btnCopyDefines.textContent = '✓ Copied!';
            setTimeout(() => (btnCopyDefines.textContent = '📋 Copy to Clipboard'), 2000);
        });
    });

    syncConfig(); // initialise on load

    /* ==================================================================
       3. Terminal — Web Serial API
    ================================================================== */
    function termLog(text, cls = 'term-data') {
        const line = document.createElement('div');
        line.className = `term-line ${cls}`;
        line.textContent = text;
        termOutput.appendChild(line);
        logLines.push(text);
        if (autoScroll) termOutput.scrollTop = termOutput.scrollHeight;
    }

    function setConnectionState(connected) {
        isConnected = connected;
        statusConn.textContent = connected ? 'Connected' : 'Disconnected';
        statusDot.classList.toggle('connected', connected);
        btnConnect.disabled = connected;
        btnDisconnect.disabled = !connected;
    }

    // Check for Web Serial support
    const hasWebSerial = 'serial' in navigator;

    if (!hasWebSerial) {
        btnConnect.title = 'Web Serial API not supported in this browser. Use Chrome/Edge.';
    }

    btnConnect.addEventListener('click', async () => {
        if (!hasWebSerial) {
            termLog('⚠  Web Serial API is not supported. Please use Chrome or Edge.', 'term-error');
            return;
        }
        try {
            serialPort = await navigator.serial.requestPort();
            const baud = parseInt(baudSelect.value, 10);
            await serialPort.open({ baudRate: baud });

            setConnectionState(true);
            termLog(`✓ Connected at ${baud} baud`, 'term-info');

            // Set up writer
            const encoder = new TextEncoderStream();
            const writableStreamClosed = encoder.readable.pipeTo(serialPort.writable);
            serialWriter = encoder.writable.getWriter();

            // Start reading
            readSerialLoop();
        } catch (err) {
            termLog(`✗ Connection failed: ${err.message}`, 'term-error');
        }
    });

    btnDisconnect.addEventListener('click', async () => {
        try {
            if (serialReader) { await serialReader.cancel(); serialReader = null; }
            if (serialWriter) { serialWriter.releaseLock(); serialWriter = null; }
            if (serialPort)   { await serialPort.close(); serialPort = null; }
        } catch (e) { /* ignore */ }
        setConnectionState(false);
        termLog('⊘ Disconnected', 'term-info');
    });

    async function readSerialLoop() {
        const decoder = new TextDecoderStream();
        const readableStreamClosed = serialPort.readable.pipeTo(decoder.writable);
        serialReader = decoder.readable.getReader();
        let lineBuffer = '';

        try {
            while (true) {
                const { value, done } = await serialReader.read();
                if (done) break;
                if (!value) continue;

                lineBuffer += value;
                const lines = lineBuffer.split('\n');
                lineBuffer = lines.pop(); // keep incomplete tail

                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (line) processSerialLine(line);
                }
            }
        } catch (err) {
            if (err.name !== 'CancelError') {
                termLog(`✗ Read error: ${err.message}`, 'term-error');
            }
        } finally {
            serialReader.releaseLock();
        }
    }

    function processSerialLine(line) {
        // Expected: raw=<val> delta=<val> event=<0-4>
        const match = line.match(/raw=(-?\d+)\s+delta=(-?\d+)\s+event=(\d)/);
        if (match) {
            const raw = parseInt(match[1], 10);
            const delta = parseInt(match[2], 10);
            const event = parseInt(match[3], 10);

            const evtName = EVENT_NAMES[event] || 'UNKNOWN';
            const cls = EVENT_CLASSES[event] || 'term-data';

            termLog(`raw=${raw}  Δ=${delta}  → ${evtName}`, cls);
            updateDashboard(raw, delta, event);
        } else {
            termLog(line, 'term-data');
        }
    }

    btnSend.addEventListener('click', sendTerminalInput);
    termInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendTerminalInput();
    });

    async function sendTerminalInput() {
        const text = termInput.value;
        if (!text) return;
        termLog(`❯ ${text}`, 'term-sent');
        termInput.value = '';
        if (serialWriter) {
            try { await serialWriter.write(text + '\n'); } catch (e) { /* noop */ }
        }
    }

    btnClearTerm.addEventListener('click', () => {
        termOutput.innerHTML = '';
        logLines = [];
    });

    btnAutoScroll.addEventListener('click', () => {
        autoScroll = !autoScroll;
        btnAutoScroll.classList.toggle('active', autoScroll);
    });

    btnExportLog.addEventListener('click', () => {
        const blob = new Blob([logLines.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sip_puff_log_${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        termLog('💾 Log exported', 'term-info');
    });

    btnScanPorts.addEventListener('click', async () => {
        if (!hasWebSerial) {
            termLog('⚠  Web Serial not supported in this browser.', 'term-error');
            return;
        }
        try {
            const ports = await navigator.serial.getPorts();
            portSelect.innerHTML = '<option value="">Select COM Port</option>';
            if (ports.length === 0) {
                termLog('ℹ  No previously paired ports found. Click "Connect" to pick one.', 'term-info');
            } else {
                ports.forEach((p, i) => {
                    const info = p.getInfo();
                    const label = `Port ${i + 1} (VID:${info.usbVendorId?.toString(16) ?? '?'} PID:${info.usbProductId?.toString(16) ?? '?'})`;
                    const opt = document.createElement('option');
                    opt.textContent = label;
                    opt.value = i;
                    portSelect.appendChild(opt);
                });
                termLog(`ℹ  Found ${ports.length} paired port(s).`, 'term-info');
            }
        } catch (err) {
            termLog(`✗ Port scan failed: ${err.message}`, 'term-error');
        }
    });

    /* ==================================================================
       4. Dashboard Updates
    ================================================================== */
    function updateDashboard(raw, delta, event) {
        // Cards
        statusBaseline.textContent = (raw - delta).toLocaleString();
        statusEvent.textContent = EVENT_NAMES[event] || '—';
        statusDelta.textContent = delta.toLocaleString();

        // Gauge needle
        const maxRange = 200000;
        const clampedDelta = Math.max(-maxRange, Math.min(maxRange, delta));
        const pct = ((clampedDelta + maxRange) / (2 * maxRange)) * 100;
        gaugeNeedle.style.left = `${pct}%`;

        // Waveform
        if (!waveformPaused) {
            waveformData.push(delta);
            if (waveformData.length > WAVEFORM_MAX) waveformData.shift();
            drawWaveform();
        }

        // Cursor preview
        const step = config.moveStep * 0.4; // scale for preview
        switch (event) {
            case 1: cursorX = Math.min(100, cursorX + step); break; // soft puff → right
            case 2: cursorX = Math.max(0, cursorX - step);   break; // soft sip  → left
            case 3: cursorY = Math.max(0, cursorY - step);   break; // hard puff → up
            case 4: cursorY = Math.min(100, cursorY + step); break; // hard sip  → down
        }
        cursorDot.style.left = `${cursorX}%`;
        cursorDot.style.top = `${cursorY}%`;

        // Hero ring
        const absDelta = Math.abs(delta);
        const ringMax = 565.48;
        const ringPct = Math.min(1, absDelta / config.hardThreshold);
        heroRing.style.strokeDashoffset = ringMax * (1 - ringPct);
        heroPressureVal.textContent = delta.toLocaleString();

        // Hero ring label
        const ringLabel = heroRing.closest('.pressure-ring')?.querySelector('.ring-label');
        if (ringLabel) ringLabel.textContent = EVENT_NAMES[event] || 'IDLE';

        // Colour the ring based on event
        const eventColors = ['hsl(220,15%,45%)', 'hsl(170,75%,52%)', 'hsl(35,95%,55%)', 'hsl(195,100%,55%)', 'hsl(0,75%,55%)'];
        heroPressureVal.style.color = eventColors[event] || eventColors[0];
    }

    /* ==================================================================
       5. Waveform Renderer
    ================================================================== */
    function drawWaveform() {
        const dpr = window.devicePixelRatio || 1;
        const rect = waveformCanvas.getBoundingClientRect();
        waveformCanvas.width = rect.width * dpr;
        waveformCanvas.height = rect.height * dpr;
        waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const w = rect.width;
        const h = rect.height;
        const midY = h / 2;
        const maxRange = Math.max(config.hardThreshold * 1.5, 80000);

        // Background
        waveCtx.clearRect(0, 0, w, h);

        // Threshold zones
        const softY = (config.softThreshold / maxRange) * midY;
        const hardY = (config.hardThreshold / maxRange) * midY;

        // Hard zone
        waveCtx.fillStyle = 'hsla(195,100%,55%,.04)';
        waveCtx.fillRect(0, midY - hardY, w, hardY - softY);
        waveCtx.fillStyle = 'hsla(0,75%,55%,.04)';
        waveCtx.fillRect(0, midY + softY, w, hardY - softY);

        // Soft zone
        waveCtx.fillStyle = 'hsla(170,75%,52%,.05)';
        waveCtx.fillRect(0, midY - softY, w, softY);
        waveCtx.fillStyle = 'hsla(35,95%,55%,.05)';
        waveCtx.fillRect(0, midY, w, softY);

        // Threshold lines
        waveCtx.setLineDash([4, 4]);
        waveCtx.lineWidth = 1;

        // Soft threshold lines
        waveCtx.strokeStyle = 'hsla(170,75%,52%,.25)';
        waveCtx.beginPath();
        waveCtx.moveTo(0, midY - softY);
        waveCtx.lineTo(w, midY - softY);
        waveCtx.stroke();
        waveCtx.strokeStyle = 'hsla(35,95%,55%,.25)';
        waveCtx.beginPath();
        waveCtx.moveTo(0, midY + softY);
        waveCtx.lineTo(w, midY + softY);
        waveCtx.stroke();

        // Hard threshold lines
        waveCtx.strokeStyle = 'hsla(195,100%,55%,.25)';
        waveCtx.beginPath();
        waveCtx.moveTo(0, midY - hardY);
        waveCtx.lineTo(w, midY - hardY);
        waveCtx.stroke();
        waveCtx.strokeStyle = 'hsla(0,75%,55%,.25)';
        waveCtx.beginPath();
        waveCtx.moveTo(0, midY + hardY);
        waveCtx.lineTo(w, midY + hardY);
        waveCtx.stroke();

        waveCtx.setLineDash([]);

        // Centre line
        waveCtx.strokeStyle = 'hsla(220,20%,40%,.3)';
        waveCtx.lineWidth = 1;
        waveCtx.beginPath();
        waveCtx.moveTo(0, midY);
        waveCtx.lineTo(w, midY);
        waveCtx.stroke();

        // Data line
        if (waveformData.length < 2) return;
        const stepX = w / (WAVEFORM_MAX - 1);

        waveCtx.beginPath();
        waveCtx.lineWidth = 2;
        const gradient = waveCtx.createLinearGradient(0, 0, w, 0);
        gradient.addColorStop(0, 'hsla(170,80%,50%,.2)');
        gradient.addColorStop(0.5, 'hsla(170,80%,50%,.8)');
        gradient.addColorStop(1, 'hsla(170,80%,50%,1)');
        waveCtx.strokeStyle = gradient;

        const startIdx = WAVEFORM_MAX - waveformData.length;
        for (let i = 0; i < waveformData.length; i++) {
            const x = (startIdx + i) * stepX;
            const y = midY - (waveformData[i] / maxRange) * midY;
            if (i === 0) waveCtx.moveTo(x, y);
            else waveCtx.lineTo(x, y);
        }
        waveCtx.stroke();

        // Glow fill
        waveCtx.lineTo((startIdx + waveformData.length - 1) * stepX, midY);
        waveCtx.lineTo(startIdx * stepX, midY);
        waveCtx.closePath();
        const fillGrad = waveCtx.createLinearGradient(0, midY - h / 2, 0, midY);
        fillGrad.addColorStop(0, 'hsla(170,80%,50%,.08)');
        fillGrad.addColorStop(1, 'hsla(170,80%,50%,.0)');
        waveCtx.fillStyle = fillGrad;
        waveCtx.fill();

        // Current value dot
        if (waveformData.length > 0) {
            const lastX = (startIdx + waveformData.length - 1) * stepX;
            const lastY = midY - (waveformData[waveformData.length - 1] / maxRange) * midY;
            waveCtx.beginPath();
            waveCtx.arc(lastX, lastY, 4, 0, Math.PI * 2);
            waveCtx.fillStyle = 'hsl(170,80%,50%)';
            waveCtx.fill();
            waveCtx.beginPath();
            waveCtx.arc(lastX, lastY, 8, 0, Math.PI * 2);
            waveCtx.fillStyle = 'hsla(170,80%,50%,.2)';
            waveCtx.fill();
        }
    }

    btnWaveformPause.addEventListener('click', () => {
        waveformPaused = !waveformPaused;
        btnWaveformPause.textContent = waveformPaused ? '▶' : '⏸';
    });

    btnWaveformClear.addEventListener('click', () => {
        waveformData = [];
        drawWaveform();
    });

    // Redraw on resize
    window.addEventListener('resize', () => {
        if (!waveformPaused) drawWaveform();
    });

    /* ==================================================================
       6. Demo / Simulation Mode
    ================================================================== */
    function classifyDelta(delta) {
        const abs = Math.abs(delta);
        if (abs > config.hardThreshold) return delta > 0 ? 3 : 4;
        if (abs > config.softThreshold) return delta > 0 ? 1 : 2;
        return 0;
    }

    function demoTick() {
        // Simulate a noisy idle baseline with occasional random sips/puffs
        demoPressure *= 0.92; // decay toward 0
        demoPressure += (Math.random() - 0.5) * 4000; // noise

        const raw = demoBaseline + Math.round(demoPressure);
        const delta = Math.round(demoPressure);
        const event = classifyDelta(delta);

        const evtName = EVENT_NAMES[event] || 'UNKNOWN';
        const cls = EVENT_CLASSES[event] || 'term-data';
        termLog(`raw=${raw}  delta=${delta}  event=${event}`, cls);
        updateDashboard(raw, delta, event);
    }

    btnDemoStart.addEventListener('click', () => {
        if (demoInterval) return;
        demoInterval = setInterval(demoTick, 80);
        btnDemoStart.disabled = true;
        btnDemoStop.disabled = false;
        setConnectionState(true);
        statusConn.textContent = 'Demo Mode';
        termLog('▶ Demo simulation started', 'term-info');
    });

    btnDemoStop.addEventListener('click', stopDemo);

    function stopDemo() {
        if (demoInterval) { clearInterval(demoInterval); demoInterval = null; }
        btnDemoStart.disabled = false;
        btnDemoStop.disabled = true;
        setConnectionState(false);
        statusConn.textContent = 'Disconnected';
        termLog('⏹ Demo simulation stopped', 'term-info');
    }

    btnDemoPuff.addEventListener('click', () => {
        demoPressure += 40000 + Math.random() * 35000;
    });
    btnDemoSip.addEventListener('click', () => {
        demoPressure -= 40000 + Math.random() * 35000;
    });

    /* ==================================================================
       7. Hero Animation (idle pulsing when no data flows)
    ================================================================== */
    let heroAnimFrame;
    let heroPhase = 0;

    function heroIdleAnimation() {
        if (isConnected) {
            heroAnimFrame = requestAnimationFrame(heroIdleAnimation);
            return;
        }
        heroPhase += 0.015;
        const val = Math.sin(heroPhase) * 0.3;
        const ringMax = 565.48;
        heroRing.style.strokeDashoffset = ringMax * (1 - (0.15 + Math.abs(val) * 0.25));
        heroPressureVal.textContent = Math.round(val * 15000);
        heroAnimFrame = requestAnimationFrame(heroIdleAnimation);
    }
    heroIdleAnimation();

    /* ==================================================================
       8. Smooth scroll highlight for nav links
    ================================================================== */
    const sections = $$('section[id]');
    const navAnchors = $$('.nav-links a');

    function onScroll() {
        const scrollY = window.scrollY + 120;
        sections.forEach((sec) => {
            const top = sec.offsetTop;
            const height = sec.offsetHeight;
            const id = sec.getAttribute('id');
            navAnchors.forEach((a) => {
                a.classList.toggle('active-link', a.getAttribute('href') === `#${id}` && scrollY >= top && scrollY < top + height);
            });
        });
    }
    window.addEventListener('scroll', onScroll, { passive: true });

    /* ==================================================================
       9. Init waveform on first paint
    ================================================================== */
    requestAnimationFrame(drawWaveform);

    /* ==================================================================
       10. Cursor reset on double-click
    ================================================================== */
    cursorArena.addEventListener('dblclick', () => {
        cursorX = 50;
        cursorY = 50;
        cursorDot.style.left = '50%';
        cursorDot.style.top = '50%';
    });

})();
