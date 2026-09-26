(function(){
  var t=document.querySelector('.menu-toggle'),n=document.getElementById('primary-nav');
  if(t&&n){t.addEventListener('click',function(){var o=n.classList.toggle('is-open');t.setAttribute('aria-expanded',o?'true':'false');});}
  var s=document.querySelector('.search-toggle'),b=document.getElementById('search-bar');
  if(s&&b){s.addEventListener('click',function(){var o=b.classList.toggle('is-open');s.setAttribute('aria-expanded',o?'true':'false');if(o){var i=b.querySelector('input');i&&i.focus();}});}
  document.querySelectorAll('.js-copy').forEach(function(c){c.addEventListener('click',function(){
    var u=c.getAttribute('data-url');(navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){var o=c.textContent;c.textContent='Copied';setTimeout(function(){c.textContent=o;},1500);});});});
})();
