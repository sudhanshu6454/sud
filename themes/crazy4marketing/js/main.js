(function(){
  var t=document.querySelector('.menu-toggle'),n=document.getElementById('primary-nav');
  if(t&&n){t.addEventListener('click',function(){var o=n.classList.toggle('is-open');t.setAttribute('aria-expanded',o?'true':'false');});}
  document.querySelectorAll('.js-copy').forEach(function(b){b.addEventListener('click',function(){
    var u=b.getAttribute('data-url');(navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){var o=b.textContent;b.textContent='Copied';setTimeout(function(){b.textContent=o;},1500);});});});
})();