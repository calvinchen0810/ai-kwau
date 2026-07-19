'use strict';
/**
 * AI Kwau — Shared gaze-heatmap canvas renderer.
 *
 * Loaded by both popup.html (before popup.js) and, via background.js's
 * chrome.scripting.executeScript injection sequence, into the host page's
 * MAIN world before gaze_webcam.js — so the popup's full-size heatmap and
 * the webcam panel's compact heatmap draw from one shared implementation
 * instead of two copies that could drift apart.
 *
 * Grid is always HM_W×HM_H cells; callers choose their own cell pixel size
 * (popup: 13×13 → 312×182 canvas; webcam panel: smaller, to fit 240px).
 */
(function (global) {
  const HM_W = 24, HM_H = 14;

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
        const [t0, r0, g0, b0] = s[i - 1], [t1, r1, g1, b1] = s[i];
        const f = (t - t0) / (t1 - t0);
        return [r0 + (r1 - r0) * f | 0, g0 + (g1 - g0) * f | 0, b0 + (b1 - b0) * f | 0];
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
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < h && nc >= 0 && nc < w) { sum += cells[nr * w + nc]; cnt++; }
          }
        }
        out[r * w + c] = sum / cnt;
      }
    }
    return out;
  }

  // Draws the heatmap grid (or a "no data" placeholder) into ctx.
  // cells: flat HM_W*HM_H array | null/invalid → placeholder drawn.
  // opts: { noDataText, showColdMarkers (bool, draws '?' on isolated cold cells) }
  // Returns { hasData, total }.
  function drawGrid(ctx, canvasW, canvasH, cellW, cellH, cells, opts) {
    opts = opts || {};
    if (!Array.isArray(cells) || cells.length !== HM_W * HM_H) {
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, canvasW, canvasH);
      if (opts.noDataText) {
        ctx.fillStyle = '#444';
        ctx.font = `${Math.max(9, Math.round(cellH * 0.9))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(opts.noDataText, canvasW / 2, canvasH / 2);
      }
      return { hasData: false, total: 0 };
    }

    const blurred = boxBlur(cells, HM_W, HM_H);
    const maxVal  = Math.max(...blurred, 1);
    const total   = cells.reduce((a, b) => a + b, 0);

    const img = ctx.createImageData(canvasW, canvasH);
    for (let r = 0; r < HM_H; r++) {
      for (let c = 0; c < HM_W; c++) {
        const v = blurred[r * HM_W + c];
        const t = v < 0.5 ? 0 : Math.log(v + 1) / Math.log(maxVal + 1);
        const [ri, gi, bi] = heatColor(t);
        for (let py = Math.round(r * cellH); py < Math.round((r + 1) * cellH); py++) {
          for (let px = Math.round(c * cellW); px < Math.round((c + 1) * cellW); px++) {
            const i = (py * canvasW + px) * 4;
            img.data[i] = ri; img.data[i + 1] = gi; img.data[i + 2] = bi; img.data[i + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);

    if (opts.showColdMarkers && total >= 50) {
      ctx.fillStyle = 'rgba(255,255,80,0.85)';
      ctx.font = `bold ${Math.max(7, Math.round(cellH * 0.7))}px sans-serif`;
      ctx.textAlign = 'center';
      for (let r = 1; r < HM_H - 1; r++) {
        for (let c = 1; c < HM_W - 1; c++) {
          if (cells[r * HM_W + c] > 0) continue;
          let nb = 0;
          for (let dr = -1; dr <= 1; dr++)
            for (let dc = -1; dc <= 1; dc++)
              if ((dr || dc) && cells[(r + dr) * HM_W + (c + dc)] > 0) nb++;
          if (nb >= 3) ctx.fillText('?', c * cellW + cellW / 2, r * cellH + cellH / 2 + cellH * 0.25);
        }
      }
    }

    return { hasData: true, total };
  }

  global.AIKWAU_HEATMAP_RENDER = { HM_W, HM_H, heatColor, boxBlur, drawGrid };
})(typeof window !== 'undefined' ? window : globalThis);
