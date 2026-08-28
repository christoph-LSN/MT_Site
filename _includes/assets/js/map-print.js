(function () {
  'use strict';

  var MAP_PRINT_ENABLED = !(
    window.MT_FEATURES &&
    window.MT_FEATURES.mapPrint === false
  );

  window.MT_MAP_PRINT_ENABLED = MAP_PRINT_ENABLED;

  if (window.console && console.log) {
    console.log('[map-print] Script loaded. MAP_PRINT_ENABLED =', MAP_PRINT_ENABLED);
  }

  if (!MAP_PRINT_ENABLED) {
    if (window.console && console.log) {
      console.log('[map-print] Disabled by _config.yml.');
    }
    return;
  }

  var DEBUG = false;

  var state = {
    maps: [],
    attached: false,
    observer: null,
    interval: null,
    cachedLegendHtml: '',
    cachedYearText: '',
    cachedDisaggregationHtml: ''
  };

  function log(message, data) {
    if (!DEBUG || !window.console || !console.log) return;
    if (typeof data !== 'undefined') {
      console.log('[map-print] ' + message, data);
    } else {
      console.log('[map-print] ' + message);
    }
  }

  function warn(message, data) {
    if (!window.console || !console.warn) return;
    if (typeof data !== 'undefined') {
      console.warn('[map-print] ' + message, data);
    } else {
      console.warn('[map-print] ' + message);
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
    return !!(
      element.offsetWidth ||
      element.offsetHeight ||
      element.getClientRects().length
    );
  }

  function isInsideMapView(element) {
    var mapView = getMapView();
    if (!mapView || !element) return false;
    return mapView === element || mapView.contains(element);
  }

  function uniquePushMap(map) {
    if (!map) return;

    var exists = state.maps.some(function (existing) {
      return existing === map;
    });

    if (!exists) {
      state.maps.push(map);
      log('Leaflet map registered.', map);
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

    log('Leaflet init hook registered.');
  }

  function patchLeafletMapFactory() {
    if (!window.L || !L.map) return;
    if (window.__mtMapPrintFactoryPatched) return;

    window.__mtMapPrintFactoryPatched = true;

    var originalMapFactory = L.map;

    L.map = function () {
      var map = originalMapFactory.apply(this, arguments);
      uniquePushMap(map);

      window.setTimeout(function () {
        attachIfPossible();
      }, 0);

      return map;
    };

    log('Leaflet L.map factory patched.');
  }

  function scanWindowForMaps() {
    if (!window.L || !L.Map) return;

    Object.keys(window).forEach(function (key) {
      try {
        if (window[key] instanceof L.Map) {
          uniquePushMap(window[key]);
        }
      } catch (e) {
        // Ignore inaccessible properties.
      }
    });
  }

  function scanKnownNamespacesForMaps() {
    if (!window.L || !L.Map) return;

    var namespaces = [
      window.OpenSDG,
      window.openSDG,
      window.SDG,
      window.sdg,
      window.app,
      window.App
    ];

    namespaces.forEach(function (namespace) {
      if (!namespace || typeof namespace !== 'object') return;

      Object.keys(namespace).forEach(function (key) {
        try {
          if (namespace[key] instanceof L.Map) {
            uniquePushMap(namespace[key]);
          }
        } catch (e) {
          // Ignore inaccessible properties.
        }
      });
    });
  }

  function isGoodTargetMap(map) {
    if (!map || !map.getContainer) return false;

    var container = map.getContainer();
    return !!(
      container &&
      isInsideMapView(container) &&
      isVisible(container)
    );
  }

  function getPrintableBaseLayer(map) {
    var found = null;

    map.eachLayer(function (layer) {
      if (found) return;

      if (
        (window.L.TileLayer && layer instanceof L.TileLayer) ||
        (
          window.L.TileLayer &&
          window.L.TileLayer.WMS &&
          layer instanceof L.TileLayer.WMS
        )
      ) {
        found = layer;
      }
    });

    return found;
  }

  function getIndicatorTitle() {
    var element =
      document.querySelector('.heading h1') ||
      document.querySelector('h1');

    if (element && element.textContent) {
      return element.textContent.trim();
    }

    return document.title || 'Map';
  }

  function getDataSourceLabel() {
    return '{{ page.t.metadata_fields.data_source | default: "Quelle" | escape }}';
  }

  function getReferenceYearLabel() {
    return '{{ page.t.metadata_fields.reference_year | default: "Jahr" | escape }}';
  }

  function looksLikeObjectDump(value) {
    if (!value) return false;

    var text = String(value).trim();

    return (
      text.indexOf("number='") !== -1 ||
      text.indexOf("slug='") !== -1 ||
      text.indexOf("name='") !== -1 ||
      text.indexOf('url=') !== -1 ||
      text.indexOf('=&gt;') !== -1 ||
      (text.indexOf('{') !== -1 && text.indexOf('}') !== -1)
    );
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getIndicatorNumberValue() {
    var explicitValue =
      '{{ page.indicator.number | default: page.indicator_number | default: "" | escape }}';

    if (explicitValue && !looksLikeObjectDump(explicitValue)) {
      return explicitValue;
    }

    var match = getIndicatorTitle().match(/\b\d+(?:\.\d+)+\b/);
    return match ? match[0] : '';
  }

  function getIndicatorNameValue() {
    var explicitValue =
      '{{ page.indicator.name | default: page.indicator_name | default: "" | escape }}';

    if (explicitValue && !looksLikeObjectDump(explicitValue)) {
      return explicitValue;
    }

    var title = getIndicatorTitle();
    var match = title.match(/\b\d+(?:\.\d+)+\b\s+(.*)$/);

    if (match && match[1]) {
      return match[1].trim();
    }

    return title;
  }

  function getPrintHeadingText() {
    var number = getIndicatorNumberValue();
    var name = getIndicatorNameValue();

    if (number && name) return number + ' ' + name;
    if (name) return name;
    return getIndicatorTitle();
  }

  function getCurrentYearText() {
    var selectors = [
      '#mapview .timecontrol-date',
      '#mapview .leaflet-control-timecontrol .noUi-tooltip',
      '#mapview .leaflet-control-timecontrol .timecontrol-slider + span',
      '#mapview .leaflet-control-timecontrol [aria-valuenow]',
      '#mapview .leaflet-control-timecontrol input',
      '#mapview .leaflet-control-timecontrol',
      '#mapview .year',
      '#mapview .current-year'
    ];

    var yearPattern = /\b(19|20)\d{2}\b/;
    var foundYears = [];

    selectors.forEach(function (selector) {
      var nodes = document.querySelectorAll(selector);

      nodes.forEach(function (node) {
        if (!isVisible(node)) return;

        var candidates = [
          node.getAttribute && node.getAttribute('aria-valuenow'),
          node.getAttribute && node.getAttribute('data-value'),
          node.value,
          (node.textContent || '').trim()
        ];

        candidates.forEach(function (candidate) {
          if (!candidate) return;
          var match = String(candidate).match(yearPattern);
          if (match) foundYears.push(match[0]);
        });
      });
    });

    return foundYears.length ? foundYears[foundYears.length - 1] : '';
  }

  function getCurrentMapDisaggregations() {
    var items = [];
    var dimensionLabels = {
      Units: 'Einheit',
      Geschlecht: 'Geschlecht',
      Kategorie: 'Kategorie'
    };

    document.querySelectorAll('input:checked').forEach(function (element) {
      if (!element.name || element.name.indexOf('map-') !== 0) return;

      var dimension = element.name.replace('map-', '').trim();
      dimension = dimensionLabels[dimension] || dimension;

      var value = '';

      if (
        element.labels &&
        element.labels.length &&
        element.labels[0].textContent
      ) {
        value = element.labels[0].textContent.trim();
      } else if (element.value) {
        value = String(element.value).trim();
      }

      if (dimension && value) {
        items.push({ dimension: dimension, value: value });
      }
    });

    return items;
  }

  function buildMapDisaggregationsHtml() {
    var items = getCurrentMapDisaggregations();
    if (!items.length) return '';

    return (
      '<div class="mt-print-meta mt-print-disaggregations">' +
        '<strong>Kartenauswahl:</strong> ' +
        items.map(function (item) {
          return (
            '<span class="mt-print-disaggregation-item">' +
              escapeHtml(item.dimension) + ': ' + escapeHtml(item.value) +
            '</span>'
          );
        }).join(' · ') +
      '</div>'
    );
  }

  function cacheCurrentYearText() {
    state.cachedYearText = getCurrentYearText();
    log('Year cached before print.', state.cachedYearText);
  }

  function cacheCurrentMapDisaggregations() {
    state.cachedDisaggregationHtml = buildMapDisaggregationsHtml();
    log('Map disaggregations cached before print.', state.cachedDisaggregationHtml);
  }

  function findLegendElement() {
    var selectors = [
      '#mapview .selection-legend.leaflet-control',
      '#mapview .leaflet-top.leaflet-right .selection-legend.leaflet-control',
      '#mapview .leaflet-top.leaflet-right .leaflet-control:not(.leaflet-control-attribution):not(.leaflet-control-zoom)',
      '#mapview .leaflet-right .leaflet-control:not(.leaflet-control-attribution):not(.leaflet-control-zoom)',
      '#mapview .legend',
      '#mapview .map-legend',
      '#mapview .legend-container'
    ];

    for (var i = 0; i < selectors.length; i += 1) {
      var candidates = document.querySelectorAll(selectors[i]);

      for (var j = 0; j < candidates.length; j += 1) {
        if (isVisible(candidates[j])) return candidates[j];
      }

      if (candidates.length) return candidates[0];
    }

    return null;
  }

  function hasSelectedLegendItems() {
    var legend = findLegendElement();
    if (!legend) return false;

    var selectionList = legend.querySelector('#selection-list');
    return !!(selectionList && selectionList.children.length);
  }

  function removeTransientMapUi(root) {
    if (!root) return;

    [
      '.leaflet-tooltip',
      '.leaflet-popup',
      '.leaflet-popup-pane',
      '[role="tooltip"]',
      '.tooltip'
    ].forEach(function (selector) {
      root.querySelectorAll(selector).forEach(function (element) {
        if (element.parentNode) element.parentNode.removeChild(element);
      });
    });
  }

  function cacheLegendHtml() {
    var legend = findLegendElement();

    if (!legend) {
      state.cachedLegendHtml = '';
      warn('No legend found in the original DOM.');
      return;
    }

    state.cachedLegendHtml = legend.outerHTML;
    log('Legend cached.');
  }

  function buildHeaderHtml() {
    var yearText = state.cachedYearText || getCurrentYearText();
    var yearHtml = '';

    if (yearText) {
      yearHtml =
        '<div class="mt-print-meta"><strong>' +
          escapeHtml(getReferenceYearLabel()) + ': </strong>' +
          escapeHtml(yearText) +
        '</div>';
    }

    return (
      '<div class="mt-print-header">' +
        '<div class="mt-print-title">' +
          escapeHtml(getPrintHeadingText()) +
        '</div>' +
        yearHtml +
      '</div>'
    );
  }

  function buildFooterHtml() {
    var sourceText = 'www.integrationsmonitoring.niedersachsen.de';

    return (
      '<div class="mt-print-footer-source">' +
        '<strong>' + escapeHtml(getDataSourceLabel()) + ':</strong> ' +
        escapeHtml(sourceText) +
      '</div>'
    );
  }

  function buildPrintModes() {
    return [
      L.BrowserPrint.Mode.Landscape('A4', {
        title: 'Print',
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        enableZoom: false,
        header: { enabled: false, text: '', size: '0mm', overTheMap: true },
        footer: { enabled: false, text: '', size: '0mm', overTheMap: true }
      })
    ];
  }

  function getPrintOverlayRoot(printMap) {
    if (!printMap || !printMap.getContainer) return null;

    var mapContainer = printMap.getContainer();
    if (!mapContainer) return null;

    return (
      mapContainer.closest('.grid-print-container') ||
      mapContainer.parentNode ||
      mapContainer
    );
  }

  function ensurePrintOverlayStyles(root) {
    if (!root) return;

    var doc = root.ownerDocument || document;
    if (doc.getElementById('mt-print-overlay-styles')) return;

    var style = doc.createElement('style');
    style.id = 'mt-print-overlay-styles';
    style.textContent = [
      '@page { size: A4 landscape; margin: 0; }',
      '@media print {',
      '  html, body { width: 297mm !important; height: 210mm !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }',
      '  .leaflet-print-overlay { position: fixed !important; inset: 0 !important; width: 297mm !important; height: 210mm !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; display: flex !important; align-items: center !important; justify-content: center !important; box-sizing: border-box !important; }',
      '  .grid-print-container { position: relative !important; flex: 0 0 270mm !important; width: 270mm !important; height: 190mm !important; min-width: 270mm !important; min-height: 190mm !important; max-width: 270mm !important; max-height: 190mm !important; margin: 0 !important; padding: 0 !important; top: auto !important; left: auto !important; right: auto !important; bottom: auto !important; overflow: hidden !important; box-sizing: border-box !important; transform: none !important; page-break-before: avoid !important; page-break-after: avoid !important; page-break-inside: avoid !important; break-before: avoid !important; break-after: avoid !important; break-inside: avoid !important; }',
      '  #map-print, .grid-map-print { position: relative !important; width: 270mm !important; height: 190mm !important; min-width: 270mm !important; min-height: 190mm !important; max-width: 270mm !important; max-height: 190mm !important; margin: 0 !important; padding: 0 !important; top: 0 !important; left: 0 !important; overflow: hidden !important; box-sizing: border-box !important; transform: none !important; }',
      '}',
      '.mt-print-header-overlay { position: absolute; left: 5mm; top: 3mm; z-index: 99999; max-width: 240mm; color: #000; font-family: Arial, sans-serif; line-height: 1.15; pointer-events: none; }',
      '.mt-print-header-overlay .mt-print-title { font-size: 10.5pt; font-weight: 700; margin: 0 0 1mm 0; }',
      '.mt-print-header-overlay .mt-print-meta { font-size: 7pt; margin: 0; }',
      '.mt-print-footer-overlay { position: absolute; left: 5mm; bottom: 3mm; z-index: 99999; color: #000; font-family: Arial, sans-serif; font-size: 6pt; line-height: 1.1; pointer-events: none; }',
      '.mt-print-disaggregation-overlay { position: absolute; left: 6mm; top: 14mm; z-index: 99999; max-width: 185mm; padding: 2.5mm 3.5mm; background: rgba(255,255,255,0.9); border: 1px solid rgba(0,0,0,0.25); border-radius: 2mm; font-family: Arial, sans-serif; font-size: 8pt; line-height: 1.25; color: #000; box-sizing: border-box; }',
      '.mt-print-disaggregation-overlay .mt-print-meta { margin: 0; }',
      '.mt-print-disaggregation-item { display: inline; }',
      '.mt-print-legend-overlay { position: absolute; top: 7mm; right: 7mm; z-index: 99999; max-width: 55mm; box-sizing: border-box; }',
      '.mt-print-legend-heading { display: none; }',
      '.mt-print-legend-clone .leaflet-control { margin: 0 !important; }'
    ].join('\n');

    if (doc.head) doc.head.appendChild(style);
  }

  function setImportantStyle(element, property, value) {
    if (element && element.style) {
      element.style.setProperty(property, value, 'important');
    }
  }

  function forcePrintMapToSingleSheet(printMap) {
    if (!printMap || !printMap.getContainer) return;

    var container = printMap.getContainer();
    if (!container) return;

    var root = getPrintOverlayRoot(printMap) || container;
    var sizeProperties = {
      width: '270mm',
      height: '190mm',
      'min-width': '270mm',
      'min-height': '190mm',
      'max-width': '270mm',
      'max-height': '190mm'
    };

    Object.keys(sizeProperties).forEach(function (property) {
      setImportantStyle(root, property, sizeProperties[property]);
      setImportantStyle(container, property, sizeProperties[property]);
    });

    setImportantStyle(root, 'margin', '0');
    setImportantStyle(root, 'padding', '0');
    setImportantStyle(root, 'position', 'relative');
    setImportantStyle(root, 'top', 'auto');
    setImportantStyle(root, 'left', 'auto');
    setImportantStyle(root, 'overflow', 'hidden');
    setImportantStyle(root, 'box-sizing', 'border-box');
    setImportantStyle(root, 'transform', 'none');
    setImportantStyle(root, 'page-break-inside', 'avoid');
    setImportantStyle(root, 'break-inside', 'avoid');

    setImportantStyle(container, 'margin', '0');
    setImportantStyle(container, 'padding', '0');
    setImportantStyle(container, 'top', '0');
    setImportantStyle(container, 'left', '0');
    setImportantStyle(container, 'overflow', 'hidden');
    setImportantStyle(container, 'box-sizing', 'border-box');
    setImportantStyle(container, 'transform', 'none');

    try {
      printMap.invalidateSize(false);
    } catch (e) {
      warn('Could not invalidate print map size.', e);
    }

    window.setTimeout(function () {
      try {
        printMap.invalidateSize(false);
      } catch (e) {
        warn('Could not invalidate delayed print map size.', e);
      }
    }, 100);
  }

  function removeElements(root, selector) {
    if (!root) return;

    root.querySelectorAll(selector).forEach(function (element) {
      if (element.parentNode) element.parentNode.removeChild(element);
    });
  }

  function removeExistingPrintHeaderFooter(root) {
    removeElements(root, '.mt-print-header-overlay, .mt-print-footer-overlay');
  }

  function removeExistingPrintLegend(root) {
    removeElements(root, '.mt-print-legend-overlay');
  }

  function removeExistingPrintDisaggregations(root) {
    removeElements(root, '.mt-print-disaggregation-overlay');
  }

  function addHeaderFooterToPrintMap(printMap) {
    var root = getPrintOverlayRoot(printMap);
    if (!root) return;

    ensurePrintOverlayStyles(root);
    removeExistingPrintHeaderFooter(root);

    var doc = root.ownerDocument || document;
    var header = doc.createElement('div');
    var footer = doc.createElement('div');

    header.className = 'mt-print-header-overlay';
    header.innerHTML = buildHeaderHtml();
    root.appendChild(header);

    footer.className = 'mt-print-footer-overlay';
    footer.innerHTML = buildFooterHtml();
    root.appendChild(footer);
  }

  function addDisaggregationsToPrintMap(printMap) {
    var root = getPrintOverlayRoot(printMap);
    if (!root) return;

    removeExistingPrintDisaggregations(root);
    ensurePrintOverlayStyles(root);

    var html = state.cachedDisaggregationHtml || buildMapDisaggregationsHtml();
    if (!html) return;

    var doc = root.ownerDocument || document;
    var wrapper = doc.createElement('div');
    wrapper.className = 'mt-print-disaggregation-overlay';
    wrapper.innerHTML = html;
    root.appendChild(wrapper);
  }

  function addLegendToPrintMap(printMap) {
    var root = getPrintOverlayRoot(printMap);
    if (!root) return;

    removeExistingPrintLegend(root);

    if (!state.cachedLegendHtml) {
      warn('No cached legend available.');
      return;
    }

    var doc = root.ownerDocument || document;
    var wrapper = doc.createElement('div');
    var heading = doc.createElement('div');
    var legendHolder = doc.createElement('div');

    wrapper.className = 'mt-print-legend-overlay';
    heading.className = 'mt-print-legend-heading';
    heading.textContent = '{{ page.t.indicator.map_legend | default: "Legend" | escape }}';
    legendHolder.className = 'mt-print-legend-clone';
    legendHolder.innerHTML = state.cachedLegendHtml;

    wrapper.appendChild(heading);
    wrapper.appendChild(legendHolder);
    root.appendChild(wrapper);
  }

  function attachPrintControl(map) {
    if (!isLeafletAvailable() || !map || map._mtPrintControlAdded) return false;

    var baseLayer = getPrintableBaseLayer(map);

    try {
      var printOptions = {
        title: 'Karte drucken',
        position: 'topleft',
        documentTitle: getIndicatorTitle(),
        printModes: buildPrintModes()
      };

      if (baseLayer) printOptions.printLayer = baseLayer;

      L.control.browserPrint(printOptions).addTo(map);

      map.on(L.BrowserPrint.Event.PrePrint, function () {
        var hasSelection = hasSelectedLegendItems();

        document.body.classList.toggle('mt-print-has-selection', hasSelection);
        cacheCurrentYearText();
        cacheCurrentMapDisaggregations();

        if (!hasSelection) removeTransientMapUi(map.getContainer());
        cacheLegendHtml();
      });

      map.on(L.BrowserPrint.Event.Print, function (event) {
        if (!event || !event.printMap) return;

        var printMap = event.printMap;
        var root = getPrintOverlayRoot(printMap);

        ensurePrintOverlayStyles(root);
        forcePrintMapToSingleSheet(printMap);

        window.setTimeout(function () {
          if (!hasSelectedLegendItems()) {
            removeTransientMapUi(printMap.getContainer());
          }

          addHeaderFooterToPrintMap(printMap);
          addDisaggregationsToPrintMap(printMap);
          addLegendToPrintMap(printMap);

          try {
            printMap.invalidateSize(false);
          } catch (e) {
            warn('Could not invalidate final print map size.', e);
          }
        }, 50);
      });

      map.on(L.BrowserPrint.Event.PrintEnd, function (event) {
        if (event && event.printMap) {
          var root = getPrintOverlayRoot(event.printMap);
          removeExistingPrintHeaderFooter(root);
          removeExistingPrintLegend(root);
          removeExistingPrintDisaggregations(root);
        }

        document.body.classList.remove('mt-print-has-selection');
        state.cachedYearText = '';
        state.cachedDisaggregationHtml = '';
        state.cachedLegendHtml = '';
      });

      map._mtPrintControlAdded = true;
      state.attached = true;
      stopWatching();
      log('Print control attached successfully.');
      return true;
    } catch (error) {
      warn('Failed to attach print control.', error);
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

      if (window.L && L.Map) {
        registerLeafletInitHook();
        patchLeafletMapFactory();
        scanWindowForMaps();
        scanKnownNamespacesForMaps();
      }

      if (isLeafletAvailable()) attachIfPossible();
    });

    state.observer.observe(mapView, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }

  function startReadinessWatcher() {
    if (state.interval) return;

    var attempts = 0;
    var maxAttempts = 240;

    state.interval = window.setInterval(function () {
      if (state.attached) {
        stopWatching();
        return;
      }

      attempts += 1;
      observeMapView();

      if (window.L && L.Map) {
        registerLeafletInitHook();
        patchLeafletMapFactory();
        scanWindowForMaps();
        scanKnownNamespacesForMaps();
      }

      if (isLeafletAvailable()) {
        attachIfPossible();
      } else if (attempts === 1 || attempts % 20 === 0) {
        warn('Waiting for Leaflet browser print plugin.', {
          attempt: attempts,
          leaflet: !!window.L,
          leafletMap: !!(window.L && L.Map),
          browserPrint: !!(window.L && L.control && L.control.browserPrint),
          mapViewFound: !!getMapView(),
          knownMaps: state.maps.length
        });
      }

      if (attempts >= maxAttempts) {
        window.clearInterval(state.interval);
        state.interval = null;
        warn('Map print readiness watcher timed out. Will retry on map tab activation.');
      }
    }, 500);
  }

  function bindMapActivationEvents() {
    if (window.__mtMapPrintActivationEventsBound) return;
    window.__mtMapPrintActivationEventsBound = true;

    function retryAfterMapActivation() {
      window.setTimeout(function () {
        if (state.attached) return;

        observeMapView();

        if (window.L && L.Map) {
          registerLeafletInitHook();
          patchLeafletMapFactory();
          scanWindowForMaps();
          scanKnownNamespacesForMaps();
        }

        if (isLeafletAvailable()) attachIfPossible();
        if (!state.attached) startReadinessWatcher();
      }, 300);
    }

    document.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;

      var mapTab = target.closest(
        '#tab-mapview, a[href="#mapview"], button[data-bs-target="#mapview"], button[data-target="#mapview"]'
      );

      if (mapTab) retryAfterMapActivation();
    }, true);

    document.addEventListener('shown.bs.tab', function (event) {
      var target = event.target;
      if (!target || !target.matches) return;

      if (target.matches(
        '#tab-mapview, a[href="#mapview"], button[data-bs-target="#mapview"], button[data-target="#mapview"]'
      )) {
        retryAfterMapActivation();
      }
    });

    window.addEventListener('hashchange', function () {
      if (window.location.hash === '#mapview') retryAfterMapActivation();
    });
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
    if (window.L && L.Map) {
      registerLeafletInitHook();
      patchLeafletMapFactory();
      scanWindowForMaps();
      scanKnownNamespacesForMaps();
    }

    bindMapActivationEvents();
    observeMapView();
    startReadinessWatcher();

    if (isLeafletAvailable()) attachIfPossible();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
