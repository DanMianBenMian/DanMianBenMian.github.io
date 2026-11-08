/*!
 * liquid-glass.js —— 大面积元素（卡片）液态玻璃
 *
 * 两层可见结构，全部由 JS 生成、零图片依赖：
 *   ① .lg-layer  背景快照（克隆 .bg）+ feDisplacementMap 真折射 → 边缘掰弯背后的网格
 *   ② .lg-spec   边缘厚度高光位图（圆角矩形 SDF + 方向光）→ 让人一眼认出"玻璃"
 * 降级：不支持 SVG 滤镜 / 窄屏 / 异常 → html[data-lg="fallback"]，只留 CSS 毛玻璃
 *
 * 用法：页面底部加 <script defer src="/liquid-glass.js"> （勿内联）
 */
(function () {
  'use strict';
  if (window.__LIQUID_GLASS__) return;
  window.__LIQUID_GLASS__ = true;

  var root = document.documentElement;

  /* ---------- 1. 能力检测（不支持就走毛玻璃降级） ---------- */
  var canUse = false;
  try {
    canUse = !!(window.CSS && CSS.supports && CSS.supports('filter', 'url(#lg-probe)'));
  } catch (e) { canUse = false; }
  if (!canUse) {
    root.setAttribute('data-lg', 'fallback');
    return;
  }
  root.setAttribute('data-lg', 'on');

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var CFG = {
    sel: '.card, .contact',
    minW: 170,          // 太小的块做折射没意义
    minH: 90,
    band: 18,           // 折射带宽（像素）
    scale: 60,          // feDisplacementMap 强度（≈ 2×最大位移）—— 用户设 60
    pad: 40,            // 快照外扩，避免位移把边缘拉出空洞（scale 大时必须够大）
    wide: 900,          // 视口宽度门槛（窄屏不做）
    rimW: 3.2,          // 边缘高光带宽度（像素）
    rimA: 0.28,         // 边缘高光强度 0~1 —— 用户设 28
    tint: 4             // 通透（白蒙层 α = 值/100）—— 用户设 4
  };

  var svgRoot = null, seq = 0;
  function ensureSvg() {
    if (svgRoot) return svgRoot;
    svgRoot = document.createElementNS(SVG_NS, 'svg');
    svgRoot.setAttribute('width', '0');
    svgRoot.setAttribute('height', '0');
    svgRoot.setAttribute('aria-hidden', 'true');
    svgRoot.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    svgRoot.appendChild(document.createElementNS(SVG_NS, 'defs'));
    document.body.appendChild(svgRoot);
    return svgRoot;
  }

  /* ---------- 2. 圆角矩形 SDF + 外法线 ---------- */
  function sdfInfo(lx, ly, w, h, r) {
    var cx = w / 2, cy = h / 2;
    var hw = Math.max(0, w / 2 - r), hh = Math.max(0, h / 2 - r);
    var ddx = lx - cx, ddy = ly - cy;
    var qx = Math.abs(ddx) - hw, qy = Math.abs(ddy) - hh;
    var ax = Math.max(qx, 0), ay = Math.max(qy, 0);
    var sd = Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
    var nx, ny;
    if (ax > 0 || ay > 0) {
      var L = Math.sqrt(ax * ax + ay * ay) || 1;
      nx = (ddx >= 0 ? 1 : -1) * ax / L;
      ny = (ddy >= 0 ? 1 : -1) * ay / L;
    } else if (qx >= qy) { nx = (ddx >= 0 ? 1 : -1); ny = 0; }
    else { nx = 0; ny = (ddy >= 0 ? 1 : -1); }
    return { inside: -sd, nx: nx, ny: ny };
  }

  /* ---------- 3. 位移贴图：R/G 存横纵偏移，128 = 零 ---------- */
  function makeMap(w, h, r, band, pad) {
    var W = w + pad * 2, H = h + pad * 2;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(W, H), d = img.data;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var g = sdfInfo(x - pad, y - pad, w, h, r);
        var i = (y * W + x) * 4, nx = 0, ny = 0;
        if (g.inside > 0) {
          var t = 1 - g.inside / band;
          if (t > 0) {
            var s = Math.pow(t, 1.7);
            nx = -g.nx * s;      // 向内收：凸透镜边缘压缩感
            ny = -g.ny * s;
          }
        }
        d[i] = 128 + 127 * nx;
        d[i + 1] = 128 + 127 * ny;
        d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { url: cv.toDataURL(), W: W, H: H };
  }

  /* ---------- 4. 边缘厚度高光位图（方向光：左上偏亮） ---------- */
  function makeSpec(w, h, r, rimW, pad, alpha) {
    var W = w + pad * 2, H = h + pad * 2;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(W, H), d = img.data;
    // 光从左上方打过来
    var LX = -0.7071, LY = -0.7071;
    var k = 1 / (rimW * 0.55);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var g = sdfInfo(x - pad, y - pad, w, h, r);
        var i = (y * W + x) * 4, a = 0;
        if (g.inside > 0) {
          // 贴边最亮的窄带，向内 1 个 rimW 衰减掉
          var e = Math.exp(-Math.pow((g.inside - rimW * 0.35) * k, 2));
          // 朝向光源的法线更亮（模拟厚玻璃边缘折光）
          var nl = g.nx * LX + g.ny * LY;          // -1..1
          var dir = 0.20 + 0.80 * Math.pow(Math.max(0, nl), 1.10);
          a = e * dir * alpha;
        }
        if (a > 1) a = 1;
        d[i] = 205; d[i + 1] = 232; d[i + 2] = 255;   // 冷白，和站点蓝调同色系
        d[i + 3] = Math.round(255 * a);
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL();
  }

  function buildFilter(map, scale) {
    ensureSvg();
    var id = 'lgf-' + (++seq);
    var f = document.createElementNS(SVG_NS, 'filter');
    f.setAttribute('id', id);
    f.setAttribute('x', '-30%'); f.setAttribute('y', '-30%');
    f.setAttribute('width', '160%'); f.setAttribute('height', '160%');
    f.setAttribute('primitiveUnits', 'userSpaceOnUse');
    f.setAttribute('color-interpolation-filters', 'sRGB');
    var img = document.createElementNS(SVG_NS, 'feImage');
    img.setAttribute('href', map.url);
    img.setAttribute('x', 0); img.setAttribute('y', 0);
    img.setAttribute('width', map.W); img.setAttribute('height', map.H);
    img.setAttribute('preserveAspectRatio', 'none');
    img.setAttribute('result', 'map');
    var disp = document.createElementNS(SVG_NS, 'feDisplacementMap');
    disp.setAttribute('in', 'SourceGraphic');
    disp.setAttribute('in2', 'map');
    disp.setAttribute('scale', scale);
    disp.setAttribute('xChannelSelector', 'R');
    disp.setAttribute('yChannelSelector', 'G');
    f.appendChild(img); f.appendChild(disp);
    svgRoot.firstChild.appendChild(f);
    return id;
  }

  /* ---------- 5. 克隆背景（去掉重模糊光团与扫光带，只留底色 + 网格） ---------- */
  function makeBgClone() {
    var src = document.querySelector('.bg');
    if (!src) return null;
    var c = src.cloneNode(true);
    c.className = 'bg lg-bg';               // ⚠ 必须保留 .bg，否则样式全丢
    c.removeAttribute('id');
    var orbs = c.querySelectorAll('.orb');
    for (var i = 0; i < orbs.length; i++) orbs[i].parentNode.removeChild(orbs[i]);
    c.style.cssText = 'position:absolute;inset:auto;left:0;top:0;z-index:0;'
      + 'pointer-events:none;overflow:hidden;'
      + 'width:' + window.innerWidth + 'px;height:' + window.innerHeight + 'px';
    return c;
  }

  /* ---------- 6. 单个元素的增强 / 还原（仅边缘高光，关折射） ---------- */
  function attach(el) {
    if (el.__lg || el.dataset.lgDone === '1') return;
    var w = el.clientWidth, h = el.clientHeight;
    if (w < CFG.minW || h < CFG.minH) return;

    try {
      var spec = document.createElement('div');
      spec.className = 'lg-spec';
      el.insertBefore(spec, el.firstChild);
      el.classList.add('lg-host');
      el.dataset.lgDone = '1';

      function build() {
        var ww = el.clientWidth, hh = el.clientHeight;
        if (ww < 2 || hh < 2) return;
        var r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        var sw = ww + CFG.pad * 2, sh = hh + CFG.pad * 2;
        spec.style.backgroundImage = 'url(' + makeSpec(ww, hh, r, CFG.rimW, CFG.pad, CFG.rimA) + ')';
        spec.style.backgroundSize = sw + 'px ' + sh + 'px';
        spec.style.backgroundPosition = (-CFG.pad) + 'px ' + (-CFG.pad) + 'px';
      }

      var onResize = function () {
        clearTimeout(el.__lgT);
        el.__lgT = setTimeout(build, 160);
      };
      window.addEventListener('resize', onResize);
      build();

      el.__lg = {
        build: build,
        destroy: function () {
          window.removeEventListener('resize', onResize);
          clearTimeout(el.__lgT);
          if (spec.parentNode) spec.parentNode.removeChild(spec);
          el.classList.remove('lg-host');
          delete el.dataset.lgDone;
          el.__lg = null;
        }
      };
    } catch (err) {
      // 任何异常：撤掉这一块，保持毛玻璃
      if (el.__lg && el.__lg.destroy) { try { el.__lg.destroy(); } catch (e2) {} }
      root.setAttribute('data-lg', 'fallback');
    }
  }

  /* ---------- 7. 只给视口内的元素挂（滚出即销毁，控住合成层数量） ---------- */
  var live = [];

  function eligible() {
    if (window.innerWidth < CFG.wide) return [];
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return [];
    return Array.prototype.slice.call(document.querySelectorAll(CFG.sel));
  }

  function run() {
    if (!('IntersectionObserver' in window)) {
      eligible().forEach(attach);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var el = en.target, idx = live.indexOf(el);
        if (en.isIntersecting) {
          if (idx < 0) { attach(el); live.push(el); }
        } else if (idx >= 0) {
          if (el.__lg && el.__lg.destroy) el.__lg.destroy();
          live.splice(idx, 1);
        }
      });
    }, { rootMargin: '120px 0px' });

    eligible().forEach(function (el) { io.observe(el); });

    // 视口跨过 900px 门槛时重新评估
    var lastWide = window.innerWidth >= CFG.wide;
    window.addEventListener('resize', function () {
      var nowWide = window.innerWidth >= CFG.wide;
      if (nowWide === lastWide) return;
      lastWide = nowWide;
      if (nowWide) {
        eligible().forEach(function (el) { io.observe(el); });
      } else {
        live.forEach(function (el) { if (el.__lg && el.__lg.destroy) el.__lg.destroy(); });
        live.length = 0;
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
