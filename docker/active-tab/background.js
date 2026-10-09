// Tells the box the URL of the tab in front of the window last in front, every time it may have
// changed. The server reads it (box-host `GET /v1/chrome/active-tab`) before it types a saved
// login, and types nothing when the page in front is not the login's own site: on a computer
// several Bots share, another Bot may have brought its own page forward.
//
// Only the `tabs` permission: the URL and nothing of the page, its cookies or its storage.
// An open native port also keeps this service worker alive.
const HOST = "dev.opengrok.active_tab";
let port = null;

function connect() {
  port = chrome.runtime.connectNative(HOST);
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connect, 1000);
  });
  report();
}

async function report() {
  if (!port) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  try {
    port.postMessage({ url: tab ? tab.url || tab.pendingUrl || "" : "" });
  } catch (_) {
    // The port closed between the check and the send; onDisconnect reconnects.
  }
}

chrome.tabs.onActivated.addListener(report);
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (tab.active && (change.url || change.status)) report();
});
chrome.tabs.onRemoved.addListener(report);
chrome.windows.onFocusChanged.addListener(report);
connect();
