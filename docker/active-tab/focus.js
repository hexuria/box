// Tells the extension what kind of box has focus on this page: a password box, another place
// to type text, or none. The server reads it (with the page in front) before it types each
// value of a login, and types a password only into a password box: on 10 Oct 2026 a fill
// whose click missed typed a password into Facebook's email box and pressed Log in.
//
// Only the kind is sent, never what is in the box or anything else of the page.
function kind() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return "none";
  if (el.tagName === "INPUT") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "password") return "password";
    const text = ["text", "email", "tel", "search", "url", "number"];
    return text.includes(type) ? "text" : "other";
  }
  if (el.tagName === "TEXTAREA" || el.isContentEditable) return "text";
  return "other";
}

function tell() {
  try {
    chrome.runtime.sendMessage({ focus: kind() });
  } catch (_) {
    // The extension was reloaded under this page; the next page load reconnects.
  }
}

// After focus moves, not during: on focusout the new element is not focused yet.
const later = () => setTimeout(tell, 0);
document.addEventListener("focusin", later, true);
document.addEventListener("focusout", later, true);
// A type changed in place (a "show password" toggle) is a different kind of box.
document.addEventListener("input", later, true);
tell();
