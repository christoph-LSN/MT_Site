(function () {
  'use strict';

  /**
   * Feature switch from scripts-custom.html / _config.yml.
   *
   * Expected global value:
   * window.MT_FEATURES.mapPrint
   *
   * Default behavior:
   * - missing config/global: enabled
   * - true: enabled
   * - false: disabled
   */
  var MAP_PRINT_ENABLED = true;

  if (
    window.MT_FEATURES &&
    window.MT_FEATURES.mapPrint === false
  ) {
    MAP_PRINT_ENABLED = false;
  }

  window.MT_MAP_PRINT_ENABLED = MAP_PRINT_ENABLED;

  if (window.console && console.log) {
    console.log('[map-print] Script loaded. MAP_PRINT_ENABLED =', MAP_PRINT_ENABLED);
  }

  if (MAP_PRINT_ENABLED === false) {
    if (window.console && console.log) {
      console.log('[map-print] Disabled by _config.yml.');
    }
    return;
  }

  /**
   * Toggle this to true while diagnosing map print issues.
   */
  var DEBUG = false;

  /**
   * Shared runtime state for the print integration.
   */
  var state = {
    maps: [],
    attached: false,
    observer: null,
    interval: null,
    cachedLegendHtml: '',
    cachedYearText: '',
    cachedDisaggregationHtml: ''
  };

  /**
   * Small logging helper for development/debugging.
   */
  function log(message, data) {
    if (!DEBUG) return;

    if (window.console && console.log) {
      if (typeof data !== 'undefined') {
        console.log('[map-print] ' + message, data);
      } else {
        console.log('[map-print] ' + message);
      }
    }
  }

  /**
   * Small warning helper.
   */
  function warn(message, data) {
    if (window.console && console.warn) {
      if (typeof data !== 'undefined') {
        console.warn('[map-print] ' + message, data);
      } else {
        console.warn('[map-print] ' + message);
      }
    }
  }

  /**
   * Check whether Leaflet and leaflet.browser.print are both available.
   */
  function isLeafletAvailable() {
    return !!(window.L && L.Map && L.control && L.control.browserPrint);
  }

  /**
   * The Open SDG map is rendered inside the tab panel with id="mapview".
   */
  function getMapView() {
    return document.getElementById('mapview');
  }

  /**
   * Determine whether an element is visually present on the page.
   */
  function isVisible(element) {
    if (!element) return false;
    return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  }

  /**
   * Check whether a DOM element belongs to the map view area.
   */
  function isInsideMapView(element) {
    var mapView = getMapView();
    if (!mapView || !element) return false;
    return mapView === element || mapView.contains(element);
  }

  /**
   * Store a Leaflet map instance exactly once.
   */
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

  /**
   * Register a Leaflet init hook so that every map created afterwards
   * is automatically tracked.
   */
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

  /**
   * Monkey-patch L.map as an additional safety net.
   */
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

  /**
   * Also scan global window properties for already existing Leaflet maps.
   */
  function scanWindowForMaps() {
    if (!window.L || !L.Map) return;

    Object.keys(window).forEach(function (key) {
      try {
        if (window[key] instanceof L.Map) {
          uniquePushMap(window[key]);
        }
      } catch (e) {
        // Ignore cross-origin / inaccessible properties.
      }
    });
  }

  /**
   * Try to scan common Open SDG/global namespaces for map instances.
   */
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

  /**
   * Decide whether a discovered map is the correct target.
   */
  function isGoodTargetMap(map) {
    if (!map || !map.getContainer) return false;

    var container = map.getContainer();
    if (!container) return false;
    if (!isInsideMapView(container)) return false;
    if (!isVisible(container)) return false;

    return true;
  }

  /**
   * Find the base tile layer used in the current map.
   */
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

  /**
   * Read the indicator title from the heading area.
   */
  function getIndicatorTitle() {
    var el =
      document.querySelector('.heading h1') ||
      document.querySelector('h1');

    if (el && el.textContent) {
      return el.textContent.trim();
    }

    return document.title || 'Map';
  }

  /**
   * Translation labels from metadata_fields.yml.
   */
  function getDataSourceLabel() {
    return '{{ page.t.metadata_fields.data_source | default: "Quelle" | escape }}';
  }

  function getReferenceYearLabel() {
    return '{{ page.t.metadata_fields.reference_year | default: "Jahr" | escape }}';
  }

  /**
   * Return true when a value looks like a dumped object / front matter
   * rather than a clean string value.
   */
  function looksLikeObjectDump(value) {
    if (!value) return false;

    var text = String(value).trim();

    return (
      text.indexOf("number='") !== -1 ||
      text.indexOf("slug='") !== -1 ||
      text.indexOf("name='") !== -1 ||
      text.indexOf('url=') !== -1 ||
      text.indexOf('=>') !== -1 ||
      text.indexOf('=&gt;') !== -1 ||
      (text.indexOf('{') !== -1 && text.indexOf('}') !== -1)
    );
  }

  /**
   * Escape user/interface text before inserting it as HTML.
   */
  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Try to get the indicator number from page variables,
   * otherwise parse it from the page heading.
   */
  function getIndicatorNumberValue() {
    var explicitValue =
      '{{ page.indicator.number | default: page.indicator_number | default: "" | escape }}';

    if (explicitValue && !looksLikeObjectDump(explicitValue)) {
      return explicitValue;
    }

    var title = getIndicatorTitle();
    var match = title.match(/\b\d+(?:\.\d+)+\b/);
    return match ? match[0] : '';
  }

  /**
   * Try to get the indicator name from page variables,
   * otherwise parse it from the page heading.
   */
  function getIndicatorNameValue() {
    var explicitValue =
      '{{ page.indicator.name | default: page.indicator_name | default: "" | escape }}';

    if (explicitValue && !looksLikeObjectDump(explicitValue)) {
      return explicitValue;
    }

    var title = getIndicatorTitle();

    // Example heading:
    // "Indikator 1.1.1 Bevölkerung in Niedersachsen"
    var match = title.match(/\b\d+(?:\.\d+)+\b\s+(.*)$/);
    if (match && match[1]) {
      return match[1].trim();
    }

    return title;
  }

  /**
   * Build the print heading from indicator number + indicator name.
   */
  function getPrintHeadingText() {
    var indicatorNumber = getIndicatorNumberValue();
    var indicatorName = getIndicatorNameValue();

    if (indicatorNumber && indicatorName) {
      return indicatorNumber + ' ' + indicatorName;
    }

    if (indicatorName) {
      return indicatorName;
    }

    return getIndicatorTitle();
  }

  /**
   * Extract the currently active year from visible map controls.
   */
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
    var i, j, nodes, text, match;
    var foundYears = [];

    for (i = 0; i < selectors.length; i++) {
      nodes = document.querySelectorAll(selectors[i]);

      for (j = 0; j < nodes.length; j++) {
        if (!isVisible(nodes[j])) continue;

        var attrCandidates = [
          nodes[j].getAttribute && nodes[j].getAttribute('aria-valuenow'),
          nodes[j].getAttribute && nodes[j].getAttribute('data-value'),
          nodes[j].value
        ];

        attrCandidates.forEach(function (candidate) {
          if (!candidate) return;
          var attrMatch = String(candidate).match(yearPattern);
          if (attrMatch) {
            foundYears.push(attrMatch[0]);
          }
        });

        text = (nodes[j].textContent || '').trim();
        if (!text) continue;

        match = text.match(yearPattern);
        if (match) {
          foundYears.push(match[0]);
        }
      }
    }

    if (foundYears.length) {
      return foundYears[foundYears.length - 1];
    }

    return '';
  }

  /**
   * Extract the currently selected map disaggregations.
   */
  function getCurrentMapDisaggregations() {
    var checkedInputs = document.querySelectorAll('input:checked');
    var items = [];

    checkedInputs.forEach(function (el) {
      if (!el.name || el.name.indexOf('map-') !== 0) return;

      var dimension = el.name.replace('map-', '').trim();

      var dimensionLabels = {
        Units: 'Einheit',
        Geschlecht: 'Geschlecht',
        Kategorie: 'Kategorie'
      };

      dimension = dimensionLabels[dimension] || dimension;

      var value = '';

      if (el.labels && el.labels.length && el.labels[0].textContent) {
        value = el.labels[0].textContent.trim();
      } else if (el.value) {
        value = String(el.value).trim();
      }

      if (!dimension || !value) return;

      items.push({
        dimension: dimension,
        value: value
      });
    });

    return items;
  }

  /**
   * Build HTML for the currently selected map disaggregations.
   */
  function buildMapDisaggregationsHtml() {
    var items = getCurrentMapDisaggregations();

    if (!items.length) {
      return '';
    }

    return (
      '<div class="mt-print-meta mt-print-disaggregations">' +
        '<strong>Kartenauswahl:</strong> ' +
        items.map(function (item) {
          return (
            '<span class="mt-print-disaggregation-item">' +
              escapeHtml(item.dimension) +
              ': ' +
              escapeHtml(item.value) +
            '</span>'
          );
        }).join(' · ') +
      '</div>'
    );
  }

  /**
   * Cache the currently visible year before the print view is created.
   */
  function cacheCurrentYearText() {
    state.cachedYearText = getCurrentYearText();
    log('Year cached before print.', state.cachedYearText);
  }

  /**
   * Cache the currently selected map disaggregations before the print view is created.
   */
  function cacheCurrentMapDisaggregations() {
    state.cachedDisaggregationHtml = buildMapDisaggregationsHtml();
    log('Map disaggregations cached before print.', state.cachedDisaggregationHtml);
  }

  /**
   * Find the visible legend element in the live map.
   */
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

    var i, j, candidates;
    for (i = 0; i < selectors.length; i++) {
      candidates = document.querySelectorAll(selectors[i]);

      for (j = 0; j < candidates.length; j++) {
        if (isVisible(candidates[j])) {
          return candidates[j];
        }
      }

      if (candidates.length) {
        return candidates[0];
      }
    }

    return null;
  }

  /**
   * Check whether the live legend currently contains selected-region entries.
   */
  function hasSelectedLegendItems() {
    var legend = findLegendElement();
    if (!legend) return false;

    var selectionList = legend.querySelector('#selection-list');
    if (!selectionList) return false;

    return !!selectionList.children.length;
  }

  /**
   * Remove transient / temporary UI such as hover tooltips or popups
   * from a map-related DOM subtree before printing.
   */
  function removeTransientMapUi(root) {
    if (!root) return;

    var selectors = [
      '.leaflet-tooltip',
      '.leaflet-popup',
      '.leaflet-popup-pane',
      '[role="tooltip"]',
      '.tooltip'
    ];

    selectors.forEach(function (selector) {
      root.querySelectorAll(selector).forEach(function (el) {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      });
    });
  }

  /**
   * Cache the original legend HTML before printing starts.
   */
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

  /**
   * Build the print header.
   */
  function buildHeaderHtml() {
    var title = getPrintHeadingText();
    var yearText = state.cachedYearText || getCurrentYearText();

    var referenceYearLabel = getReferenceYearLabel();
    var lines = [];

    if (yearText) {
      lines.push(
        '<div class="mt-print-meta"><strong>' +
          escapeHtml(referenceYearLabel) +
          ':</strong> ' +
          escapeHtml(yearText) +
        '</div>'
      );
    }

    return '' +
      '<div class="mt-print-header">' +
        '<div class="mt-print-title">' + escapeHtml(title) + '</div>' +
        lines.join('') +
      '</div>';
  }

  /**
   * Build the print footer.
   *
   * Desired output:
   * Quelle: https://www.integrationsmonitoring.niedersachsen.de
   */
  function buildFooterHtml() {
    var dataSourceLabel = getDataSourceLabel();
    var sourceUrl = 'https://www.integrationsmonitoring.niedersachsen.de';

    return (
      '<div class="mt-print-footer-source"><strong>' +
        escapeHtml(dataSourceLabel) +
        ':</strong> ' +
        '<a href="' +
          escapeHtml(sourceUrl) +
          '" +
          escapeHtml(sourceUrl) +
        '</a>' +
      '</div>'
    );
  }

  /**
   * Configure the print mode.
   */
  function buildPrintModes() {
    return [
      L.BrowserPrint.Mode.Landscape('A4', {
        title: 'Print',
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
          size: '16mm',
          overTheMap: true
        },
        footer: {
          enabled: true,
          text: buildFooterHtml(),
          size: '5mm',
          overTheMap: true
        }
      })
    ];
  }

  /**
   * Get the best container for legend/disaggregation injection in the print view.
   */
  function getPrintOverlayRoot(printMap) {
    if (!printMap || !printMap.getContainer) return null;

    var mapContainer = printMap.getContainer();
    if (!mapContainer) return null;

    return mapContainer.closest('.grid-print-container') || mapContainer.parentNode || mapContainer;
  }

  /**
   * Ensure print overlay styles exist in the print document.
   */
  function ensurePrintOverlayStyles(root) {
    if (!root) return;

    var doc = root.ownerDocument || document;

    if (doc.getElementById('mt-print-overlay-styles')) {
      return;
    }

    var style = doc.createElement('style');
    style.id = 'mt-print-overlay-styles';

    style.textContent = ''
      + '.mt-print-disaggregation-overlay {'
      + '  position: absolute;'
      + '  left: 6mm;'
      + '  top: 14mm;'
      + '  z-index: 99999;'
      + '  max-width: 185mm;'
      + '  padding: 2.5mm 3.5mm;'
      + '  background: rgba(255, 255, 255, 0.9);'
      + '  border: 1px solid rgba(0, 0, 0, 0.25);'
      + '  border-radius: 2mm;'
      + '  font-size: 8pt;'
      + '  line-height: 1.25;'
      + '  color: #000;'
      + '  box-sizing: border-box;'
      + '}'
      + '.mt-print-disaggregation-overlay .mt-print-meta {'
      + '  margin: 0;'
      + '}'
      + '.mt-print-disaggregation-item {'
      + '  display: inline;'
      + '}';

    if (doc.head) {
      doc.head.appendChild(style);
    }
  }

  /**
   * Remove any previously added legend from the print view.
   */
  function removeExistingPrintLegend(root) {
    if (!root) return;

    var existing = root.querySelector('.mt-print-legend-overlay');
    if (existing) {
      existing.remove();
    }
  }

  /**
   * Remove any previously added disaggregation overlay from the print view.
   */
  function removeExistingPrintDisaggregations(root) {
    if (!root) return;

    var existing = root.querySelector('.mt-print-disaggregation-overlay');
    if (existing) {
      existing.remove();
    }
  }

  /**
   * Add the cached map disaggregations to the print view as a visible overlay.
   */
  function addDisaggregationsToPrintMap(printMap) {
    var root = getPrintOverlayRoot(printMap);
    if (!root) return;

    removeExistingPrintDisaggregations(root);
    ensurePrintOverlayStyles(root);

    if (!root.style.position) {
      root.style.position = 'relative';
    }

    var html = state.cachedDisaggregationHtml || buildMapDisaggregationsHtml();

    if (!html) {
      warn('No cached map disaggregations available.');
      return;
    }

    var doc = root.ownerDocument || document;
    var wrapper = doc.createElement('div');
    wrapper.className = 'mt-print-disaggregation-overlay';
    wrapper.innerHTML = html;

    root.appendChild(wrapper);
    log('Map disaggregations inserted into print view.');
  }

  /**
   * Add the cached legend to the print view.
   */
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
    wrapper.className = 'mt-print-legend-overlay';

    var heading = doc.createElement('div');
    heading.className = 'mt-print-legend-heading';
    heading.textContent = '{{ page.t.indicator.map_legend | default: "Legend" | escape }}';
    wrapper.appendChild(heading);

    var legendHolder = doc.createElement('div');
    legendHolder.className = 'mt-print-legend-clone';
    legendHolder.innerHTML = state.cachedLegendHtml;
    wrapper.appendChild(legendHolder);

    root.appendChild(wrapper);
    log('Legend inserted into print view.');
  }

  /**
   * Update the print header with the current title/year
   * after the print layout has been created.
   */
  function updatePrintHeader(printMap) {
    var header = null;

    if (printMap && printMap.getContainer) {
      var container = printMap.getContainer();
      var root = getPrintOverlayRoot(printMap);

      if (root) {
        header = root.querySelector('#print-header');
      }

      if (!header && container && container.ownerDocument) {
        header = container.ownerDocument.querySelector('#print-header');
      }
    }

    if (!header) {
      header = document.querySelector('#print-header');
    }

    if (!header) return;

    header.innerHTML = buildHeaderHtml();
  }

  /**
   * Attach the browser print control to the target map.
   */
  function attachPrintControl(map) {
    if (!isLeafletAvailable()) {
      warn('Leaflet or leaflet.browser.print is not available.', {
        leaflet: !!window.L,
        leafletMap: !!(window.L && L.Map),
        leafletControl: !!(window.L && L.control),
        browserPrint: !!(window.L && L.control && L.control.browserPrint)
      });
      return false;
    }

    if (!map) {
      warn('No map instance supplied to attachPrintControl.');
      return false;
    }

    if (map._mtPrintControlAdded) {
      log('Print control already added to this map.');
      return false;
    }

    var baseLayer = getPrintableBaseLayer(map);

    if (!baseLayer) {
      warn('No printable base layer found. Continuing without explicit printLayer.');
    }

    try {
      var printOptions = {
        title: 'Karte drucken',
        position: 'topleft',
        documentTitle: getIndicatorTitle(),
        printModes: buildPrintModes()
      };

      if (baseLayer) {
        printOptions.printLayer = baseLayer;
      }

      L.control.browserPrint(printOptions).addTo(map);

      map.on(L.BrowserPrint.Event.PrePrint, function () {
        var hasSelection = hasSelectedLegendItems();

        document.body.classList.toggle('mt-print-has-selection', hasSelection);

        cacheCurrentYearText();
        cacheCurrentMapDisaggregations();

        if (!hasSelection) {
          removeTransientMapUi(map.getContainer());
        }

        cacheLegendHtml();
      });

      map.on(L.BrowserPrint.Event.Print, function (event) {
        if (event && event.printMap) {
          var hasSelection = hasSelectedLegendItems();

          if (!hasSelection) {
            removeTransientMapUi(event.printMap.getContainer());
          }

          updatePrintHeader(event.printMap);
          addDisaggregationsToPrintMap(event.printMap);
          addLegendToPrintMap(event.printMap);
        }
      });

      map.on(L.BrowserPrint.Event.PrintEnd, function (event) {
        if (event && event.printMap) {
          var root = getPrintOverlayRoot(event.printMap);
          removeExistingPrintLegend(root);
          removeExistingPrintDisaggregations(root);
        }

        document.body.classList.remove('mt-print-has-selection');
        state.cachedYearText = '';
        state.cachedDisaggregationHtml = '';
      });

      map._mtPrintControlAdded = true;
      state.attached = true;

      log('Print control attached successfully.');
      stopWatching();
      return true;
    } catch (error) {
      warn('Failed to attach print control.', error);
      return false;
    }
  }

  /**
   * Attempt to attach the print control to the first suitable map.
   */
  function attachIfPossible() {
    if (state.attached) return true;

    var goodMaps = state.maps.filter(isGoodTargetMap);

    log('attachIfPossible called.', {
      knownMaps: state.maps.length,
      goodMaps: goodMaps.length,
      leafletAvailable: !!window.L,
      browserPrintAvailable: !!(window.L && L.control && L.control.browserPrint),
      mapViewFound: !!getMapView()
    });

    if (!goodMaps.length) return false;

    return attachPrintControl(goodMaps[0]);
  }

  /**
   * Observe #mapview because Open SDG may render or update the map asynchronously.
   */
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

      if (isLeafletAvailable()) {
        attachIfPossible();
      }
    });

    state.observer.observe(mapView, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    log('Map view observer registered.');
  }

  /**
   * Retry until Leaflet, leaflet.browser.print and the map are ready.
   */
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
          leafletControl: !!(window.L && L.control),
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

    log('Readiness watcher started.');
  }

  /**
   * Retry when the user opens the map tab.
   */
  function bindMapActivationEvents() {
    if (window.__mtMapPrintActivationEventsBound) return;
    window.__mtMapPrintActivationEventsBound = true;

    function retryAfterMapActivation() {
      window.setTimeout(function () {
        if (state.attached) return;

        log('Retry after map activation.');

        observeMapView();

        if (window.L && L.Map) {
          registerLeafletInitHook();
          patchLeafletMapFactory();
          scanWindowForMaps();
          scanKnownNamespacesForMaps();
        }

        if (isLeafletAvailable()) {
          attachIfPossible();
        }

        if (!state.attached) {
          startReadinessWatcher();
        }
      }, 300);
    }

    document.addEventListener(
      'click',
      function (event) {
        var target = event.target;
        if (!target || !target.closest) return;

        var mapTab = target.closest(
          '#tab-mapview, a[href="#mapview"], button[data-bs-target="#mapview"], button[data-target="#mapview"]'
        );

        if (mapTab) {
          retryAfterMapActivation();
        }
      },
      true
    );

    document.addEventListener('shown.bs.tab', function (event) {
      var target = event.target;
      if (!target || !target.matches) return;

      if (
        target.matches('#tab-mapview') ||
        target.matches('a[href="#mapview"]') ||
        target.matches('button[data-bs-target="#mapview"]') ||
        target.matches('button[data-target="#mapview"]')
      ) {
        retryAfterMapActivation();
      }
    });

    window.addEventListener('hashchange', function () {
      if (window.location.hash === '#mapview') {
        retryAfterMapActivation();
      }
    });

    log('Map activation events bound.');
  }

  /**
   * Stop all watchers once the print control is attached.
   */
  function stopWatching() {
    if (state.interval) {
      window.clearInterval(state.interval);
      state.interval = null;
    }

    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }

    log('Watchers stopped.');
  }

  /**
   * Initialise the integration.
   */
  function bootstrap() {
    log('Bootstrap started.');
    log('Feature enabled value.', MAP_PRINT_ENABLED);
    log('Leaflet available.', !!window.L);
    log('Leaflet Map available.', !!(window.L && L.Map));
    log('Leaflet control available.', !!(window.L && L.control));
    log('Leaflet browserPrint available.', !!(window.L && L.control && L.control.browserPrint));
    log('Map view element found.', !!getMapView());

    if (window.L && L.Map) {
      registerLeafletInitHook();
      patchLeafletMapFactory();
      scanWindowForMaps();
      scanKnownNamespacesForMaps();
    }

    bindMapActivationEvents();
    observeMapView();
    startReadinessWatcher();

    if (isLeafletAvailable()) {
      attachIfPossible();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
