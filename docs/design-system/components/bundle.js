/* @ds-bundle: {"format":4,"namespace":"Bullseye","components":[{"name":"SignalCard"},{"name":"ProvenanceBadge"},{"name":"EvidenceDrawer"},{"name":"InvestigationTimeline"},{"name":"ConfidenceIndicator"},{"name":"UnknownsPanel"},{"name":"BriefPaywall"},{"name":"PaymentState"},{"name":"EconomicsReceipt"},{"name":"PublicationGateResult"},{"name":"RadarHero"}]} */
/* Bullseye helper bundle. Vanilla DOM builders the previews use; the React app
   implements the same contract in TSX (see guidelines/40-implementation.md). */
(function () {
  'use strict';
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var PROV = {
    LIVE: { cls: 'live', dot: true, title: 'Fetched during this investigation.' },
    CACHED: { cls: 'cached', dot: true, title: 'Previous LIVE response, served because the source failed.' },
    HISTORICAL: { cls: 'historical', dot: true, title: 'Recording of a real past response or past chain state.' },
    FIXTURE: { cls: 'fixture', dot: true, title: 'Fixture. Not sourced from a real system.' },
    STALE: { cls: 'stale', glyph: '✕', title: 'Past usable age. Down-weighted.' },
    TESTNET: { cls: 'testnet', title: 'X Layer testnet. Not revenue.' }
  };

  /** ProvenanceBadge: returns HTML for one label. */
  function badge(kind, opts) {
    opts = opts || {};
    var p = PROV[kind] || { cls: 'historical', dot: true, title: '' };
    var inner = p.dot ? '<span class="be-dot" aria-hidden="true"></span>' : (p.glyph ? '<span aria-hidden="true">' + p.glyph + '</span>' : '');
    return '<span class="be-badge be-badge-' + p.cls + '" title="' + esc(opts.title || p.title) + '">' + inner + esc(kind) + '</span>';
  }

  /** Verdict glyph + word for a check status, coloured by status. */
  function verdict(kind) {
    var g = { PASS: '\u2713', FAIL: '\u2715', UNKNOWN: '?', STALE: '\u2715', RUNNING: '\u25D0' }[kind] || '\u25CB';
    return '<span class="v-' + kind.toLowerCase() + '"><span aria-hidden="true">' + g + '</span> ' + esc(kind) + '</span>';
  }

  var LEVELS = { LOW: 1, MEDIUM: 2, HIGH: 3 };

  /** ConfidenceIndicator: three arcs (LOW 1, MEDIUM 2, HIGH 3) plus the gate cap. opts {level, rationale?, cap?, withdrawn?, large?} */
  function confidence(el, opts) {
    var level = opts.withdrawn ? 'WITHDRAWN' : opts.level;
    var lit = opts.withdrawn ? 0 : (LEVELS[opts.level] || 0);
    var capped = !opts.withdrawn && opts.cap && LEVELS[opts.cap] < LEVELS[opts.level];
    var cls = opts.withdrawn ? 'withdrawn' : (level === 'HIGH' && !capped ? 'high' : 'medium');
    var r = 24, c = 2 * Math.PI * r, seg = c / 3, gap = 4;
    var arcs = '';
    for (var i = 0; i < 3; i++) {
      var on = i < lit, capMark = capped && i >= LEVELS[opts.cap];
      arcs += '<circle class="' + (on ? (capMark ? 'cap' : 'val') : 'track') + '" cx="28" cy="28" r="' + r + '" stroke-dasharray="' + (seg - gap).toFixed(1) + ' ' + (c - seg + gap).toFixed(1) + '" stroke-dashoffset="' + (-i * seg).toFixed(1) + '"/>';
    }
    el.className = 'be-conf c-' + cls + (opts.large ? ' is-lg' : '');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', opts.withdrawn ? 'Confidence withdrawn, not published' : 'Confidence ' + opts.level.toLowerCase() + (capped ? ', capped at ' + opts.cap.toLowerCase() : ''));
    el.innerHTML =
      '<span class="be-conf-ring">' +
        '<svg viewBox="0 0 56 56" aria-hidden="true">' + arcs + '</svg>' +
        '<span class="be-conf-num">' + (opts.withdrawn ? '\u2715' : lit) + '</span>' +
      '</span>' +
      '<span class="be-conf-text">' +
        '<span class="be-conf-band">' + esc(level) + (capped ? ' \u00B7 CAP ' + esc(opts.cap) : '') + '</span>' +
        (opts.rationale ? '<span class="be-conf-why">' + esc(opts.rationale) + '</span>' : '') +
        (capped ? '<span class="be-downrate">Capped at ' + esc(opts.cap) + ' by the publication gate' + (opts.capDetail ? ': ' + esc(opts.capDetail) : '') + '</span>' : '') +
      '</span>';
    return el;
  }

  /** RadarField: noisy events entering, one lock-on. opts {size, noise, lockAfterMs, onLock} */
  function radar(el, opts) {
    opts = opts || {};
    var size = opts.size || 480, n = opts.noise || 36, cx = size / 2, R = size / 2 - 8;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.className = 'be-radar';
    el.style.width = size + 'px'; el.style.height = size + 'px';
    var s = '<svg viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="Radar field: noisy events, one locked">';
    [0.25, 0.5, 0.75, 1].forEach(function (k) { s += '<circle class="grid" cx="' + cx + '" cy="' + cx + '" r="' + (R * k).toFixed(1) + '"/>'; });
    s += '<line class="grid" x1="' + cx + '" y1="8" x2="' + cx + '" y2="' + (size - 8) + '"/><line class="grid" x1="8" y1="' + cx + '" x2="' + (size - 8) + '" y2="' + cx + '"/>';
    s += '<path class="sweep" d="M' + cx + ' ' + cx + ' L' + cx + ' ' + (cx - R) + ' A' + R + ' ' + R + ' 0 0 1 ' + (cx + R * Math.sin(0.6)).toFixed(1) + ' ' + (cx - R * Math.cos(0.6)).toFixed(1) + ' Z"/>';
    s += '<g class="events"></g><g class="lock" style="opacity:0"></g></svg>';
    el.innerHTML = s;
    var ev = el.querySelector('.events'), lock = el.querySelector('.lock');
    var seed = 7; var rnd = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    var target = { x: cx + R * 0.42, y: cx - R * 0.31 };
    function addNoise(i) {
      var a = rnd() * Math.PI * 2, d = R * (0.15 + 0.82 * rnd());
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'noise'); c.setAttribute('r', '2.5');
      c.setAttribute('cx', (cx + d * Math.cos(a)).toFixed(1)); c.setAttribute('cy', (cx + d * Math.sin(a)).toFixed(1));
      c.style.opacity = '0'; c.style.transition = reduced ? 'none' : 'opacity 240ms ease-out';
      ev.appendChild(c); requestAnimationFrame(function () { c.style.opacity = '1'; });
    }
    var t = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    t.setAttribute('class', 'noise'); t.setAttribute('r', '2.5'); t.setAttribute('cx', target.x.toFixed(1)); t.setAttribute('cy', target.y.toFixed(1));
    function doLock() {
      t.setAttribute('class', 'target'); t.setAttribute('r', '3.5');
      lock.innerHTML =
        '<circle class="halo" cx="' + target.x.toFixed(1) + '" cy="' + target.y.toFixed(1) + '" r="34"/>' +
        '<circle class="reticle" cx="' + target.x.toFixed(1) + '" cy="' + target.y.toFixed(1) + '" r="22"/>' +
        '<circle class="reticle" cx="' + target.x.toFixed(1) + '" cy="' + target.y.toFixed(1) + '" r="11"/>' +
        '<line class="reticle" x1="' + (target.x - 30).toFixed(1) + '" y1="' + target.y.toFixed(1) + '" x2="' + (target.x - 16).toFixed(1) + '" y2="' + target.y.toFixed(1) + '"/>' +
        '<line class="reticle" x1="' + (target.x + 16).toFixed(1) + '" y1="' + target.y.toFixed(1) + '" x2="' + (target.x + 30).toFixed(1) + '" y2="' + target.y.toFixed(1) + '"/>' +
        '<line class="reticle" x1="' + target.x.toFixed(1) + '" y1="' + (target.y - 30).toFixed(1) + '" x2="' + target.x.toFixed(1) + '" y2="' + (target.y - 16).toFixed(1) + '"/>' +
        '<line class="reticle" x1="' + target.x.toFixed(1) + '" y1="' + (target.y + 16).toFixed(1) + '" x2="' + target.x.toFixed(1) + '" y2="' + (target.y + 30).toFixed(1) + '"/>';
      lock.style.transformOrigin = target.x + 'px ' + target.y + 'px';
      lock.style.transform = reduced ? 'none' : 'scale(1.4)';
      lock.style.transition = reduced ? 'none' : 'transform 320ms ease-out, opacity 320ms ease-out';
      requestAnimationFrame(function () { lock.style.opacity = '1'; lock.style.transform = 'scale(1)'; });
      var sw = el.querySelector('.sweep'); if (sw) sw.style.animationPlayState = 'paused';
      if (opts.onLock) opts.onLock(target);
    }
    var i = 0;
    var step = reduced ? 0 : 70;
    (function tick() {
      if (i < n) { addNoise(i++); if (i === Math.floor(n / 2)) ev.appendChild(t); if (step) setTimeout(tick, step); else tick(); }
      else setTimeout(doLock, reduced ? 0 : (opts.lockAfterMs || 900));
    })();
    return el;
  }

  window.Bullseye = { badge: badge, verdict: verdict, confidence: confidence, radar: radar, esc: esc };
})();
