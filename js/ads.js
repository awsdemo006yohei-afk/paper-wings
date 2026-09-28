// Paper Wings — AdSense wiring. The publisher ID is public page code.
//
// AdSense's `push()` throws synchronously (TagError) when the target <ins>
// has zero available width — e.g. inside a still-hidden panel. That exception
// must never reach game code, so: pushes only happen after layout confirms
// the slot has width, and every push is wrapped.

const CLIENT = 'ca-pub-9657119821733951';

function unit(format) {
  const el = document.createElement('ins');
  el.className = 'adsbygoogle';
  el.style.display = 'block';
  el.dataset.adClient = CLIENT;
  el.dataset.adFormat = format;
  el.dataset.fullWidthResponsive = 'true';
  return el;
}

/** Request an ad for a slot that is actually laid out; never throw. */
function request(u) {
  requestAnimationFrame(() => {
    if (u.clientWidth <= 0) return; // hidden/unlaid-out — AdSense would throw
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {} // even a misbehaving script must not take the game down
  });
}

/** Fill the start-panel banner once. */
export function showBanner(container) {
  if (!container || container.dataset.done) return;
  container.dataset.done = '1';
  const u = unit('auto');
  container.appendChild(u);
  request(u);
}

/** Fresh unit per game-over — call only after the over panel is visible. */
export function showInterstitial(container) {
  if (!container) return;
  const u = unit('rectangle');
  container.replaceChildren(u);
  request(u);
}
