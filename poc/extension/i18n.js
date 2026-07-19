'use strict';
/**
 * AI Kwau — Shared UI translation dictionary.
 * Loaded by both popup.html (before popup.js) and the isolated-world
 * content-script bundle (before content.js) via manifest.json, so both
 * contexts read from the same source of truth instead of maintaining
 * duplicate copies.
 */
(function (global) {
  const DICT = {
    // ── Popup: static labels ──────────────────────────────────────────────
    masterOn:        { zh: 'AI Kwau 已啟用',          en: 'AI Kwau Enabled' },
    masterOff:       { zh: 'AI Kwau 已停用',          en: 'AI Kwau Disabled' },
    modeMouse:       { zh: '滑鼠模式（PoC）',          en: 'Mouse Mode (PoC)' },
    modeWebcam:      { zh: '眼球追蹤（Webcam）',       en: 'Eye Tracking (Webcam)' },
    cursorRing:      { zh: '強化滑鼠指標',            en: 'Enhance Mouse Pointer' },
    blindSpot:       { zh: '顯示盲點提示',            en: 'Show Blind-Spot Hints' },
    sectReading:     { zh: '閱讀增強',                en: 'Reading Enhancement' },
    bold:            { zh: '文字加粗',                en: 'Bold Text' },
    enlarge:         { zh: '字型放大',                en: 'Enlarge Text' },
    contrast:        { zh: '加強對比',                en: 'Increase Contrast' },
    summary:         { zh: '段落摘要',                en: 'Paragraph Summary' },
    sectTheme:       { zh: '高對比主題',              en: 'High Contrast Theme' },
    themeAquatic:    { zh: '水域',                    en: 'Aquatic' },
    themeDesert:     { zh: '沙漠',                    en: 'Desert' },
    themeDusk:       { zh: '黃昏',                    en: 'Dusk' },
    themeNightsky:   { zh: '夜空',                    en: 'Night Sky' },
    calPointsLabel:  { zh: '校準點數量',              en: 'Calibration Points' },
    cal9:            { zh: '9 點（快速）',            en: '9 Points (Fast)' },
    cal25:           { zh: '25 點（精確）',           en: '25 Points (Precise)' },
    recalibrate:     { zh: '重新校準',                en: 'Recalibrate' },
    showWebcamPanel: { zh: '顯示 Webcam 視窗',        en: 'Show Webcam Panel' },
    showGazeRing:    { zh: '顯示注視藍圈',            en: 'Show Gaze Ring' },

    // ── Popup: dynamic status messages ──────────────────────────────────────
    savedReload:     { zh: '已儲存，請重新整理頁面生效', en: 'Saved — reload the page to apply' },
    switchedCalPts:  { zh: '已切換至 {n} 點校準',       en: 'Switched to {n}-point calibration' },
    switchedTheme:   { zh: '已切換至 {name} 主題',      en: 'Switched to {name} theme' },
    reloadFirst:     { zh: '請先重新整理頁面',          en: 'Please reload the page first' },
    calUIOpened:     { zh: '校準 UI 已開啟',           en: 'Calibration UI opened' },

    // ── content.js: on-page dynamic UI ──────────────────────────────────────
    webcamTitle:     { zh: 'AI Kwau 眼球追蹤',                          en: 'AI Kwau Eye Tracking' },
    startingCamera:  { zh: '正在啟動相機與 MediaPipe 模型...',           en: 'Starting camera and MediaPipe model...' },
    cameraError:     { zh: '相機錯誤：{msg} — 請允許此網站存取相機再重新整理', en: 'Camera error: {msg} — please allow camera access for this site and reload' },
    calTitle:        { zh: '眼球追蹤校準 (MediaPipe)',                   en: 'Eye Tracking Calibration (MediaPipe)' },
    calInstruction:  { zh: '注視每個藍色圓點，然後點擊它。請確保臉部在鏡頭中央。', en: 'Look at each blue dot, then click it. Keep your face centered in the camera.' },
    calProgress:     { zh: '{done} / {total} 完成',                     en: '{done} / {total} done' },
    skipCalibration: { zh: '跳過校準（需至少 {min} 點）',                 en: 'Skip calibration (need at least {min} points)' },
    skipAlert:       { zh: '請至少完成 {min} 個校準點。',                 en: 'Please complete at least {min} calibration points.' },
    injectionError:  { zh: '注入錯誤：{msg}',                            en: 'Injection error: {msg}' },
    clickSummary:    { zh: '點擊摘要',                                  en: 'Click for summary' },
    clickRestore:    { zh: '點擊還原',                                  en: 'Click to restore' },
  };

  function t(key, lang, vars) {
    const entry = DICT[key];
    if (!entry) return key;
    let text = entry[lang] ?? entry.zh;
    if (vars) {
      text = text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? `{${name}}`));
    }
    return text;
  }

  global.AIKWAU_I18N = { t };
})(typeof window !== 'undefined' ? window : globalThis);
