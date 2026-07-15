/* ZORA — theme toggle. Sets data-theme early (no flash) + injects a top-right switch. */
(function(){
  var KEY = 'zora-theme';
  var t = localStorage.getItem(KEY) || 'dark';
  document.documentElement.setAttribute('data-theme', t);   // runs at head parse → no FOUC

  /* ── standardize the favicon → the real ZORA icon (site-wide) ── */
  (function(){
    var links = document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]');
    for (var i = 0; i < links.length; i++) links[i].parentNode.removeChild(links[i]);
    var link = document.createElement('link');
    link.rel = 'icon'; link.type = 'image/png'; link.href = '/assets/zora-icon.png';
    document.head.appendChild(link);
  })();

  /* ── swap the wordmark text for the real ZORA logo (white letters on dark, dark on light) ── */
  function swapWordmarks(theme){
    var src = theme === 'light' ? '/assets/zora-wordmark-black.png' : '/assets/zora-wordmark-white.png';
    var marks = document.querySelectorAll('.wordmark, .brand');
    for (var i = 0; i < marks.length; i++){
      var el = marks[i];
      var existing = el.querySelector('img.zora-logo');
      if (existing){ existing.src = src; continue; }
      var small = el.querySelector('small');                 // preserve any sublabel
      var img = document.createElement('img');
      img.className = 'zora-logo'; img.src = src; img.alt = 'ZORA'; img.setAttribute('draggable', 'false');
      el.textContent = '';
      el.appendChild(img);
      if (small){ el.appendChild(document.createTextNode(' ')); el.appendChild(small); }
    }
  }

  function icon(mode){
    return mode === 'dark'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/></svg>';
  }
  function build(){
    if (document.getElementById('zora-theme-toggle')) return;
    var b = document.createElement('button');
    b.id = 'zora-theme-toggle';
    b.className = 'zora-theme-toggle';
    b.setAttribute('aria-label', 'Toggle dark or light mode');
    b.setAttribute('title', 'Toggle theme');
    b.innerHTML = icon(document.documentElement.getAttribute('data-theme'));
    b.addEventListener('click', function(){
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(KEY, next);
      b.innerHTML = icon(next);
      swapWordmarks(next);
    });
    document.body.appendChild(b);
    swapWordmarks(document.documentElement.getAttribute('data-theme'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
