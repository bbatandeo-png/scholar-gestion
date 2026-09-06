(function () {
  // Staggered entrance animation, same as the design mockup.
  document.querySelectorAll('[data-reveal]').forEach(function (el, i) {
    el.style.animationDelay = Math.min(i * 55, 660) + 'ms';
  });

  // Mobile menu
  var menuToggle = document.getElementById('menuToggle');
  var mobileNav = document.getElementById('mobileNav');
  function closeMenu() {
    mobileNav.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
  }
  menuToggle.addEventListener('click', function () {
    var isOpen = mobileNav.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
  });
  mobileNav.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', closeMenu);
  });

  // FAQ accordion - one open at a time
  var faqList = document.getElementById('faqList');
  faqList.querySelectorAll('.faq-item').forEach(function (item) {
    var btn = item.querySelector('.faq-q');
    var sign = item.querySelector('.faq-q-sign');
    btn.addEventListener('click', function () {
      var wasOpen = item.classList.contains('open');
      faqList.querySelectorAll('.faq-item').forEach(function (i) {
        i.classList.remove('open');
        i.querySelector('.faq-q-sign').textContent = '+';
      });
      if (!wasOpen) {
        item.classList.add('open');
        sign.textContent = '−';
      }
    });
  });

  // Contact form - real submission via FormSubmit (no backend needed),
  // delivered to bbatandeo@gmail.com. First submission ever triggers a
  // one-time confirmation email FormSubmit sends to that address; future
  // submissions deliver directly once that link has been clicked.
  var form = document.getElementById('contactForm');
  var sent = document.getElementById('contactSent');
  var errorMsg = document.getElementById('contactError');
  var submitBtn = document.getElementById('contactSubmit');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorMsg.classList.add('hidden');
    submitBtn.disabled = true;
    var originalLabel = submitBtn.textContent;
    submitBtn.textContent = 'Envoi...';

    fetch(form.action, {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      body: new FormData(form)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('request failed');
        form.classList.add('hide');
        sent.classList.add('show');
      })
      .catch(function () {
        errorMsg.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      });
  });
})();
