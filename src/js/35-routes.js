/* ===================== 35 · route heatmap =====================
   Every GPS track drawn on top of every other one over a minimal,
   high-contrast monochrome canvas basemap (World Light Gray in light mode,
   World Dark Gray in dark mode) with a CSS grayscale filter for guaranteed
   pure black-and-white street context without needing an API key.
   ========================================================================= */

let routeView = null;   // { routes, canvas, ctx, dpr, base:{cx,cy,scale}, pan:{x,y}, zoom, wrap }

function isDarkTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function mercatorProject(lat, lon) {
  const sin = Math.sin((lat * Math.PI) / 180);
  const clampedSin = Math.max(-0.9999, Math.min(0.9999, sin));
  const x = (lon + 180) / 360;
  const y = 0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI);
  return [x, y];
}

function renderRoutes() {
  const v = $('#v-routes');
  if (!App.ready) { v.innerHTML = emptyState(); return; }

  const all = App.routes || [];
  if (!all.length) {
    const zipped = App.meta && App.meta.isZip;
    v.innerHTML = '<div class="sechead"><h1>Routes</h1>' +
      '<p class="sub">Every path you have run, layered on top of itself. Roads and trails you return to draw themselves in, darker with every pass.</p></div>' +
      '<div class="note">' + (zipped
        ? 'No GPS tracks were found in that zip \u2014 either these workouts predate route recording, or they were logged without location.'
        : 'This needs the GPS tracks Apple keeps in <span class="num">workout-routes/</span>, which only exist inside the full export <strong>zip</strong> \u2014 a bare <span class="num">export.xml</span> does not carry them.') +
      '</div><div class="row" style="margin-top:12px"><button class="btn pri" type="button" onclick="go(\'import\')">Go to Import</button></div>';
    return;
  }

  const st = loadSettings();
  const period = st.routePeriod || 'all';
  const showMap = st.routeMap !== false;

  let h = '<div class="sechead"><h1>Routes</h1>' +
    '<p class="sub">Every GPS track laid on top of the others. A street you run once stays faint; one you return to again and again goes bold \u2014 that is overlap, not a map.</p></div>';

  h += '<div class="panel"><div class="ph"><h3>Run history</h3>' +
    '<div class="seg" role="group" aria-label="Period" id="rtPeriod">' +
    [['all', 'All time'], ['1y', 'Last year'], ['90d', 'Last 90 days']]
      .map(([k, l]) => '<button type="button" data-period="' + k + '" aria-pressed="' + (period === k) + '">' + l + '</button>').join('') +
    '</div></div><div class="pb">' +
    '<div class="routewrap" id="rtWrap">' +
    '<div class="routemap" id="rtMap" aria-hidden="true"><div class="routemap-pane" id="rtMapPane"></div></div>' +
    '<canvas id="rtCanvas"></canvas>' +
    '<div class="routezoom">' +
    '<button type="button" id="rtIn" aria-label="Zoom in">+</button>' +
    '<button type="button" id="rtOut" aria-label="Zoom out">\u2212</button>' +
    '<button type="button" id="rtFit" aria-label="Fit to routes">\u21bb</button>' +
    '<button type="button" id="rtMapToggle" aria-label="Toggle basemap" title="Toggle basemap" aria-pressed="' + showMap + '">\ud83d\uddfa</button>' +
    '</div>' +
    '<div class="routeattr" id="rtAttr" aria-label="Map attribution">Tiles &copy;&nbsp;<a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, &copy;&nbsp;<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></div>' +
    '</div>' +
    '<div class="routebar" id="rtStats"></div>' +
    '<p class="tiny" style="margin-top:8px">Drag to pan, scroll or pinch to zoom. High-contrast street canvas underneath \u2014 no API key needed.' +
    (App.meta && App.meta.routesCapped ? ' Capped at the ' + App.meta.routesUsed + ' most recent routes of ' + App.meta.routesFound + ' found.' : '') + '</p>' +
    '</div></div>';

  v.innerHTML = h;

  $$('#rtPeriod button').forEach(b => b.addEventListener('click', () => {
    saveSettings({ routePeriod: b.getAttribute('data-period') });
    renderRoutes();
  }));

  const cutoff = period === '1y' ? Date.now() - 365 * DAY : period === '90d' ? Date.now() - 90 * DAY : 0;
  const shown = cutoff ? all.filter(r => r.date && r.date >= cutoff) : all;
  setupRouteCanvas(shown, all.length);
}

