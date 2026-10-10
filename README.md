# Paper Wings

A one-button 3D paper-rocket endless flyer. Hold to rise, release to dive, steer with your pointer. Thread golden rings, graze blades for near-miss bonuses, don't fold.

**Every day has its own sky** — the palette, the wind, and the world are seeded from the date, so everyone flying that day flies the same sky. Come back tomorrow for a new one.

**Every run starts over a fresh slice of the city** — each takeoff slides the hanging map to a random stretch and a random phase through the tile, with a fresh slight yaw, so no two runs open on the same buildings. The spawn stays fair: always (0, 2, 0).

## Play

Open `index.html` on any static host (or the GitHub Pages URL). No build step, no keys, no server — plain ES modules + vendored three.js r170.

- **Hold** (click / touch / Space) → rise
- **Release** → dive
- **Move pointer left/right** → steer
- Crash into paper boxes, spinning blades, ring rims, floor, ceiling, or walls → folded.
- Score = meters + 50/ring + 10/near-miss, with silly ranks (Gust Guest → Wing Poet)
- Personal best saved in localStorage
- Silent by design — no audio assets, no audio engine

## Files

```
index.html        game shell + ad slots (banner on start, interstitial on game-over)
css/style.css
js/logic.js       pure game logic: seeded world gen, scoring, collision — node-testable
js/game.js        three.js scene: pooled obstacles, recycled scenery, input
js/main.js        bootstrap, game loop, UI states
js/ads.js         AdSense units (start banner, game-over interstitial)
js/share.js       canvas score card (1200×630) + Web Share / download
tests/logic.test.mjs   14 offline tests — `node tests/logic.test.mjs`
privacy.html      privacy policy (AdSense requirement)
ads.txt           placeholder until the publisher ID lands
```

## Ad revenue

Wired: AdSense script in `index.html` (publisher `ca-pub-9657119821733951`), a responsive banner in the start panel (`#bannerAd`), a fresh rectangle unit per game-over (`#interstitialAd`, the natural break between runs), `js/ads.js` for unit creation, and `ads.txt`. Units stay invisible/unfilled until Google's site review approves the site. `ads.txt` also needs to exist at the *domain root* (`awsdemo006yohei-afk.github.io/ads.txt`) per IAB spec — served from the separate user-site repo, since a project repo can't write above its own subpath.

## Tests

```
node tests/logic.test.mjs
```

14 tests: seeded RNG determinism, daily-theme stability, scoring math, rank bands, stretch planning in-bounds, collision/ring/near-miss geometry, difficulty + wind speed curves.
