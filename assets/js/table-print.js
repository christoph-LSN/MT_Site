(function () {
  'use strict';

  function log(message, data) {
    if (window.console && console.log) {
      if (typeof data !== 'undefined') {
        console.log('[table-print] ' + message, data);
      } else {
        console.log('[table-print] ' + message);
      }
    }
  }

  function warn(message, data) {
    if (window.console && console.warn) {
      if (typeof data !== 'undefined') {
        console.warn('[table-print] ' + message, data);
      } else {
        console.warn('[table-print] ' + message);
      }
    }
  }

  function getStableButtonArea() {
    return document.getElementById('tableview');
  }

  function ensureButtonHost() {
    var area = getStableButtonArea();
    if (!area) {
      warn('No stable table area (#tableview) found.');
      return null;
    }

    var existing = area.querySelector('.table-print-buttons');
    if (existing) {
      return existing;
    }

    var host = document.createElement('div');
    host.className = 'table-print-buttons';

    area.insertBefore(host, area.firstChild);
    log('Created stable button host.');

    return host;
  }

  function ensureVisibleButton() {
    var host = ensureButtonHost();
    if (!host) return null;

    var existing = host.querySelector('.table-print-trigger');
    if (existing) {
      return existing;
    }

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'table-print-trigger btn btn-primary';
    button.textContent = 'Tabelle drucken';

    button.addEventListener('click', function () {
      log('Visible test button clicked.');
    });

    host.appendChild(button);
    log('Created visible test button.');

    return button;
  }

  function observeStableArea() {
    var area = getStableButtonArea();
    if (!area) return;

    var observer = new MutationObserver(function () {
      ensureVisibleButton();
    });

    observer.observe(area, {
      childList: true,
      subtree: true
    });

    log('MutationObserver attached to stable table area.');
  }

  function bootstrapWithRetry() {
    var attempts = 0;
    var maxAttempts = 30;

    var timer = window.setInterval(function () {
      attempts += 1;

      var button = ensureVisibleButton();
      if (button || attempts >= maxAttempts) {
        window.clearInterval(timer);

        if (!button) {
          warn('Could not create visible table print button after retries.');
        }
      }
    }, 500);

    observeStableArea();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapWithRetry);
  } else {
    bootstrapWithRetry();
  }
})();