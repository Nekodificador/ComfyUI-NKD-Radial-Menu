/**
 * nkdRadial — Maya-style two-level marking menu.
 * Zero dependencies, vanilla JS, canvas-based. MIT.
 *
 * cfg.style: 'donut' (rounded sectors, abbreviated labels, center preview)
 *            'pills' (floating pill buttons with Maya-style alignment)
 *
 * Fixed 8-slot layout (NE,E,SE,S,SW,W,NW,N) for muscle memory.
 * L2 overflow (>7 ring items) spills into a vertical list in the gesture direction.
 *
 * ponytail: single-file, no build step, copy-paste into any project.
 */
(function (root) {
  'use strict';

  function nkdRadial(evt, cfg) {
    var cats = cfg.categories || [];
    if (!cats.length) return function () {};

    function valLabel(v) { return typeof v === 'string' ? v : v.label || ''; }
    function valIcon(v) { return typeof v === 'object' && v.icon ? v.icon : null; }
    function valLabels(arr) { var r = []; for (var i = 0; i < arr.length; i++) r.push(valLabel(arr[i])); return r; }
    function valIcons(arr) { var r = []; for (var i = 0; i < arr.length; i++) r.push(valIcon(arr[i])); return r; }

    var onSelect = cfg.onSelect || function () {};
    var onCancel = cfg.onCancel || function () {};
    var STYLE = cfg.style || 'donut';
    var MONO = cfg.mono || null; // single color for all menus
    var R = cfg.radius || [36, 48, 90];
    var R_CENTER = R[0], R_IN = R[1], R_OUT = R[2];
    var CORNER = cfg.corner != null ? cfg.corner : 6;
    var GAP = cfg.gap != null ? cfg.gap : 0.06;
    var DPR = cfg.scale || (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1);

    // built-in palettes (8 colors each, cycled if more categories)
    var PALETTES = {
      nkd:    ['#4ab4ff','#51cf66','#cc5de8','#e8c547','#d97a47','#7fd4e8','#ff6b6b','#f0a64f'],
      ink:    ['#2A2C2F','#2A2C2F','#2A2C2F','#2A2C2F','#2A2C2F','#2A2C2F','#2A2C2F','#2A2C2F'],
      paper:  ['#E2E2DF','#E2E2DF','#E2E2DF','#E2E2DF','#E2E2DF','#E2E2DF','#E2E2DF','#E2E2DF'],
      warm:   ['#d97a47','#e09a73','#e8c547','#f0a64f','#ff6b6b','#cc6633','#ffd43b','#c08552'],
      cool:   ['#4ab4ff','#51cf66','#cc5de8','#7fd4e8','#5fd6e0','#2f8fd6','#7fffd4','#4dabf7'],
    };
    var palette = cfg.palette ? (typeof cfg.palette === 'string' ? PALETTES[cfg.palette] : cfg.palette) : null;

    // apply mono or palette colors (override existing)
    if (MONO) {
      for (var i = 0; i < cats.length; i++) cats[i] = Object.assign({}, cats[i], { color: MONO });
    } else if (palette) {
      for (var i = 0; i < cats.length; i++) cats[i] = Object.assign({}, cats[i], { color: palette[i % palette.length] });
    }

    // luminance-aware text color (paper pills get dark text, ink pills get light)
    function lum(hex) {
      var r = parseInt(hex.slice(1, 3), 16) / 255;
      var g = parseInt(hex.slice(3, 5), 16) / 255;
      var b = parseInt(hex.slice(5, 7), 16) / 255;
      r = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
      g = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
      b = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    function textFor(bgHex, hovered) {
      var light = lum(bgHex) > 0.4;
      if (hovered) return light ? '#0C0C0D' : '#fff';
      return light ? '#1D1F21' : '#ddd';
    }

    var ICONS = nkdRadial.ICONS || {};

    function drawIcon(cx, cy, size, iconName, color) {
      var paths = ICONS[iconName];
      if (!paths) return false;
      var s = size / 24;
      ctx.save();
      ctx.translate(cx - size / 2, cy - size / 2);
      ctx.scale(s, s);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 / s * s;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.fillStyle = 'none';
      for (var i = 0; i < paths.length; i++) {
        var p = new Path2D(paths[i]);
        ctx.stroke(p);
      }
      ctx.restore();
      return true;
    }

    // pills config
    var PILL_H = 26, PILL_R = 4, PILL_PAD = 12, PILL_FONT = 13;
    var MAX_RING = 8;

    // --- Fixed 8-slot layout (Maya cardinal+ordinal) ---
    // CW from NE: NE(0) E(1) SE(2) S(3) SW(4) W(5) NW(6) N(7)
    var SLOT = [
      -Math.PI / 4,         // 0: NE
      0,                     // 1: E
      Math.PI / 4,           // 2: SE
      Math.PI / 2,           // 3: S
      3 * Math.PI / 4,       // 4: SW
      Math.PI,               // 5: W
      -3 * Math.PI / 4,      // 6: NW
      -Math.PI / 2           // 7: N
    ];
    var SLOT_SPAN = Math.PI / 4;

    // L2 fill orders: right-side CW, left-side CCW (mirror), up CW from 12, down CW from 6
    var FILL_RIGHT = [0, 1, 2, 3, 4, 5, 6, 7];
    var FILL_LEFT  = [6, 5, 4, 3, 2, 1, 0, 7];
    var FILL_UP    = [7, 0, 1, 2, 3, 4, 5, 6];
    var FILL_DOWN  = [3, 4, 5, 6, 7, 0, 1, 2];

    function fillOrderForL1(l1Idx) {
      if (l1Idx === 7) return FILL_UP;
      if (l1Idx === 3) return FILL_DOWN;
      if (l1Idx <= 2) return FILL_RIGHT;
      return FILL_LEFT; // 4,5,6
    }

    function slotAngleFn(indices) {
      return function (i) {
        if (i >= indices.length) return [0, 0, 0];
        var c = SLOT[indices[i]];
        return [c - SLOT_SPAN / 2 + GAP / 2, c + SLOT_SPAN / 2 - GAP / 2, c];
      };
    }

    // state
    var level = 1;
    var hoverIdx = -1;
    var activeL1 = -1;
    var originX = evt.clientX, originY = evt.clientY;
    var l2CenterX = 0, l2CenterY = 0;
    var mx = originX, my = originY;
    var dead = false;

    // L1: first N slots, CW from NE
    var l1N = Math.min(cats.length, MAX_RING);
    var l1SlotIdx = FILL_RIGHT.slice(0, l1N);
    var l1Angles = slotAngleFn(l1SlotIdx);

    // L2: built on drill
    var l2SlotIdx = [];
    var l2Angles = null;

    function buildL2Layout() {
      var order = fillOrderForL1(l1SlotIdx[activeL1]);
      var backAngle = Math.atan2(originY - l2CenterY, originX - l2CenterX);
      var backPos = 0, bestD = Infinity;
      for (var s = 0; s < order.length; s++) {
        var d = Math.abs(normAngle(SLOT[order[s]], backAngle) - backAngle);
        if (d < bestD) { bestD = d; backPos = s; }
      }
      l2SlotIdx = [];
      for (var s = 0; s < order.length; s++) {
        if (s !== backPos) l2SlotIdx.push(order[s]);
      }
      l2Angles = slotAngleFn(l2SlotIdx);
    }

    // --- DOM: full-viewport canvas ---
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;cursor:crosshair;';
    var cv = document.createElement('canvas');
    var vw = window.innerWidth, vh = window.innerHeight;
    cv.width = Math.round(vw * DPR);
    cv.height = Math.round(vh * DPR);
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    overlay.appendChild(cv);
    document.body.appendChild(overlay);

    var ctx = cv.getContext('2d');
    ctx.scale(DPR, DPR);

    // --- helpers ---
    function hexRgb(h) {
      return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    }
    function rgba(hex, a) {
      var c = hexRgb(hex);
      return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    }
    function isDark() {
      if (cfg.dark != null) return cfg.dark;
      var el = document.documentElement;
      if (el.getAttribute('data-mode') === 'dark' || el.getAttribute('data-theme') === 'dark') return true;
      if (el.getAttribute('data-mode') === 'light' || el.getAttribute('data-theme') === 'light') return false;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme:dark)').matches;
    }
    function normAngle(a, ref) {
      while (a < ref - Math.PI) a += Math.PI * 2;
      while (a > ref + Math.PI) a -= Math.PI * 2;
      return a;
    }

    // --- dynamic radius ---
    var ABBREV = 4;
    var l1ROut = R_OUT, l2ROut = R_OUT;

    function calcOuterR_donut(labels) {
      var fs = 10;
      ctx.font = '400 ' + fs + 'px system-ui,sans-serif';
      var maxW = 0;
      for (var i = 0; i < labels.length; i++) {
        var t = labels[i].length > ABBREV ? labels[i].slice(0, ABBREV) : labels[i];
        var w = ctx.measureText(t).width;
        if (w > maxW) maxW = w;
      }
      var sliceAngle = SLOT_SPAN - GAP;
      var needed = 2 * (maxW + 6) / sliceAngle - R_IN;
      return Math.max(R_OUT, Math.ceil(needed));
    }

    function calcOuterR_pills(labels) {
      ctx.font = '500 ' + PILL_FONT + 'px system-ui,sans-serif';
      var maxW = 0;
      for (var i = 0; i < labels.length; i++) {
        var w = ctx.measureText(labels[i]).width + PILL_PAD * 2;
        if (w > maxW) maxW = w;
      }
      var sliceAngle = SLOT_SPAN - GAP;
      var needed = (PILL_H + 4) / (2 * Math.sin(sliceAngle / 2));
      return Math.max(R_OUT, Math.ceil(needed));
    }

    var calcOuterR = STYLE === 'pills' ? calcOuterR_pills : calcOuterR_donut;

    (function () {
      var ll = [];
      for (var i = 0; i < cats.length; i++) ll.push(cats[i].label);
      l1ROut = calcOuterR(ll);
    })();

    // --- rounded sector path (donut mode) ---
    function roundedSector(cx, cy, rIn, rOut, a0, a1, cr) {
      var da = a1 - a0;
      if (da < 0.01) { ctx.beginPath(); return; }
      var c = Math.min(cr, (rOut - rIn) / 3, da * rIn / 3, da * rOut / 3);
      var oOff = c / rOut, iOff = c / rIn;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a0 + oOff) * rOut, cy + Math.sin(a0 + oOff) * rOut);
      ctx.arc(cx, cy, rOut, a0 + oOff, a1 - oOff);
      var p1x = cx + Math.cos(a1) * rOut, p1y = cy + Math.sin(a1) * rOut;
      var p2x = cx + Math.cos(a1) * rIn, p2y = cy + Math.sin(a1) * rIn;
      ctx.arcTo(p1x, p1y, p2x, p2y, c);
      ctx.arcTo(p2x, p2y, cx + Math.cos(a1 - iOff) * rIn, cy + Math.sin(a1 - iOff) * rIn, c);
      ctx.arc(cx, cy, rIn, a1 - iOff, a0 + iOff, true);
      var p3x = cx + Math.cos(a0) * rIn, p3y = cy + Math.sin(a0) * rIn;
      var p4x = cx + Math.cos(a0) * rOut, p4y = cy + Math.sin(a0) * rOut;
      ctx.arcTo(p3x, p3y, p4x, p4y, c);
      ctx.arcTo(p4x, p4y, cx + Math.cos(a0 + oOff) * rOut, cy + Math.sin(a0 + oOff) * rOut, c);
      ctx.closePath();
    }

    // --- rounded rect helper ---
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    }

    // --- center circle ---
    function drawCenter(cx, cy, previewText, color, dk) {
      ctx.beginPath();
      ctx.arc(cx, cy, R_CENTER, 0, Math.PI * 2);
      ctx.fillStyle = dk ? 'rgba(18,18,18,0.95)' : 'rgba(250,250,250,0.97)';
      ctx.fill();
      ctx.strokeStyle = color ? rgba(color, 0.4) : (dk ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)');
      ctx.lineWidth = color ? 2 : 1;
      ctx.stroke();

      if (previewText) {
        var fontSize = previewText.length > 14 ? 10 : previewText.length > 8 ? 12 : 14;
        ctx.font = '600 ' + fontSize + 'px system-ui,sans-serif';
        ctx.textAlign = 'center';
        var centerText = dk ? '#ddd' : '#444';
        if (color) {
          var cl = lum(color);
          centerText = dk ? (cl < 0.15 ? '#ddd' : color) : (cl > 0.6 ? '#444' : color);
        }
        ctx.fillStyle = centerText;
        var maxW = R_CENTER * 1.6;
        var tw = ctx.measureText(previewText).width;
        if (tw > maxW && previewText.indexOf(' ') >= 0) {
          var words = previewText.split(' ');
          var lines = [], cur = words[0];
          for (var wi = 1; wi < words.length; wi++) {
            var test = cur + ' ' + words[wi];
            if (ctx.measureText(test).width > maxW) { lines.push(cur); cur = words[wi]; }
            else cur = test;
          }
          lines.push(cur);
          var lh = fontSize * 1.3;
          var topY = cy - (lines.length - 1) * lh / 2;
          ctx.textBaseline = 'middle';
          for (var li = 0; li < lines.length; li++) ctx.fillText(lines[li], cx, topY + li * lh);
        } else {
          ctx.textBaseline = 'middle';
          ctx.fillText(previewText, cx, cy);
        }
      }
    }

    // --- draw donut ring ---
    function drawDonutRing(cx, cy, items, colors, angleFn, hover, dk, rOuter, icons) {
      var ro = rOuter || R_OUT;
      var fs = 11;
      for (var i = 0; i < items.length; i++) {
        var a = angleFn(i);
        var hv = hover === i;
        var color = typeof colors === 'string' ? colors : colors[i];
        var rOut = hv ? ro + 3 : ro;

        roundedSector(cx, cy, R_IN, rOut, a[0], a[1], CORNER);
        ctx.fillStyle = hv ? color : rgba(color, dk ? 0.85 : 0.92);
        ctx.fill();
        ctx.strokeStyle = hv ? rgba(color, 0.9) : rgba(color, dk ? 0.4 : 0.3);
        ctx.lineWidth = hv ? 1.5 : 0.5;
        ctx.stroke();

        var mid = a[2], lr = (R_IN + ro) / 2;
        var iconName = icons && icons[i];
        if (iconName && ICONS[iconName]) {
          var icx = cx + Math.cos(mid) * lr;
          var icy = cy + Math.sin(mid) * lr;
          drawIcon(icx, icy, 16, iconName, textFor(color, hv));
        } else {
          ctx.save();
          ctx.translate(cx + Math.cos(mid) * lr, cy + Math.sin(mid) * lr);
          var rot = mid;
          if (rot > Math.PI / 2 && rot < Math.PI * 1.5) rot += Math.PI;
          if (rot < -Math.PI / 2) rot += Math.PI;
          ctx.rotate(rot);
          ctx.fillStyle = textFor(color, hv);
          ctx.font = (hv ? '600 ' : '400 ') + fs + 'px system-ui,sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          var lbl = items[i].length > ABBREV ? items[i].slice(0, ABBREV) : items[i];
          ctx.fillText(lbl, 0, 0);
          ctx.restore();
        }
      }
    }

    // --- draw pills ring (Maya-style alignment) ---
    // Inner edge of each pill sits at INNER_DIST from center.
    // Right-side pills: left edges aligned vertically.
    // Left-side pills: right edges aligned vertically.
    // Top/bottom: centered horizontally, edge at INNER_DIST.
    var INNER_DIST = R_IN + 4;
    var pillExtentR = 0, pillExtentL = 0; // track max pill extent for overflow

    function drawPillsRing(cx, cy, items, colors, angleFn, hover, dk, rOuter, icons) {
      ctx.font = '500 ' + PILL_FONT + 'px system-ui,sans-serif';
      pillExtentR = 0; pillExtentL = 0;

      for (var i = 0; i < items.length; i++) {
        var a = angleFn(i);
        var hv = hover === i;
        var color = typeof colors === 'string' ? colors : colors[i];
        var mid = a[2];
        var cosM = Math.cos(mid), sinM = Math.sin(mid);

        var iconName = icons && icons[i];
        var hasIcon = iconName && ICONS[iconName];
        var ICON_SZ = 14, ICON_GAP = 4;
        var label = items[i];
        var tw = ctx.measureText(label).width;
        var pw = tw + PILL_PAD * 2 + (hasIcon ? ICON_SZ + ICON_GAP : 0);
        var ph = PILL_H;

        var px, py;
        var THRESH = 0.35;
        if (cosM > THRESH) {
          // right side: left edge follows angle (diagonals curve inward)
          px = cx + INNER_DIST * cosM;
          py = cy + sinM * INNER_DIST - ph / 2;
          var ext = px + pw - cx;
          if (ext > pillExtentR) pillExtentR = ext;
        } else if (cosM < -THRESH) {
          // left side: right edge follows angle (diagonals curve inward)
          px = cx + INNER_DIST * cosM - pw;
          py = cy + sinM * INNER_DIST - ph / 2;
          var ext = cx - px;
          if (ext > pillExtentL) pillExtentL = ext;
        } else if (sinM < 0) {
          // top: bottom edge at INNER_DIST
          px = cx + cosM * INNER_DIST - pw / 2;
          py = cy - INNER_DIST - ph;
        } else {
          // bottom: top edge at INNER_DIST
          px = cx + cosM * INNER_DIST - pw / 2;
          py = cy + INNER_DIST;
        }

        roundRect(px, py, pw, ph, PILL_R);
        ctx.fillStyle = hv ? color : rgba(color, dk ? 0.82 : 0.88);
        ctx.fill();
        ctx.strokeStyle = hv ? rgba(color, 0.9) : rgba(color, dk ? 0.3 : 0.25);
        ctx.lineWidth = hv ? 1.5 : 0.5;
        ctx.stroke();

        var tColor = textFor(color, hv);
        ctx.fillStyle = tColor;
        ctx.font = (hv ? '600 ' : '500 ') + PILL_FONT + 'px system-ui,sans-serif';
        ctx.textBaseline = 'middle';
        if (hasIcon) {
          var iconX = px + PILL_PAD + ICON_SZ / 2;
          var textX = px + PILL_PAD + ICON_SZ + ICON_GAP + tw / 2;
          drawIcon(iconX, py + ph / 2, ICON_SZ, iconName, tColor);
          ctx.textAlign = 'center';
          ctx.fillText(label, textX, py + ph / 2);
        } else {
          ctx.textAlign = 'center';
          ctx.fillText(label, px + pw / 2, py + ph / 2);
        }

        if (!pillRects) pillRects = [];
        pillRects[i] = [px, py, pw, ph];
      }
    }

    var pillRects = null;
    var overflowRects = null;

    var drawRing = STYLE === 'pills' ? drawPillsRing : drawDonutRing;

    // --- overflow list (items beyond ring capacity) ---
    // Always east for right-side L1, west for left-side L1
    var OVF_R = 4; // squarer corners than pills
    var OVF_FONT = 11;
    function drawOverflow(cx, cy, allVals, ringN, color, hoverI, dk) {
      var items = allVals.slice(ringN);
      if (!items.length) return;

      var l1Slot = l1SlotIdx[activeL1];
      var east = Math.cos(SLOT[l1Slot]) >= 0;

      var ITEM_H = 24, ITEM_GAP = 2, MARGIN = 12;
      ctx.font = '500 ' + OVF_FONT + 'px system-ui,sans-serif';

      var maxW = 0;
      for (var i = 0; i < items.length; i++) {
        var w = ctx.measureText(items[i]).width + PILL_PAD * 2;
        if (w > maxW) maxW = w;
      }
      maxW = Math.max(maxW, 70);

      var totalH = items.length * ITEM_H + (items.length - 1) * ITEM_GAP;
      // For pills mode, use actual pill extent; for donut, use ring radius
      var clearR = STYLE === 'pills' ? (east ? pillExtentR : pillExtentL) : l2ROut;
      var listX = east ? cx + clearR + MARGIN : cx - clearR - MARGIN - maxW;
      var listY = cy - totalH / 2;

      overflowRects = [];

      for (var i = 0; i < items.length; i++) {
        var x = listX;
        var y = listY + i * (ITEM_H + ITEM_GAP);
        var hv = (hoverI === ringN + i);

        roundRect(x, y, maxW, ITEM_H, OVF_R);
        ctx.fillStyle = hv ? color : rgba(color, dk ? 0.75 : 0.85);
        ctx.fill();
        ctx.strokeStyle = hv ? rgba(color, 0.9) : rgba(color, dk ? 0.25 : 0.2);
        ctx.lineWidth = hv ? 1.5 : 0.5;
        ctx.stroke();

        ctx.fillStyle = textFor(color, hv);
        ctx.font = (hv ? '600 ' : '500 ') + OVF_FONT + 'px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(items[i], x + maxW / 2, y + ITEM_H / 2);

        overflowRects.push([x, y, maxW, ITEM_H]);
      }
    }

    // --- draw ---
    function draw() {
      var dk = isDark();
      ctx.clearRect(0, 0, vw, vh);
      pillRects = null;
      overflowRects = null;

      if (level === 1) {
        var labels = [], colArr = [], iconArr = [];
        for (var i = 0; i < l1N; i++) {
          labels.push(cats[i].label);
          colArr.push(cats[i].color);
          iconArr.push(cats[i].icon || null);
        }

        drawRing(originX, originY, labels, colArr, l1Angles, hoverIdx, dk, l1ROut, iconArr);

        var prevText = hoverIdx >= 0 ? cats[hoverIdx].label : '';
        var prevColor = hoverIdx >= 0 ? cats[hoverIdx].color : null;
        drawCenter(originX, originY, prevText, prevColor, dk);

      } else {
        var cat = cats[activeL1];
        var vals = cat.values;
        var ringN = Math.min(vals.length, l2SlotIdx.length);
        var ringLabels = valLabels(vals.slice(0, ringN));
        var ringIcons = valIcons(vals.slice(0, ringN));

        drawRing(l2CenterX, l2CenterY, ringLabels, cat.color, l2Angles, hoverIdx, dk, l2ROut, ringIcons);

        if (vals.length > ringN) {
          drawOverflow(l2CenterX, l2CenterY, valLabels(vals), ringN, cat.color, hoverIdx, dk);
        }

        // back button
        var BACK_R = 14;
        var dxB = mx - originX, dyB = my - originY;
        var backHover = Math.sqrt(dxB * dxB + dyB * dyB) < R_CENTER + 5;
        ctx.beginPath();
        ctx.arc(originX, originY, BACK_R, 0, Math.PI * 2);
        ctx.fillStyle = backHover ? rgba(cat.color, 0.7) : (dk ? 'rgba(30,30,30,0.9)' : 'rgba(240,240,240,0.95)');
        ctx.fill();
        ctx.strokeStyle = rgba(cat.color, backHover ? 0.9 : 0.4);
        ctx.lineWidth = backHover ? 2 : 1;
        ctx.stroke();
        // chevron arrow — points from L2 center back toward origin
        ctx.save();
        ctx.translate(originX, originY);
        var backAngle = Math.atan2(l2CenterY - originY, l2CenterX - originX);
        ctx.rotate(backAngle);
        var as = 5;
        ctx.beginPath();
        ctx.moveTo(as * 0.3, -as);
        ctx.lineTo(-as * 0.7, 0);
        ctx.lineTo(as * 0.3, as);
        ctx.strokeStyle = backHover ? '#fff' : (dk ? '#aaa' : '#555');
        ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();

        var prevText = hoverIdx >= 0 ? valLabel(vals[hoverIdx]) : cat.label;
        drawCenter(l2CenterX, l2CenterY, prevText, cat.color, dk);
      }
    }

    // --- hit test ---
    function hitTestPill(mx, my) {
      if (pillRects) {
        for (var i = 0; i < pillRects.length; i++) {
          var r = pillRects[i];
          if (r && mx >= r[0] && mx <= r[0] + r[2] && my >= r[1] && my <= r[1] + r[3]) {
            return i;
          }
        }
      }
      return -1;
    }

    function hitTestOverflow(mx, my) {
      if (!overflowRects) return -1;
      var ringN = Math.min(cats[activeL1].values.length, l2SlotIdx.length);
      for (var i = 0; i < overflowRects.length; i++) {
        var r = overflowRects[i];
        if (mx >= r[0] && mx <= r[0] + r[2] && my >= r[1] && my <= r[1] + r[3]) {
          return ringN + i;
        }
      }
      return -1;
    }

    function hitTest(mx, my) {
      if (level === 1) {
        var dx = mx - originX, dy = my - originY;
        var d = Math.sqrt(dx * dx + dy * dy);
        var ang = Math.atan2(dy, dx);

        if (d < R_IN) return { zone: 'center' };

        if (STYLE === 'pills') {
          var pi = hitTestPill(mx, my);
          if (pi >= 0) return { zone: 'L1', idx: pi };
          if (d > l1ROut + 30) {
            for (var i = 0; i < l1N; i++) {
              var a = l1Angles(i), mid = a[2];
              var na = normAngle(ang, mid);
              if (na >= a[0] && na <= a[1]) return { zone: 'L1_drill', idx: i };
            }
          }
        } else {
          if (d > l1ROut + 10) {
            for (var i = 0; i < l1N; i++) {
              var a = l1Angles(i), mid = a[2];
              var na = normAngle(ang, mid);
              if (na >= a[0] && na <= a[1]) return { zone: 'L1_drill', idx: i };
            }
          }
          if (d >= R_IN && d <= l1ROut + 6) {
            for (var i = 0; i < l1N; i++) {
              var a = l1Angles(i), mid = a[2];
              var na = normAngle(ang, mid);
              if (na >= a[0] && na <= a[1]) return { zone: 'L1', idx: i };
            }
          }
        }

        return { zone: 'outside' };

      } else {
        var dx = mx - l2CenterX, dy = my - l2CenterY;
        var d = Math.sqrt(dx * dx + dy * dy);
        var ang = Math.atan2(dy, dx);

        var dxO = mx - originX, dyO = my - originY;
        var dO = Math.sqrt(dxO * dxO + dyO * dyO);
        if (dO < R_CENTER + 5) return { zone: 'back' };

        // overflow rects (outside the ring)
        var oi = hitTestOverflow(mx, my);
        if (oi >= 0) return { zone: 'L2', idx: oi };

        if (d < R_IN) return { zone: 'center' };

        var ringN = Math.min(cats[activeL1].values.length, l2SlotIdx.length);

        if (STYLE === 'pills') {
          var pi = hitTestPill(mx, my);
          if (pi >= 0) return { zone: 'L2', idx: pi };
        }

        // angular slot hit for ring items
        for (var j = 0; j < ringN; j++) {
          var a = l2Angles(j), mid = a[2];
          var na = normAngle(ang, mid);
          if (na >= a[0] && na <= a[1] && d >= R_IN) return { zone: 'L2', idx: j };
        }

        return { zone: 'outside' };
      }
    }

    // --- events ---
    function onMove(e) {
      if (dead) return;
      mx = e.clientX; my = e.clientY;
      var h = hitTest(mx, my);
      var changed = false;

      if (level === 1) {
        if (h.zone === 'L1_drill') {
          activeL1 = h.idx;
          var cat = cats[h.idx];
          var a = l1Angles(h.idx);
          var midR = (R_IN + l1ROut) / 2;
          l2CenterX = originX + Math.cos(a[2]) * midR;
          l2CenterY = originY + Math.sin(a[2]) * midR;
          buildL2Layout();
          var ringN = Math.min(cat.values.length, l2SlotIdx.length);
          l2ROut = calcOuterR(valLabels(cat.values.slice(0, ringN)));
          level = 2; hoverIdx = -1; changed = true;
        } else if (h.zone === 'L1') {
          if (hoverIdx !== h.idx) { hoverIdx = h.idx; changed = true; }
        } else {
          if (hoverIdx !== -1) { hoverIdx = -1; changed = true; }
        }
      } else {
        if (h.zone === 'back') {
          level = 1; activeL1 = -1; hoverIdx = -1; changed = true;
        } else if (h.zone === 'L2') {
          if (hoverIdx !== h.idx) { hoverIdx = h.idx; changed = true; }
        } else {
          if (hoverIdx !== -1) { hoverIdx = -1; changed = true; }
        }
      }

      if (changed || level === 2) draw();
    }

    function onUp(e) {
      if (dead) return;
      var h = hitTest(e.clientX, e.clientY);

      if (level === 2 && h.zone === 'L2' && activeL1 >= 0) {
        var cat = cats[activeL1];
        teardown();
        onSelect(cat.key, valLabel(cat.values[h.idx]), activeL1, h.idx);
      } else {
        teardown(); onCancel();
      }
    }

    function onKey(e) {
      if (dead) return;
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (level === 2) {
          level = 1; activeL1 = -1; hoverIdx = -1; draw();
        } else {
          teardown(); onCancel();
        }
      }
    }

    function onContext(e) { e.preventDefault(); teardown(); onCancel(); }

    overlay.addEventListener('mousemove', onMove);
    overlay.addEventListener('mouseup', onUp);
    overlay.addEventListener('contextmenu', onContext);
    document.addEventListener('keydown', onKey, true);

    function teardown() {
      if (dead) return;
      dead = true;
      overlay.removeEventListener('mousemove', onMove);
      overlay.removeEventListener('mouseup', onUp);
      overlay.removeEventListener('contextmenu', onContext);
      document.removeEventListener('keydown', onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    draw();
    return teardown;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = nkdRadial;
  else root.nkdRadial = nkdRadial;

})(typeof globalThis !== 'undefined' ? globalThis : this);
