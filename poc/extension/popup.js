const masterEnabled     = document.getElementById('masterEnabled');
const masterToggleRow   = document.getElementById('masterToggleRow');
const masterToggleLabel = document.getElementById('masterToggleLabel');
const restBody          = document.getElementById('restBody');
const modeRadios      = document.querySelectorAll('input[name="mode"]');
const calPtsRadios    = document.querySelectorAll('input[name="calpts"]');
const recalibrate     = document.getElementById('recalibrate');
const calPointsOpts   = document.getElementById('calPointsOpts');
const webcamToggles   = document.getElementById('webcamToggles');
const panelVisible    = document.getElementById('panelVisible');
const ringVisible     = document.getElementById('ringVisible');
const boldEnabled     = document.getElementById('boldEnabled');
const l2Enabled       = document.getElementById('l2Enabled');
const l2Scale         = document.getElementById('l2Scale');
const l2ScaleLabel    = document.getElementById('l2ScaleLabel');
const l2ScaleRow      = document.getElementById('l2ScaleRow');
const contrastEnabled = document.getElementById('contrastEnabled');
const summaryEnabled  = document.getElementById('summaryEnabled');
const cursorRingEnabled = document.getElementById('cursorRingEnabled');
const blindSpotVisible = document.getElementById('blindSpotVisible');
const themeButtons    = document.querySelectorAll('.theme-btn');
const status          = document.getElementById('status');

// ── Cal-points segmented control ─────────────────────────────────────────────
function setCalPtsUI(pts) {
  const val = String(pts);
  calPtsRadios.forEach(r => { r.checked = r.value === val; });
  document.getElementById('segOpt9').classList.toggle('selected',  val === '9');
  document.getElementById('segOpt25').classList.toggle('selected', val === '25');
}

function setWebcamExtras(show) {
  calPointsOpts.style.display  = show ? 'block' : 'none';
  webcamToggles.style.display  = show ? 'block' : 'none';
  recalibrate.style.display    = show ? 'block' : 'none';
}

// ── Load saved preferences ────────────────────────────────────────────────────
function setThemeUI(theme) {
  themeButtons.forEach(btn => btn.classList.toggle('selected', btn.dataset.theme === theme));
}

function setL2ScaleUI(scale) {
  l2Scale.value = scale;
  l2ScaleLabel.textContent = `${scale.toFixed(1)}×`;
}

function setL2RowDisabled(disabled) {
  l2Scale.disabled = disabled;
  l2ScaleRow.classList.toggle('disabled', disabled);
}

function setMasterUI(enabled) {
  masterEnabled.checked = enabled;
  masterToggleRow.classList.toggle('on', enabled);
  masterToggleLabel.textContent = enabled ? 'AI Kwau 已啟用' : 'AI Kwau 已停用';
  restBody.classList.toggle('disabled', !enabled);
}

chrome.storage.local.get(
  ['aikwau_gaze_mode', 'aikwau_cal_points',
   'aikwau_webcam_panel_visible', 'aikwau_gaze_ring_visible',
   'aikwau_l2_enabled', 'aikwau_l2_scale', 'aikwau_hc_theme',
   'aikwau_bold_enabled', 'aikwau_contrast_enabled', 'aikwau_summary_enabled',
   'aikwau_master_enabled', 'aikwau_cursor_ring_enabled'],
  (data) => {
    const mode  = data.aikwau_gaze_mode ?? 'mouse';
    const pts   = data.aikwau_cal_points ?? 25;
    const scale = data.aikwau_l2_scale ?? 1.2;
    const theme = data.aikwau_hc_theme ?? 'nightsky';
    document.querySelector(`input[value="${mode}"]`).checked = true;
    setWebcamExtras(mode === 'webcam');
    setCalPtsUI(pts);
    panelVisible.checked    = data.aikwau_webcam_panel_visible !== false;
    ringVisible.checked     = data.aikwau_gaze_ring_visible    !== false;
    boldEnabled.checked     = data.aikwau_bold_enabled         !== false;
    l2Enabled.checked       = data.aikwau_l2_enabled           !== false;
    setL2RowDisabled(!l2Enabled.checked);
    setL2ScaleUI(scale);
    contrastEnabled.checked = data.aikwau_contrast_enabled     !== false;
    summaryEnabled.checked  = data.aikwau_summary_enabled      !== false;
    setThemeUI(theme);
    setMasterUI(data.aikwau_master_enabled !== false);
    cursorRingEnabled.checked = data.aikwau_cursor_ring_enabled === true;
  }
);

// ── Mode change ───────────────────────────────────────────────────────────────
modeRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    const mode = radio.value;
    chrome.storage.local.set({ aikwau_gaze_mode: mode }, () => {
      setWebcamExtras(mode === 'webcam');
      status.textContent = '已儲存，請重新整理頁面生效';
      setTimeout(() => { status.textContent = ''; }, 2500);
    });
  });
});

