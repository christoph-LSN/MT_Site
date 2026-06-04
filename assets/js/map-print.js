(function () {
  'use strict';

  // Globale Sammlung aller gefundenen Leaflet-Maps.
  window.MTLeafletMaps = window.MTLeafletMaps || [];

  function log(message) {
    if (window.console && console.log) {
      console.log('[map-print] ' + message);
    }
  }

  function warn(message) {
    if (window.console && console.warn) {
      console.warn('[map-print] ' + message);
    }
  }

  function uniquePushMap(map) {
    if (!map) return;

    var exists = window.MTLeafletMaps.some(function (existingMap) {
      return existingMap === map;
    });

    if (!exists) {
      window.MTLeafletMaps.push(map);
    }
  }

  function registerLeafletInitHook() {
    if (!window.L || !L.Map || !L.Map.addInitHook) {
      return false;
    }

    if (window.__mtLeafletPrintHookRegistered) {
      return true;
    }

    window.__mtLeafletPrintHookRegistered = true;

    L.Map.addInitHook(function () {
      uniquePushMap(this);
      tryAttachPrintControl(this);
    });

    return true;
  }

  function scanWindowForLeafletMaps() {
    if (!window.L || !L.Map) {
      return;
    }

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

  function scanJQueryDataForLeafletMaps() {
    if (!window.jQuery || !window.L || !L.Map) {
      return;
    }

    var $mapView = window.jQuery('#mapview');
    if (!$mapView.length) {
      return;
    }

    var data = $mapView.data() || {};
    Object.keys(data).forEach(function (key) {
      try {
        if (data[key] instanceof L.Map) {
          uniquePushMap(data[key]);
        }
      } catch (e) {
        // ignorieren
      }
    });
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

  function getMapViewElement() {
    return document.getElementById('mapview');
  }

  function isRelevantMap(map) {
    if (!map || !map.getContainer) {
      return false;
    }

    var container = map.getContainer();
    if (!container) {
      return false;
    }

    var mapView = getMapViewElement();

    // Wenn #mapview existiert, dann nur Maps in diesem Bereich anfassen.
    if (mapView) {
      return mapView === container || mapView.contains(container) || container.contains(mapView);
    }

    // Fallback: wenn es keine #mapview gibt, akzeptieren wir die Map.
    return true;
  }

  function getPrintableBaseLayer(map) {
    if (!window.L || !map || !map.eachLayer) {
      return null;
    }

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

  function buildPrintModes(title, subtitle) {
    var headerText = title;
    var footerText = subtitle;

    return [
      L.BrowserPrint.Mode.Landscape('A4', {
        title: 'Drucken (Querformat)',
        header: {
          enabled: true,
          text: headerText,
          size: '12mm',
          overTheMap: false
        },
        footer: {
          enabled: true,
          text: footerText,
          size: '8mm',
          overTheMap: false
        }
      }),
      L.BrowserPrint.Mode.Auto('A4', {
        title: 'Drucken (Automatisch)',
        header: {
          enabled: true,
          text: headerText,
          size: '12mm',
          overTheMap: false
        },
        footer: {
          enabled: true,
          text: footerText,
          size: '8mm',
          overTheMap: false
        }
      })
    ];
  }

  function tryAttachPrintControl(map) {
    if (!window.L || !L.control || !L.control.browserPrint) {
      return false;
    }

    if (!map || map._mtPrintControlAdded) {
      return false;
    }

    if (!isRelevantMap(map)) {
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

      log('Print-Control hinzugefügt.');
      return true;
    } catch (error) {
      warn('Print-Control konnte nicht hinzugefügt werden: ' + error);
      return false;
    }
  }

  function tryAttachToKnownMaps() {
    var success = false;

    window.MTLeafletMaps.forEach(function (map) {
      var attached = tryAttachPrintControl(map);
      if (attached) {
        success = true;
      }
    });

    return success;
  }

  function bootstrap() {
    if (!window.L) {
      warn('Leaflet (L) ist noch nicht verfügbar.');
      return;
    }

    if (!L.control || !L.control.browserPrint) {
      warn('leaflet.browser.print ist noch nicht verfügbar.');
      return;
    }

    registerLeafletInitHook();
    scanWindowForLeafletMaps();
    scanJQueryDataForLeafletMaps();

    if (tryAttachToKnownMaps()) {
      return;
    }

    // Fallback: noch einige Sekunden pollen, falls die Karte später initialisiert wird.
    var attempts = 0;
    var maxAttempts = 40;

    var interval = window.setInterval(function () {
      attempts += 1;

      scanWindowForLeafletMaps();
      scanJQueryDataForLeafletMaps();

      var attached = tryAttachToKnownMaps();
      if (attached || attempts >= maxAttempts) {
        window.clearInterval(interval);

        if (!attached) {
          warn('Keine passende Leaflet-Karte für den Print-Control gefunden.');
        }
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
