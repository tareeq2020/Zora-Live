/* ZORA — apply admin-mapped layout media to [data-slot] regions (hero, gallery, about…). */
(function(){
  fetch('/api/placements').then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
    if (!d) return;
    var p = d.placements;
    document.querySelectorAll('[data-slot]').forEach(function(el){
      var slot = el.getAttribute('data-slot');
      var url = p[slot] && p[slot].url;
      if (!url) return;
      if (el.tagName === 'IMG'){ el.src = url; el.classList.add('loaded'); }
      else { el.style.backgroundImage = 'url(' + url + ')'; }
    });
    var hv = document.querySelector('.hero video');
    if (hv && p['home-hero']) hv.poster = p['home-hero'].url;
  }).catch(function(){});
})();