// ── Cal-points change ─────────────────────────────────────────────────────────
calPtsRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    const pts = Number(radio.value);
    chrome.storage.local.set({ aikwau_cal_points: pts }, () => {
      setCalPtsUI(pts);
      status.textContent = `已切換至 ${pts} 點校準`;
      setTimeout(() => { status.textContent = ''; }, 2000);
    });
  });
});

// ── Webcam visual toggles ─────────────────────────────────────────────────────
function sendToTab(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, msg, () => void chrome.runtime.lastError);
  });
}

panelVisible.addEventListener('change', () => {
  const vis = panelVisible.checked;
  chrome.storage.local.set({ aikwau_webcam_panel_visible: vis });
  sendToTab({ type: 'gaze:panel-toggle', visible: vis });
});

ringVisible.addEventListener('change', () => {
  const vis = ringVisible.checked;
  chrome.storage.local.set({ aikwau_gaze_ring_visible: vis });
  sendToTab({ type: 'gaze:ring-toggle', visible: vis });
});

cursorRingEnabled.addEventListener('change', () => {
  const enabled = cursorRingEnabled.checked;
  chrome.storage.local.set({ aikwau_cursor_ring_enabled: enabled });
  sendToTab({ type: 'gaze:cursor-ring-toggle', enabled });
});

masterEnabled.addEventListener('change', () => {
  const enabled = masterEnabled.checked;
  chrome.storage.local.set({ aikwau_master_enabled: enabled });
  setMasterUI(enabled);
  sendToTab({ type: 'gaze:master-toggle', enabled });
});

boldEnabled.addEventListener('change', () => {
  const enabled = boldEnabled.checked;
  chrome.storage.local.set({ aikwau_bold_enabled: enabled });
  sendToTab({ type: 'gaze:bold-toggle', enabled });
});

l2Enabled.addEventListener('change', () => {
  const enabled = l2Enabled.checked;
  chrome.storage.local.set({ aikwau_l2_enabled: enabled });
  setL2RowDisabled(!enabled);
  sendToTab({ type: 'gaze:l2-toggle', enabled });
});

contrastEnabled.addEventListener('change', () => {
  const enabled = contrastEnabled.checked;
  chrome.storage.local.set({ aikwau_contrast_enabled: enabled });
  sendToTab({ type: 'gaze:contrast-toggle', enabled });
});

summaryEnabled.addEventListener('change', () => {
  const enabled = summaryEnabled.checked;
  chrome.storage.local.set({ aikwau_summary_enabled: enabled });
  sendToTab({ type: 'gaze:summary-toggle', enabled });
});

l2Scale.addEventListener('input', () => {
  const scale = parseFloat(l2Scale.value);
  l2ScaleLabel.textContent = `${scale.toFixed(1)}×`;
  chrome.storage.local.set({ aikwau_l2_scale: scale });
  sendToTab({ type: 'gaze:l2-scale', scale });
});

themeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.theme;
    chrome.storage.local.set({ aikwau_hc_theme: theme }, () => {
      setThemeUI(theme);
      status.textContent = `已切換至 ${btn.textContent} 主題`;
      setTimeout(() => { status.textContent = ''; }, 2000);
    });
  });
});

// ── Recalibrate ───────────────────────────────────────────────────────────────
recalibrate.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { type: 'gaze:recalibrate' }, () => {
      status.textContent = chrome.runtime.lastError ? '請先重新整理頁面' : '校準 UI 已開啟';
      if (!chrome.runtime.lastError) window.close();
      setTimeout(() => { status.textContent = ''; }, 2500);
    });
  });
});

// ── Gaze heatmap ─────────────────────────────────────────────────────────────
const HM_W = 24, HM_H = 14;
const CW = 13, CH = 13;
const HM_CANVAS_W = HM_W * CW;  // 312, matches <canvas id="hmCanvas"> width
const HM_CANVAS_H = HM_H * CH;  // 182, matches <canvas id="hmCanvas"> height

const hmCanvas       = document.getElementById('hmCanvas');
const hmCtx          = hmCanvas.getContext('2d');
const hmStats        = document.getElementById('hmStats');
const hmClear        = document.getElementById('hmClear');
const hmBody         = document.getElementById('hmBody');
const heatmapVisible = document.getElementById('heatmapVisible');

chrome.storage.local.get('aikwau_heatmap_visible', ({ aikwau_heatmap_visible }) => {
  const visible = aikwau_heatmap_visible !== false;
  heatmapVisible.checked = visible;
  hmBody.style.display = visible ? 'block' : 'none';
});

heatmapVisible.addEventListener('change', () => {
  const visible = heatmapVisible.checked;
  hmBody.style.display = visible ? 'block' : 'none';
  chrome.storage.local.set({ aikwau_heatmap_visible: visible });
});

chrome.storage.local.get('aikwau_blindspot_visible', ({ aikwau_blindspot_visible }) => {
  blindSpotVisible.checked = aikwau_blindspot_visible !== false;
});

