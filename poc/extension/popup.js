const radios = document.querySelectorAll('input[name="mode"]');
const recalibrate = document.getElementById('recalibrate');
const status = document.getElementById('status');

chrome.storage.local.get('aikwau_gaze_mode', ({ aikwau_gaze_mode }) => {
  const mode = aikwau_gaze_mode ?? 'mouse';
  document.querySelector(`input[value="${mode}"]`).checked = true;
  recalibrate.style.display = mode === 'webcam' ? 'block' : 'none';
});

radios.forEach(radio => {
  radio.addEventListener('change', () => {
    const mode = radio.value;
    chrome.storage.local.set({ aikwau_gaze_mode: mode }, () => {
      recalibrate.style.display = mode === 'webcam' ? 'block' : 'none';
      status.textContent = '已儲存，請重新整理頁面生效';
      setTimeout(() => { status.textContent = ''; }, 2500);
    });
  });
});

recalibrate.addEventListener('click', () => {
  chrome.storage.local.set({ aikwau_needs_calibration: true }, () => {
    status.textContent = '下次頁面載入時將進行校準';
    setTimeout(() => { status.textContent = ''; }, 2500);
  });
});
