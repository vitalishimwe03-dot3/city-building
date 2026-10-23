(function () {
  'use strict';

  var DISMISS_KEY = 'citybuilding-install-dismissed';
  var deferredPrompt = null;
  var banner = document.getElementById('pwa-install-banner');
  var installBtn = document.getElementById('pwa-install-btn');
  var dismissBtn = document.getElementById('pwa-install-dismiss');

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function showBanner() {
    if (!banner || isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
    banner.hidden = false;
  }

  function hideBanner() {
    if (banner) banner.hidden = true;
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    showBanner();
  });

  if (installBtn) {
    installBtn.addEventListener('click', async function () {
      if (!deferredPrompt) {
        hideBanner();
        return;
      }
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } catch (e) { /* ignore */ }
      deferredPrompt = null;
      hideBanner();
    });
  }

  if (dismissBtn) {
    dismissBtn.addEventListener('click', function () {
      localStorage.setItem(DISMISS_KEY, '1');
      hideBanner();
    });
  }

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    hideBanner();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (window.__cbRefreshing) return;
      window.__cbRefreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.ready.then(function (registration) {
      if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      registration.addEventListener('updatefound', function () {
        var worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', function () {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            worker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(function () {});
  }

  function updateOnlineStatus() {
    document.documentElement.classList.toggle('is-offline', !navigator.onLine);
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
})();
