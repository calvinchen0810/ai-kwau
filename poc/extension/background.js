const HOST_NAME = "com.hp.aikwau.summarizer";
let port = null;
const pending = new Map();
let reqCounter = 0;

function connect() {
  port = chrome.runtime.connectNative(HOST_NAME);

  port.onMessage.addListener((msg) => {
    const cb = pending.get(msg.reqId);
    if (cb) {
      pending.delete(msg.reqId);
      cb(msg);
    }
  });

  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message ?? "disconnected";
    console.warn("[AI Kwau] Native host disconnected:", err);
    // Reject all pending requests
    pending.forEach((cb) => cb({ status: "error", message: err }));
    pending.clear();
    port = null;
  });

  // Ping to confirm ready
  port.postMessage({ action: "ping", reqId: 0 });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== "summarize") return false;

  if (!port) connect();

  const id = ++reqCounter;
  pending.set(id, (resp) => reply(resp));

  port.postMessage({
    action: "summarize",
    text: msg.text,
    lang: msg.lang ?? "en",
    reqId: id,
  });

  return true; // keep reply channel open
});
