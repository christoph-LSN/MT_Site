(function () {
  'use strict';

  var state = {
    maps: [],
    attached: false,
    observer: null,
    interval: null
  };

  function log(message, data) {
    if (window.console && console.log) {
      if (typeof data !== 'undefined') {
        console.log('[map-print] ' + message, data);
      } else {
        console.log('[map-print] ' + message);
      }
    }
  }

  function warn(message, data) {
    if (window.console && console.warn) {
      if (typeof data !== 'undefined') {
        console.warn('[map-print] ' + message, data);
      } else {
        console.warn('[map-print] ' + message);
      }
    }
  }

  function isLeafletAvailable() {
    return !!(window.L && L.Map && L.control && L.control.browserPrint);
  }

  function getMapView() {
    return document.getElementById('mapview');
  }

  function uniquePushMap(map) {
    if (!map) return;

    var exists = state.maps.some(function (existing) {
      return existing === map;
    });

    if (!exists) {
      state.maps.push(map);
      log('Leaflet-Map registriert.', describeMap(map));
    }
  }

  function describeMap(map) {
    if (!map || !map.getContainer) {
      return { valid: false };
    }

    var container = map.getContainer();
    return {
      valid: true,
      id: container.id || '',
      className: container.className || '',
      inMapView: isInsideMapView(container),
      visible: isVisible(container)
    };
  }

  function isVisible(element) {
    if (!element) return false;
    return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  }

  function isInsideMapView(element) {
    var mapView = getMapView();
    if (!mapView || !element) return false;
    return mapView === element || mapView.contains(element) || element.contains(mapView);
  }

  function isGoodTargetMap(map) {
    if (!map || !map.getContainer) return false;

    var container = map.getContainer();
    if (!container) return false;

    // Wichtig: Nur die Karte im Bereich #mapview akzeptieren.
    if (!isInsideMapView(container)) {
      return false;
    }

    // Sichtbarkeit bevorzugen.
    if (!isVisible(container)) {
      return false;
    }

    return true;
  }

  function registerLeafletInitHook() {
    if (!window.L || !L.Map || !L.Map.addInitHook) {
      return;
    }

    if (window.__mtMapPrintHookRegistered) {
      return;
    }

    window.__mtMapPrintHookRegistered = true;

    L.Map.addInitHook(function () {
      uniquePushMap(this);
      attachIfPossible();
    });

    log('Leaflet init hook registriert.');
  }

  function scanWindowForMaps() {
    if (!window.L || !L.Map) return;

    Object.keys(window).forEach(function (key) {
      try {
        if (window[key] instanceof L.Map) {
          uniquePushMap(window[key]);
        }
      } catch (e) {
        // ignorieren
      }
    });
  }

  function getPrintableBaseLayer(map) {
    var found = null;

    map.eachLayer(function (layer) {
      if (found) return;

      if (
        (window.L.TileLayer && layer instanceof L.TileLayer) ||
        (window.L.TileLayer && window.L.TileLayer.WMS && layer instanceof L.TileLayer.WMS)
      ) {
        found = layer;
      }
    });

    return found;
  }

  function getIndicatorTitle() {
    var el =
      document.querySelector('.heading h1') ||
      document.querySelector('h1');

    if (el && el.textContent) {
      return el.textContent.trim();
    }

    return document.title || 'Karte';
  }

  function getIndicatorSubtitle() {
    var el =
      document.querySelector('.heading .indicator-number') ||
      document.querySelector('.indicator-name') ||
      document.querySelector('.indicator-short-name');

    if (el && el.textContent) {
      return el.textContent.trim();
    }

    return window.location.pathname;
  }

  function buildPrintModes(title, subtitle) {
    return [
      L.BrowserPrint.Mode.Landscape('A4', {
        title: 'Drucken (Querformat)',
        header: {
          enabled: true,
          text: title,
          size: '12mm',
          overTheMap: false
        },
        footer: {
          enabled: true,
          text: subtitle,
          size: '8mm',
          overTheMap: false
        }
      }),
      L.BrowserPrint.Mode.Auto('A4', {
        title: 'Drucken (Automatisch)',
        header: {
          enabled: true,
          text: title,
          size: '12mm',
          overTheMap: false
        },
        footer: {
          enabled: true,
          text: subtitle,
          size: '8mm',
          overTheMap: false
        }
      })
    ];
  }

  function attachPrintControl(map) {
    if (!isLeafletAvailable()) {
      warn('Leaflet oder leaflet.browser.print ist nicht verfügbar.');
      return false;
    }

    if (!map || map._mtPrintControlAdded) {
      return false;
    }

    var title = getIndicatorTitle();
    var subtitle = getIndicatorSubtitle();
    var baseLayer = getPrintableBaseLayer(map);

    try {
      var control = L.control.browserPrint({
        title: 'Karte drucken',
        position: 'topleft',
        documentTitle: title,
        printLayer: baseLayer,
        printModes: buildPrintModes(title, subtitle)
      }).addTo(map);

      map._mtPrintControlAdded = true;
      map._mtPrintControl = control;
      state.attached = true;

      log('Print-Control zur sichtbaren #mapview-Karte hinzugefügt.', describeMap(map));

      stopWatching();
      return true;
    } catch (error) {
      warn('Fehler beim Hinzufügen des Print-Controls.', error);
      return false;
    }
  }

  function attachIfPossible() {
    if (state.attached) {
      return true;
    }

    var goodMaps = state.maps.filter(isGoodTargetMap);

    if (goodMaps.length) {
      return attachPrintControl(goodMaps[0]);
    }

    return false;
  }

  function observeMapView() {
    var mapView = getMapView();
    if (!mapView) {
      warn('#mapview wurde noch nicht gefunden.');
      return;
    }

    if (state.observer) {
      return;
    }

    state.observer = new MutationObserver(function () {
      if (state.attached) return;
      attachIfPossible();
    });

    state.observer.observe(mapView, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    log('MutationObserver für #mapview gestartet.');
  }

  function startPolling() {
    if (state.interval) {
      return;
    }

    var attempts = 0;
    var maxAttempts = 60;

    state.interval = window.setInterval(function () {
      if (state.attached) {
        stopWatching();
        return;
      }

      attempts += 1;

      scanWindowForMaps();
      attachIfPossible();

      if (attempts >= maxAttempts) {
        stopWatching();
        warn('Keine sichtbare Leaflet-Karte innerhalb von #mapview gefunden.');
      }
    }, 500);
  }

  function stopWatching() {
    if (state.interval) {
      window.clearInterval(state.interval);
      state.interval = null;
    }

    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
  }

  function bootstrap() {
    if (!isLeafletAvailable()) {
      warn('Leaflet oder leaflet.browser.print fehlt.');
      return;
    }

    registerLeafletInitHook();
    scanWindowForMaps();
    observeMapView();

    if (!attachIfPossible()) {
      startPolling();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
