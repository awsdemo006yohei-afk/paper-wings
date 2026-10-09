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
  for (const [cx, cy, w] of [[120, 120, 130], [900, 90, 170], [960, 300, 110]]) {
    rounded(x, cx, cy, w, 26, 13); x.fill();
  }
  // sun
  x.fillStyle = palette.sun;
  x.beginPath(); x.arc(1040, 500, 46, 0, Math.PI * 2); x.fill();

  // paper plane silhouette, dead center of the card, nose vertically up —
  // the text column stays left of x≈430 so the middle stays clear (#572)
  x.strokeStyle = '#fff'; x.lineWidth = 7; x.lineJoin = 'round';
  x.beginPath();
  x.moveTo(600, 240); x.lineTo(520, 455); x.lineTo(600, 400); x.lineTo(680, 455);
  x.closePath(); x.stroke();
  x.beginPath(); // center fold
  x.moveTo(600, 240); x.lineTo(600, 400);
  x.stroke();

  x.fillStyle = '#fff';
  x.font = '600 44px system-ui, sans-serif';
  x.fillText(`Today's sky: ${themeName}`, 80, 110);

  x.font = '800 150px system-ui, sans-serif';
  x.fillText(String(score.total), 80, 300);
  x.font = '500 40px system-ui, sans-serif';
  x.fillText(rank, 82, 370); // split so the middle column stays clear for the plane
  x.fillText(`${Math.floor(score.distance)} m · ${score.rings} rings`, 82, 418);

  x.font = '600 34px system-ui, sans-serif';
  x.fillText(best > 0 ? `personal best ${best}` : 'first flight!', 82, 468);
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
