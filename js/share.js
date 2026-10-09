// Paper Wings — shareable score card. Canvas-rendered PNG, no assets.

export function renderCard({ themeName, palette, score, best, rank, url }) {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 630;
  const x = c.getContext('2d');

  const grad = x.createLinearGradient(0, 0, 0, 630);
  grad.addColorStop(0, palette.skyTop);
  grad.addColorStop(1, palette.skyBot);
  x.fillStyle = grad;
  x.fillRect(0, 0, 1200, 630);

  // paper clouds
  x.fillStyle = 'rgba(255,255,255,.85)';
  for (const [cx, cy, w] of [[120, 120, 130], [900, 90, 170], [640, 480, 110]]) {
    rounded(x, cx, cy, w, 26, 13); x.fill();
  }
  // sun
  x.fillStyle = palette.sun;
  x.beginPath(); x.arc(1040, 500, 46, 0, Math.PI * 2); x.fill();

  // paper plane silhouette, middle-right — the text column owns the left
  x.strokeStyle = '#fff'; x.lineWidth = 7; x.lineJoin = 'round';
  x.beginPath();
  x.moveTo(770, 520); x.lineTo(950, 430); x.lineTo(855, 470); x.lineTo(900, 560);
  x.closePath(); x.stroke();

  x.fillStyle = '#fff';
  x.font = '600 44px system-ui, sans-serif';
  x.fillText(`Today's sky: ${themeName}`, 80, 110);

  x.font = '800 150px system-ui, sans-serif';
  x.fillText(String(score.total), 80, 300);
  x.font = '500 40px system-ui, sans-serif';
  x.fillText(`${rank} — ${Math.floor(score.distance)} m · ${score.rings} rings`, 82, 370);

  x.font = '600 34px system-ui, sans-serif';
  x.fillText(best > 0 ? `personal best ${best}` : 'first flight!', 82, 430);
  x.font = '500 30px system-ui, sans-serif';
  x.globalAlpha = 0.9;
  x.fillText(url.replace(/^https?:\/\//, ''), 82, 560);

  return c;
}

function rounded(x, px, py, w, h, r) {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}

/** The card as a PNG blob. */
export function canvasBlob(card) {
  return new Promise((res) => card.toBlob(res, 'image/png'));
}

/** Save the card as a file. */
export function downloadCard(card) {
  return canvasBlob(card).then((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'paper-wings-score.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}

/** Native share sheet (mobile-friendly), fall back to a download. */
export async function shareCard(card, text) {
  const blob = await canvasBlob(card);
  const file = new File([blob], 'paper-wings.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Paper Wings', text });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  await downloadCard(card);
  return 'downloaded';
}
