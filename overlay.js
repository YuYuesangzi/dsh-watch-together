// 画面小字：可拖动、全屏跟随（挂到 fullscreen 元素/播放器容器里）
// 由 index.js 注入依赖：{ bestPage: async()=>page, evaluate: (wsUrl, expr)=>Promise<string|null> }

const INSTALL = `(function(){
  if (window.__dshWatchVersion === 2) return 'ok';
  window.__dshWatchVersion = 2;
  window.__dshWatchInit = true;
  window.__dshWatchPos = window.__dshWatchPos || { left: null, top: null };

  function container() {
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) return fsEl;
    return document.querySelector('.bpx-player-video-wrap')
      || document.querySelector('.bpx-player-container')
      || document.querySelector('#bilibili-player')
      || document.body;
  }

  function ensure() {
    var host = container();
    if (!host) return null;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var el = document.getElementById('dsh-watch-line');
    if (el && el.style.position !== 'absolute') { try { el.remove(); } catch (e) {} el = null; } // UPGRADE_V2
    if (!el) {
      el = document.createElement('div');
      el.id = 'dsh-watch-line';
      el.style.cssText = 'position:absolute;right:6%;bottom:14%;max-width:46vw;padding:8px 14px;border-radius:10px;' +
        'background:rgba(8,14,24,.55);color:#eaf2ff;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;' +
        'backdrop-filter:blur(6px);border:1px solid rgba(140,170,220,.25);z-index:2147483000;' +
        'opacity:0;transition:opacity .35s ease;white-space:pre-wrap;text-shadow:0 1px 2px rgba(0,0,0,.6);' +
        'cursor:move;user-select:none;touch-action:none;pointer-events:auto';
      el.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        var r = el.getBoundingClientRect();
        var host2 = el.parentElement;
        var hr = host2.getBoundingClientRect();
        var ox = ev.clientX - r.left;
        var oy = ev.clientY - r.top;
        function move(e) {
          var left = Math.max(0, Math.min(hr.width - r.width, e.clientX - hr.left - ox));
          var top = Math.max(0, Math.min(hr.height - r.height, e.clientY - hr.top - oy));
          el.style.left = left + 'px';
          el.style.top = top + 'px';
          el.style.right = 'auto';
          el.style.bottom = 'auto';
          window.__dshWatchPos.left = left;
          window.__dshWatchPos.top = top;
        }
        function up() {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
      (container() || document.body).appendChild(el);
    } else if (el.parentElement !== host) {
      host.appendChild(el);
    }
    if (window.__dshWatchPos.left !== null) {
      el.style.left = window.__dshWatchPos.left + 'px';
      el.style.top = window.__dshWatchPos.top + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
    return el;
  }

  // 进出全屏时把元素搬进/搬出全屏宿主
  function onFs() {
    setTimeout(function () {
      var el = window.__dshWatchEnsure && window.__dshWatchEnsure();
      if (el && el.textContent) el.style.opacity = '1';
    }, 250);
  }
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('webkitfullscreenchange', onFs);
  window.__dshWatchEnsure = ensure;
  return 'ok';
})()`;

export function createOverlay({ bestPage, evaluate }) {
  return async function showOverlay(text, seconds = 5) {
    const page = await bestPage();
    if (!page) return false;
    const safe = String(text || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
    const script = `(function(){
      try { ${INSTALL} } catch (e) { return 'install-failed'; }
      if (!window.__dshWatchEnsure) return 'no-ensure';
      var el = window.__dshWatchEnsure();
      if (!el) return 'no-host';
      el.textContent = '${safe}';
      el.style.opacity = '1';
      clearTimeout(window.__dshWatchTimer);
      window.__dshWatchTimer = setTimeout(function(){ el.style.opacity = '0'; }, ${Math.max(1, Number(seconds) || 5)} * 1000);
      return 'ok';
    })()`;
    const r = await evaluate(page.webSocketDebuggerUrl, script);
    return r === 'ok';
  };
}

export async function hideOverlay({ bestPage, evaluate }) {
  const page = await bestPage();
  if (!page) return false;
  const r = await evaluate(page.webSocketDebuggerUrl, `(function(){
    var el = document.getElementById('dsh-watch-line');
    if (el) { el.style.opacity = '0'; setTimeout(function(){ try { el.remove(); } catch (e) {} }, 400); }
    return 'ok';
  })()`);
  return r === 'ok';
}