function setupRouteCanvas(routes, totalAll) {
  const wrap = $('#rtWrap'), canvas = $('#rtCanvas');
  const stats = $('#rtStats');
  if (!wrap || !canvas) return;

  if (!routes.length) {
    stats.innerHTML = '<span class="pill">No routes in this period</span>';
    const ctx = canvas.getContext('2d');
    canvas.width = wrap.clientWidth; canvas.height = 360;
    return;
  }

  const st = loadSettings();
  let showMap = st.routeMap !== false;

  /* ---- project lat/lon to standard Web Mercator (EPSG:3857) normalized [0, 1] -- */
  let latSum = 0, n = 0;
  for (const r of routes) { for (let i = 0; i < r.pts.length; i += 2) { latSum += r.pts[i]; n++; } }
  const lat0 = latSum / n;
  const C = 40075016.686; // Earth circumference in meters
  const mPerCoord = C * Math.cos((lat0 * Math.PI) / 180);

  const world = routes.map(r => {
    const w = new Float32Array(r.pts.length);
    for (let i = 0; i < r.pts.length; i += 2) {
      const [x, y] = mercatorProject(r.pts[i], r.pts[i + 1]);
      w[i] = x; w[i + 1] = y;
    }
    return w;
  });

  /* ---- fit to where you actually run, not to the furthest outlier -------
     A handful of one-off routes \u2014 a race in another city, a run on holiday
     \u2014 can sit tens of kilometres from everything else. Fitting the view to
     their combined bounding box shrinks the routes someone actually cares
     about (their regular loops) down to a few faint pixels. So the fit is built
     from each route's OWN centroid: find the median centroid, and use only routes
     within a reasonable distance of it. Distant one-offs are still drawn \u2014 pan out
     and they're there \u2014 they just do not get to decide the default zoom level. */
  const centroids = world.map(w => {
    let sx = 0, sy = 0, m = w.length / 2;
    for (let i = 0; i < w.length; i += 2) { sx += w[i]; sy += w[i + 1]; }
    return { x: sx / m, y: sy / m };
  });
  const medOf = arr => { const s = arr.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
  const medX = medOf(centroids.map(c => c.x)), medY = medOf(centroids.map(c => c.y));
  const distFromMed = centroids.map(c => Math.hypot((c.x - medX) * mPerCoord, (c.y - medY) * mPerCoord));
  const sortedDist = distFromMed.slice().sort((a, b) => a - b);
  // the 85th-percentile distance, with a higher floor (3km) so local runs
  // across town aren't prematurely excluded as outliers
  const cutoff = Math.max(3000, sortedDist.length ? sortedDist[Math.floor(sortedDist.length * 0.85)] : Infinity);
  const clusterIdx = world.length >= 6 ? distFromMed.map((d, i) => d <= cutoff ? i : -1).filter(i => i >= 0) : world.map((_, i) => i);
  const clusterSet = clusterIdx.length >= Math.max(3, world.length * 0.3) ? new Set(clusterIdx) : null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  world.forEach((w, idx) => {
    if (clusterSet && !clusterSet.has(idx)) return;
    for (let i = 0; i < w.length; i += 2) {
      const x = w[i], y = w[i + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  });
  const minSpan = 80 / C;
  const bw = Math.max(minSpan, maxX - minX), bh = Math.max(minSpan, maxY - minY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const trimmed = clusterSet ? world.length - clusterSet.size : 0;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const p = palette();

  const state = { pan: { x: 0, y: 0 }, zoom: 1 };
  const tilePool = new Map();
  routeView = { routes: world, wrap, canvas, dpr, cx, cy, bw, bh, state, lenKm: sum(routes.map(r => r.len || 0)) / 1000, trimmed };

  function updateTiles(w, hh, scale, ox, oy) {
    const mapEl = $('#rtMap'), pane = $('#rtMapPane');
    if (!mapEl || !pane || typeof Image === 'undefined') return;

    if (!showMap) {
      mapEl.classList.add('off');
      const attr = $('#rtAttr');
      if (attr) attr.classList.add('off');
      return;
    }
    mapEl.classList.remove('off');
    const attr = $('#rtAttr');
    if (attr) attr.classList.remove('off');

    const dark = isDarkTheme();
    const service = dark ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base';

    const Z = Math.log2(scale / 256);
    const z = clamp(Math.round(Z), 0, 18);
    const nTiles = Math.pow(2, z);
    const tileSize = (1 / nTiles) * scale;

    const invScale = 1 / scale;
    const xMin = cx - ox * invScale, xMax = cx + (w - ox) * invScale;
    const yMin = cy - oy * invScale, yMax = cy + (hh - oy) * invScale;

    const txMin = Math.floor(xMin * nTiles);
    const txMax = Math.floor(xMax * nTiles);
    const tyMin = Math.max(0, Math.floor(yMin * nTiles));
    const tyMax = Math.min(nTiles - 1, Math.floor(yMax * nTiles));

    const visibleKeys = new Set();
    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const wrappedTx = ((tx % nTiles) + nTiles) % nTiles;
        const key = service + '-' + z + '-' + wrappedTx + '-' + ty;
        visibleKeys.add(key);

        const left = Math.round((tx / nTiles - cx) * scale + ox);
        const top = Math.round((ty / nTiles - cy) * scale + oy);
        const sz = Math.ceil(tileSize);

        let img = tilePool.get(key);
        if (!img) {
          img = document.createElement('img');
          img.className = 'routemap-tile';
          img.alt = '';
          img.decoding = 'async';
          img.src = 'https://services.arcgisonline.com/arcgis/rest/services/Canvas/' + service + '/MapServer/tile/' + z + '/' + ty + '/' + wrappedTx;
          pane.appendChild(img);
          tilePool.set(key, img);
        }
        img.style.left = left + 'px';
        img.style.top = top + 'px';
        img.style.width = sz + 'px';
        img.style.height = sz + 'px';
      }
    }

    for (const [k, img] of tilePool.entries()) {
      if (!visibleKeys.has(k)) {
        img.remove();
        tilePool.delete(k);
      }
    }
  }

  function fit() {
    const width = wrap.clientWidth || 320, height = Math.max(320, Math.min(560, width * 0.72));
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    routeView.viewW = width; routeView.viewH = height;
    routeView.base = Math.min((width * 0.68) / bw, (height * 0.68) / bh);
    state.pan.x = 0; state.pan.y = 0; state.zoom = 1;
    draw();
  }

  function draw() {
    try {
      const ctx = canvas.getContext('2d');
      const { viewW: w, viewH: hh } = routeView;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, hh);

      const mapEl = $('#rtMap');
      const isMapActive = showMap && Boolean(mapEl) && typeof Image !== 'undefined';
      if (!isMapActive) {
        ctx.fillStyle = p.surf;
        ctx.fillRect(0, 0, w, hh);
      }

      const scale = routeView.base * state.zoom;
      const ox = w / 2 + state.pan.x, oy = hh / 2 + state.pan.y;

      updateTiles(w, hh, scale, ox, oy);

      /* Dynamic opacity with an increased range: a high floor (0.28) ensures
         even large multi-year histories have bold, punchy single passes without fading,
         while small route sets scale up to 0.82 for immediate vibrancy.
         A shadow blur adds a warm, luminous glow around each route track. */
      const MIN_ALPHA = 0.28, MAX_ALPHA = 0.82;
      const count = Math.max(1, world.length);
      ctx.globalAlpha = clamp(MAX_ALPHA / Math.pow(count, 0.26), MIN_ALPHA, MAX_ALPHA);
      ctx.strokeStyle = p.clay || '#A8412C';
      ctx.shadowColor = p.clay || '#E0705A';
      ctx.shadowBlur = clamp(2.2 / Math.sqrt(state.zoom), 1.0, 3.5);
      ctx.lineWidth = clamp(1.1 / Math.sqrt(state.zoom), 0.6, 1.6);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';

      // canvas clips off-screen coordinates on its own; no need to fragment
      // a path into disconnected moveTo-only segments to "help" it.
      for (const wpts of world) {
        if (wpts.length < 4) continue;
        ctx.beginPath();
        for (let i = 0; i < wpts.length; i += 2) {
          const x = (wpts[i] - cx) * scale + ox, y = (wpts[i + 1] - cy) * scale + oy;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    } catch (e) {
      // A silent failure here used to look identical to "nothing to draw" \u2014
      // paint the background at least, and say plainly that something broke
      // rather than leaving an unexplained blank canvas.
      console.error('route heatmap draw failed', e);
      try {
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = p.surf; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = p.ink3 || '#888'; ctx.font = '13px sans-serif';
        ctx.fillText('Could not draw the route map \u2014 see the console for details.', 14, 24);
      } catch (e2) { /* nothing more we can do */ }
    }
  }

  routeView.draw = draw;
  routeView.zoomBy = (f, atX, atY) => {
    const prev = state.zoom;
    state.zoom = clamp(state.zoom * f, 0.2, 40);
    if (atX != null) {
      const k = state.zoom / prev;
      state.pan.x = atX - (atX - state.pan.x) * k;
      state.pan.y = atY - (atY - state.pan.y) * k;
    }
    draw();
  };

  fit();

  /* stats readout */
  const days = new Set(routes.map(r => r.date ? Math.floor(r.date / DAY) : null).filter(x => x !== null));
  stats.innerHTML =
    '<span class="pill">' + routes.length + ' of ' + totalAll + ' routes</span>' +
    '<span class="pill">' + dist(routeView.lenKm * 1000, 0) + ' ' + uName() + ' of track</span>' +
    (days.size ? '<span class="pill">' + days.size + ' distinct days</span>' : '') +
    (routeView.trimmed ? '<span class="pill" title="Zoomed to your main cluster. Pan out to find them.">' + routeView.trimmed + ' far-off route' + (routeView.trimmed === 1 ? '' : 's') + ' outside this view</span>' : '');

  /* ---- interaction: pointer drag to pan, wheel to zoom ------------------ */
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    state.pan.x += e.clientX - lastX; state.pan.y += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    draw();
  });
  const stopDrag = () => { dragging = false; };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('pointerleave', stopDrag);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    routeView.zoomBy(Math.pow(1.0015, -e.deltaY), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  $('#rtIn').addEventListener('click', () => routeView.zoomBy(1.4));
  $('#rtOut').addEventListener('click', () => routeView.zoomBy(1 / 1.4));
  $('#rtFit').addEventListener('click', fit);

  const mapToggle = $('#rtMapToggle');
  if (mapToggle) {
    mapToggle.addEventListener('click', () => {
      showMap = !showMap;
      saveSettings({ routeMap: showMap });
      mapToggle.setAttribute('aria-pressed', String(showMap));
      draw();
    });
  }

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => fit());
    ro.observe(wrap);
    routeView.ro = ro;
  }
}
