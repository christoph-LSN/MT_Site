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
   *   We do this because the DOM can change during the print workflow.
   */
  var state = {
    maps: [],
    attached: false,
    observer: null,
    interval: null,
    cachedLegendHtml: ''
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
   * Extract the currently active year from visible map controls.
   */
  function getCurrentYearText() {
    var selectors = [
      '#mapview .noUi-tooltip',
      '#mapview .timecontrol-date',
      '#mapview .leaflet-control-timecontrol .timecontrol-slider + span',
      '#mapview .leaflet-control-timecontrol',
      '#mapview .year',
      '#mapview .current-year'
    ];

    var i, el;
    for (i = 0; i < selectors.length; i++) {
      el = document.querySelector(selectors[i]);
      if (el && el.textContent && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }

    return '';
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

      // Prefer a currently visible legend.
      for (j = 0; j < candidates.length; j++) {
        if (isVisible(candidates[j])) {
          return candidates[j];
        }
      }

      // If nothing is visible, return the first match as a fallback.
      if (candidates.length) {
        return candidates[0];
      }
    }

    return null;
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
   * Remove transient UI from the cloned legend as well.
   */
  function sanitizeLegendClone(root) {
    if (!root) return;

    var selectors = [
      '.leaflet-tooltip',
      '.leaflet-popup',
      '.leaflet-popup-pane',
      '[role="tooltip"]',
      '.tooltip',
      '[class*="hover"]',
      '[class*="mouseover"]'
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
   * Copy important computed visual styles from the original legend
   * into the cloned legend.
   *
   * This helps retain CSS-driven visuals in the print legend.
   */
  function inlineLegendVisualStyles(originalRoot, clonedRoot) {
    if (!originalRoot || !clonedRoot) return;

    var originalNodes = originalRoot.querySelectorAll('*');
    var clonedNodes = clonedRoot.querySelectorAll('*');

    originalNodes.forEach(function (originalNode, index) {
      var clonedNode = clonedNodes[index];
      if (!clonedNode) return;

      var style = window.getComputedStyle(originalNode);

      clonedNode.style.background = style.background;
      clonedNode.style.backgroundColor = style.backgroundColor;
      clonedNode.style.backgroundImage = style.backgroundImage;
      clonedNode.style.border = style.border;
      clonedNode.style.borderColor = style.borderColor;
      clonedNode.style.borderWidth = style.borderWidth;
      clonedNode.style.borderStyle = style.borderStyle;
      clonedNode.style.color = style.color;
      clonedNode.style.width = style.width;
      clonedNode.style.height = style.height;
      clonedNode.style.minWidth = style.minWidth;
      clonedNode.style.maxWidth = style.maxWidth;
      clonedNode.style.display = style.display;
    });
  }

  /**
   * Clone a legend element while preserving rendered canvas content
   * and important computed visual styles.
   */
  function cloneLegendPreservingCanvas(legend) {
    if (!legend) return null;

    var clone = legend.cloneNode(true);

    var originalCanvases = legend.querySelectorAll('canvas');
    var clonedCanvases = clone.querySelectorAll('canvas');

    originalCanvases.forEach(function (canvas, index) {
      var replacement = clonedCanvases[index];
      if (!replacement) return;

      try {
        var img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.alt = '';

        // Preserve visible size if possible
        img.width = canvas.width;
        img.height = canvas.height;

        // Keep inline styles if present
        if (canvas.getAttribute('style')) {
          img.setAttribute('style', canvas.getAttribute('style'));
        }

        // Preserve class names
        img.className = canvas.className || '';

        replacement.parentNode.replaceChild(img, replacement);
      } catch (error) {
        warn('Could not convert legend canvas to image.', error);
      }
    });

    // Preserve CSS-driven visual appearance as inline styles.
    inlineLegendVisualStyles(legend, clone);

    return clone;
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

    // Remove temporary hover / popup UI from the live map before caching.
    removeTransientMapUi(getMapView());

    // Preserve canvas-based legend graphics by converting canvases to images
    // before serialising the legend HTML.
    var preservedClone = cloneLegendPreservingCanvas(legend);

    if (!preservedClone) {
      state.cachedLegendHtml = '';
      warn('Legend clone could not be created.');
      return;
    }

    state.cachedLegendHtml = preservedClone.outerHTML;
    log('Legend cached.');
  }

  /**
   * Build the print header.
   *
   * We deliberately keep this small so that the map itself can remain large.
   * The site path is intentionally NOT included.
   */
  function buildHeaderHtml() {
    var title = getIndicatorTitle();
    var yearText = getCurrentYearText();

    var metaLine = yearText
      ? '<div class="mt-print-meta">Reference year: ' + yearText + '</div>'
      : '';

    return '' +
      '<div class="mt-print-header">' +
        '<div class="mt-print-title">' + title + '</div>' +
        metaLine +
      '</div>';
  }

  /**
   * Configure the print mode.
   *
   * Key decisions:
   * - A4 landscape
   * - very small margins
   * - keep the current map zoom instead of auto-resizing too much
   * - overlay header and footer so they do not consume separate layout height
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
          text: 'Integrationsmonitoring Niedersachsen',
          size: '4mm',
          overTheMap: true
        }
      })
    ];
  }

  /**
   * Get the best container for legend injection in the print view.
   *
   * We do NOT inject the legend into the Leaflet map pane itself because
   * that can cause it to be hidden below the map tiles or clipped.
   *
   * Instead we attach it to the surrounding print layout container.
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
   *
   * This runs late in the print process so that the print map already exists.
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
    heading.textContent = 'Legend';
    wrapper.appendChild(heading);

    var legendHolder = document.createElement('div');
    legendHolder.className = 'mt-print-legend-clone';
    legendHolder.innerHTML = state.cachedLegendHtml;

    // Remove transient hover-related UI from the cloned legend.
    sanitizeLegendClone(legendHolder);

    wrapper.appendChild(legendHolder);

    root.appendChild(wrapper);
    log('Legend inserted into print view.');
  }

  /**
   * Attach the browser print control to the target map.
   *
   * We also hook into:
   * - PrePrint: cache the original legend
   * - Print: inject the legend into the print view
   * - PrintEnd: clean up again
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
        // Remove visible hover / tooltip UI from the live map right before print.
        removeTransientMapUi(map.getContainer());
        cacheLegendHtml();
      });

      map.on(L.BrowserPrint.Event.Print, function (event) {
        if (event && event.printMap) {
          // Also remove any transient UI from the print map itself.
          removeTransientMapUi(event.printMap.getContainer());
          addLegendToPrintMap(event.printMap);
        }
      });

      map.on(L.BrowserPrint.Event.PrintEnd, function (event) {
        if (event && event.printMap) {
          var root = getPrintOverlayRoot(event.printMap);
          removeExistingPrintLegend(root);
        }
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