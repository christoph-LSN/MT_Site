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

  function isVisible(element) {
    if (!element) return false;
    return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  }

  function isInsideMapView(element) {
    var mapView = getMapView();
    if (!mapView || !element) return false;
    return mapView === element || mapView.contains(element) || element.contains(mapView);
  }

  function uniquePushMap(map) {
    if (!map) return;

    var exists = state.maps.some(function (existing) {
      return existing === map;
    });

    if (!exists) {
      state.maps.push(map);
    }
  }

  function registerLeafletInitHook() {
    if (!window.L || !L.Map || !L.Map.addInitHook) return;
    if (window.__mtMapPrintHookRegistered) return;

    window.__mtMapPrintHookRegistered = true;

    L.Map.addInitHook(function () {
      uniquePushMap(this);
      attachIfPossible();
    });
  }

  function scanWindowForMaps() {
    if (!window.L || !L.Map) return;

    Object.keys(window).forEach(function (key) {
      try {
        if (window[key] instanceof L.Map) {
          uniquePushMap(window[key]);
        }
      } catch (e) {
        // ignore
      }
    });
  }

  function isGoodTargetMap(map) {
    if (!map || !map.getContainer) return false;

    var container = map.getContainer();
    if (!container) return false;
    if (!isInsideMapView(container)) return false;
    if (!isVisible(container)) return false;

    return true;
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
    var idEl =
      document.querySelector('.heading .indicator-number') ||
      document.querySelector('.indicator-name') ||
      document.querySelector('.indicator-short-name');

    if (idEl && idEl.textContent) {
      return idEl.textContent.trim();
    }

    return '';
  }

  function getCurrentYearText() {
    var selectors = [
      '#mapview .noUi-tooltip',
      '#mapview .timecontrol-date',
      '#mapview .leaflet-control-timecontrol .timecontrol-slider + span',
      '#mapview .leaflet-control-timecontrol',
      '#mapview .year',
      '#mapview .current-year'
    ];

    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && el.textContent && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }

    return '';
  }

  function findVisibleLegend() {
    var selectors = [
      '#mapview .leaflet-top.leaflet-right .leaflet-control:not(.leaflet-control-attribution):not(.leaflet-control-zoom)',
      '#mapview .leaflet-right .leaflet-control:not(.leaflet-control-attribution):not(.leaflet-control-zoom)',
      '#mapview .legend',
      '#mapview .map-legend',
      '#mapview .legend-container'
    ];

    for (var i = 0; i < selectors.length; i++) {
      var candidates = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < candidates.length; j++) {
        if (isVisible(candidates[j])) {
          return candidates[j];
        }
      }
    }

    return null;
  }

  function buildHeaderHtml() {
    var title = getIndicatorTitle();
    var subtitle = getIndicatorSubtitle();
    var yearText = getCurrentYearText();

    var metaParts = [];
    if (subtitle) metaParts.push(subtitle);
    if (yearText) metaParts.push('Stand/Jahr: ' + yearText);

    var metaLine = metaParts.length
      ? '<div class="mt-print-meta">' + metaParts.join(' | ') + '</div>'
      : '';

    return '' +
      '<div class="mt-print-header">' +
        '<div class="mt-print-title">' + title + '</div>' +
        metaLine +
      '</div>';
  }

  function buildPrintModes() {
    return [
      L.BrowserPrint.Mode.Landscape('A4', {
        title: 'Drucken',
        margin: {
          top: 2,
          right: 2,
          bottom: 2,
          left: 2
        },
        enableZoom: false,
        header: {
          enabled: true,
          text: buildHeaderHtml(),
          size: '14mm',
          overTheMap: true
        },
        footer: {
          enabled: true,
          text: 'Integrationsmonitoring Niedersachsen',
          size: '6mm',
          overTheMap: true
        }
      })
    ];
  }

  function removeExistingPrintLegend(printMap) {
    if (!printMap || !printMap.getContainer) return;

    var container = printMap.getContainer();
    var existing = container.querySelector('.mt-print-legend-overlay');
    if (existing) {
      existing.remove();
    }
  }

  function addLegendToPrintMap(printMap) {
    if (!printMap || !printMap.getContainer) return;

    var legend = findVisibleLegend();
    if (!legend) {
      log('Keine sichtbare Legende gefunden.');
      return;
    }

    var container = printMap.getContainer();
    removeExistingPrintLegend(printMap);

    var wrapper = document.createElement('div');
    wrapper.className = 'mt-print-legend-overlay';

    var heading = document.createElement('div');
    heading.className = 'mt-print-legend-heading';
    heading.textContent = 'Legende';
    wrapper.appendChild(heading);

    var clonedLegend = legend.cloneNode(true);
    clonedLegend.classList.add('mt-print-legend-clone');
    wrapper.appendChild(clonedLegend);

    container.appendChild(wrapper);
  }

  function attachPrintControl(map) {
    if (!isLeafletAvailable()) {
      warn('Leaflet oder leaflet.browser.print ist nicht verfügbar.');
      return false;
    }

    if (!map || map._mtPrintControlAdded) {
      return false;
    }

    var baseLayer = getPrintableBaseLayer(map);

    try {
      var control = L.control.browserPrint({
        title: 'Karte drucken',
        position: 'topleft',
        documentTitle: getIndicatorTitle(),
        printLayer: baseLayer,
        printModes: buildPrintModes()
      }).addTo(map);

      map.on(L.BrowserPrint.Event.PrintStart, function (event) {
        if (event && event.printMap) {
          addLegendToPrintMap(event.printMap);
        }
      });

      map.on(L.BrowserPrint.Event.PrintEnd, function (event) {
        if (event && event.printMap) {
          removeExistingPrintLegend(event.printMap);
        }
      });

      map._mtPrintControlAdded = true;
      map._mtPrintControl = control;
      state.attached = true;

      log('Print-Control hinzugefügt.');
      stopWatching();
      return true;
    } catch (error) {
      warn('Fehler beim Hinzufügen des Print-Controls.', error);
      return false;
    }
  }

  function attachIfPossible() {
    if (state.attached) return true;

    var goodMaps = state.maps.filter(isGoodTargetMap);
    if (!goodMaps.length) return false;

    return attachPrintControl(goodMaps[0]);
  }

  function observeMapView() {
    var mapView = getMapView();
    if (!mapView || state.observer) return;

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
  }

  function startPolling() {
    if (state.interval) return;

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
