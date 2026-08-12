(function () {
  'use strict';

  /**
   * Shared runtime state for the print integration.
   *
   * maps:
   *   Stores all Leaflet map instances we discover on the page.
   *
   * attached:
   *   Prevents attaching the print control multiple times.
   *
   * observer / interval:
   *   Used to retry detection while the page and map are still rendering.
   *
   * cachedLegendHtml:
   *   Stores a copy of the original visible legend HTML before printing starts.
   *
   * cachedYearText:
   *   Stores the currently visible year immediately before print starts.
   */
  var state = {
    maps: [],
    attached: false,
    observer: null,
    interval: null,
    cachedLegendHtml: '',
    cachedYearText: ''
  };

  /**
   * Small logging helper for development/debugging.
   */
  function log(message, data) {
    if (window.console && console.log) {
      if (typeof data !== 'undefined') {
        console.log('[map-print] ' + message, data);
      } else {
        console.log('[map-print] ' + message);
      }
    }
  }

  /**
   * Small warning helper for development/debugging.
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
    return mapView === element || mapView.contains(element) || element.contains(mapView);
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
   * Translation labels from metadata_fields.yml
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
      (text.indexOf('{') !== -1 && text.indexOf('}') !== -1)
    );
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
   *
   * We try several selectors and collect visible 4-digit years.
   * In practice the currently active year is usually the last visible match.
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
   * Cache the currently visible year before the print view is created.
   */
  function cacheCurrentYearText() {
    state.cachedYearText = getCurrentYearText();
    log('Year cached before print.', state.cachedYearText);
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
   *
   * This is only used when there is NO selection.
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
   *
   * Heading:
   *   indicator number + indicator name
   *
   * Meta lines:
   *   year
   */
  function buildHeaderHtml() {
    var title = getPrintHeadingText();

    // Prefer the cached year captured immediately before print.
    // Fall back to a live lookup if needed.
    var yearText = state.cachedYearText || getCurrentYearText();

    var referenceYearLabel = getReferenceYearLabel();
    var lines = [];

    if (yearText) {
      lines.push(
        '<div class="mt-print-meta"><strong>' +
          referenceYearLabel +
          ':</strong> ' +
          yearText +
        '</div>'
      );
    }

    return '' +
      '<div class="mt-print-header">' +
        '<div class="mt-print-title">' + title + '</div>' +
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

    return (
      '<div class="mt-print-footer-source"><strong>' +
        dataSourceLabel +
        ':</strong> https://www.integrationsmonitoring.niedersachsen.de</div>'
    );
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
          size: '11mm',
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
   * Get the best container for legend injection in the print view.
   */
  function getPrintOverlayRoot(printMap) {
    if (!printMap || !printMap.getContainer) return null;

    var mapContainer = printMap.getContainer();
    if (!mapContainer) return null;

    return mapContainer.closest('.grid-print-container') || mapContainer.parentNode || mapContainer;
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

    var wrapper = document.createElement('div');
    wrapper.className = 'mt-print-legend-overlay';

    var heading = document.createElement('div');
    heading.className = 'mt-print-legend-heading';
    heading.textContent = '{{ page.t.indicator.map_legend | default: "Legend" | escape }}';
    wrapper.appendChild(heading);

    var legendHolder = document.createElement('div');
    legendHolder.className = 'mt-print-legend-clone';
    legendHolder.innerHTML = state.cachedLegendHtml;
    wrapper.appendChild(legendHolder);

    root.appendChild(wrapper);
    log('Legend inserted into print view.');
  }

  /**
   * Attach the browser print control to the target map.
   */
  function attachPrintControl(map) {
    if (!isLeafletAvailable()) {
      warn('Leaflet or leaflet.browser.print is not available.');
      return false;
    }

    if (!map || map._mtPrintControlAdded) {
      return false;
    }

    var baseLayer = getPrintableBaseLayer(map);

    try {
      var control = L.control.browserPrint({
        title: 'Print map',
        position: 'topleft',
        documentTitle: getIndicatorTitle(),
        printLayer: baseLayer,
        printModes: buildPrintModes()
      }).addTo(map);

      map.on(L.BrowserPrint.Event.PrePrint, function () {
        var hasSelection = hasSelectedLegendItems();

        // Remember current mode so CSS can react.
        document.body.classList.toggle('mt-print-has-selection', hasSelection);

        // Cache the currently visible year BEFORE the print preview is built.
        cacheCurrentYearText();

        // Only remove transient hover UI when there is NO selection.
        if (!hasSelection) {
          removeTransientMapUi(map.getContainer());
        }

        cacheLegendHtml();
      });

      map.on(L.BrowserPrint.Event.Print, function (event) {
        if (event && event.printMap) {
          var hasSelection = hasSelectedLegendItems();

          // Only remove transient hover UI in the print map
          // when there is NO selection.
          if (!hasSelection) {
            removeTransientMapUi(event.printMap.getContainer());
          }

          // Refresh the header so the CURRENT cached year is used.
          updatePrintHeader(event.printMap);

          addLegendToPrintMap(event.printMap);
        }
      });

      map.on(L.BrowserPrint.Event.PrintEnd, function (event) {
        if (event && event.printMap) {
          var root = getPrintOverlayRoot(event.printMap);
          removeExistingPrintLegend(root);
        }

        // Clean up print state flag and cached year
        document.body.classList.remove('mt-print-has-selection');
        state.cachedYearText = '';
      });

      map._mtPrintControlAdded = true;
      map._mtPrintControl = control;
      state.attached = true;

      log('Print control attached.');
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
    if (!goodMaps.length) return false;

    return attachPrintControl(goodMaps[0]);
  }

  /**
   * Observe #mapview because Open SDG may render the map asynchronously.
   */
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

  /**
   * Fallback polling while the page is still settling.
   */
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
        warn('No visible Leaflet map found inside #mapview.');
      }
    }, 500);
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
  }

  /**
   * Initialise the integration.
   */
  function bootstrap() {
    if (!isLeafletAvailable()) {
      warn('Leaflet or leaflet.browser.print is missing.');
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