blindSpotVisible.addEventListener('change', () => {
  const visible = blindSpotVisible.checked;
  chrome.storage.local.set({ aikwau_blindspot_visible: visible });
  sendToTab({ type: 'gaze:blindspot-toggle', visible });
});

function heatColor(t) {
  const s = [
    [0,     13,  17,  23],
    [0.05,  10,  45, 160],
    [0.25,   0, 170, 200],
    [0.50,  40, 200,  60],
    [0.75, 255, 200,   0],
    [1.0,  255,  40,   0],
  ];
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i][0]) {
      const [t0,r0,g0,b0] = s[i-1], [t1,r1,g1,b1] = s[i];
      const f = (t - t0) / (t1 - t0);
      return [r0+(r1-r0)*f|0, g0+(g1-g0)*f|0, b0+(b1-b0)*f|0];
    }
  }
  return [255, 40, 0];
}

function boxBlur(cells, w, h) {
  const out = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      let sum = 0, cnt = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r+dr, nc = c+dc;
          if (nr >= 0 && nr < h && nc >= 0 && nc < w) { sum += cells[nr*w+nc]; cnt++; }
        }
      }
      out[r*w+c] = sum / cnt;
    }
  }
  return out;
}

function renderHeatmap(data) {
  if (!data || !Array.isArray(data.cells) || data.cells.length !== HM_W * HM_H) {
    hmCtx.fillStyle = '#0d1117';
    hmCtx.fillRect(0, 0, HM_CANVAS_W, HM_CANVAS_H);
    hmCtx.fillStyle = '#444';
    hmCtx.font = '14px sans-serif';
    hmCtx.textAlign = 'center';
    hmCtx.fillText('尚無視線資料', HM_CANVAS_W / 2, HM_CANVAS_H / 2);
    hmStats.textContent = '尚無資料';
    return;
  }

  const blurred = boxBlur(data.cells, HM_W, HM_H);
  const maxVal  = Math.max(...blurred, 1);
  const total   = data.totalPoints ?? data.cells.reduce((a, b) => a + b, 0);

  const img = hmCtx.createImageData(HM_CANVAS_W, HM_CANVAS_H);
  for (let r = 0; r < HM_H; r++) {
    for (let c = 0; c < HM_W; c++) {
      const v = blurred[r * HM_W + c];
      const t = v < 0.5 ? 0 : Math.log(v + 1) / Math.log(maxVal + 1);
      const [ri, gi, bi] = heatColor(t);
      for (let py = r * CH; py < (r + 1) * CH; py++) {
        for (let px = c * CW; px < (c + 1) * CW; px++) {
          const i = (py * HM_CANVAS_W + px) * 4;
          img.data[i] = ri; img.data[i+1] = gi; img.data[i+2] = bi; img.data[i+3] = 255;
        }
      }
    }
  }
  hmCtx.putImageData(img, 0, 0);

  if (total >= 50) {
    hmCtx.fillStyle = 'rgba(255,255,80,0.85)';
    hmCtx.font = 'bold 9px sans-serif';
    hmCtx.textAlign = 'center';
    for (let r = 1; r < HM_H - 1; r++) {
      for (let c = 1; c < HM_W - 1; c++) {
        if (data.cells[r * HM_W + c] > 0) continue;
        let nb = 0;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++)
            if ((dr || dc) && data.cells[(r+dr)*HM_W+(c+dc)] > 0) nb++;
        if (nb >= 3) hmCtx.fillText('?', c*CW+CW/2, r*CH+CH/2+3);
      }
    }
  }

  const updated = data.lastUpdated
    ? new Date(data.lastUpdated).toLocaleTimeString('zh-TW', { hour12: false })
    : '—';
  hmStats.textContent = `視線點：${total} 　最後更新：${updated}`;
}

(function drawLegend() {
  const lc = document.getElementById('hmLegend');
  const ctx = lc.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 240, 0);
  g.addColorStop(0,    'rgb(13,17,23)');
  g.addColorStop(0.05, 'rgb(10,45,160)');
  g.addColorStop(0.25, 'rgb(0,170,200)');
  g.addColorStop(0.50, 'rgb(40,200,60)');
  g.addColorStop(0.75, 'rgb(255,200,0)');
  g.addColorStop(1.0,  'rgb(255,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 240, 9);
})();

function loadAndRender() {
  chrome.storage.local.get('aikwau_heatmap', ({ aikwau_heatmap }) => renderHeatmap(aikwau_heatmap));
}
loadAndRender();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.aikwau_heatmap) renderHeatmap(changes.aikwau_heatmap.newValue);
});

hmClear.addEventListener('click', () => {
  chrome.storage.local.remove('aikwau_heatmap', () => {
    renderHeatmap(null);
    hmStats.textContent = '已清除';
    sendToTab({ type: 'clearHighlights' });
  });
});
