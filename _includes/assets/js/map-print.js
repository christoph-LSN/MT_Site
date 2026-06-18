---
---
(function () {
  'use strict';

  /**
   * Configuration from _data/site_config.yml
   *
   * Expected structure:
   *
   * map_print:
   *   enabled: true
   *   debug: false
   *   control:
   *     enabled: true
   *     title: Karte drucken
   *     position: topleft
   *   page:
   *     format: A4
   *     orientation: landscape
   *     margin:
   *       top: 2
   *       right: 2
   *       bottom: 2
   *       left: 2
   *   header:
   *     enabled: true
   *     title: true
   *     year: true
   *     size: 16mm
   *     over_the_map: true
   *   footer:
   *     enabled: true
   *     source: true
   *     size: 5mm
   *     over_the_map: true
   *   legend:
   *     enabled: true
   *     heading: true
   *   disaggregations:
   *     enabled: true
   *     label: Kartenauswahl
   *     position: top-left
   *   cleanup:
   *     remove_transient_ui: true
   */
  var printConfig = {
    enabled: {{ site.data.site_config.map_print.enabled | default: true | jsonify }},
    debug: {{ site.data.site_config.map_print.debug | default: false | jsonify }},

    control: {
      enabled: {{ site.data.site_config.map_print.control.enabled | default: true | jsonify }},
      title: {{ site.data.site_config.map_print.control.title | default: "Karte drucken" | jsonify }},
      position: {{ site.data.site_config.map_print.control.position | default: "topleft" | jsonify }}
    },

    page: {
      format: {{ site.data.site_config.map_print.page.format | default: "A4" | jsonify }},
      orientation: {{ site.data.site_config.map_print.page.orientation | default: "landscape" | jsonify }},
      margin: {
        top: {{ site.data.site_config.map_print.page.margin.top | default: 2 | jsonify }},
        right: {{ site.data.site_config.map_print.page.margin.right | default: 2 | jsonify }},
        bottom: {{ site.data.site_config.map_print.page.margin.bottom | default: 2 | jsonify }},
        left: {{ site.data.site_config.map_print.page.margin.left | default: 2 | jsonify }}
      }
    },

    header: {
      enabled: {{ site.data.site_config.map_print.header.enabled | default: true | jsonify }},
      title: {{ site.data.site_config.map_print.header.title | default: true | jsonify }},
      year: {{ site.data.site_config.map_print.header.year | default: true | jsonify }},
      size: {{ site.data.site_config.map_print.header.size | default: "16mm" | jsonify }},
      overTheMap: {{ site.data.site_config.map_print.header.over_the_map | default: true | jsonify }}
    },

    footer: {
      enabled: {{ site.data.site_config.map_print.footer.enabled | default: true | jsonify }},
      source: {{ site.data.site_config.map_print.footer.source | default: true | jsonify }},
      size: {{ site.data.site_config.map_print.footer.size | default: "5mm" | jsonify }},
      overTheMap: {{ site.data.site_config.map_print.footer.over_the_map | default: true | jsonify }}
    },

    legend: {
      enabled: {{ site.data.site_config.map_print.legend.enabled | default: true | jsonify }},
      heading: {{ site.data.site_config.map_print.legend.heading | default: true | jsonify }}
    },

    disaggregations: {
      enabled: {{ site.data.site_config.map_print.disaggregations.enabled | default: true | jsonify }},
      label: {{ site.data.site_config.map_print.disaggregations.label | default: "Kartenauswahl" | jsonify }},
      position: {{ site.data.site_config.map_print.disaggregations.position | default: "top-left" | jsonify }}
    },

    cleanup: {
      removeTransientUi: {{ site.data.site_config.map_print.cleanup.remove_transient_ui | default: true | jsonify }}
    }
  };

  /**
   * Toggle this to true while diagnosing map print issues.
   */
  var DEBUG = !!printConfig.debug;

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
      (text.indexOf('{') !== -1 && text.indexOf('}') !== -1)
    );
  }

  /**
   * Escape text before inserting it as HTML.
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
   *
   * Example:
   *   map-Units      -> Einheit: Prozent
   *   map-Geschlecht -> Geschlecht: weiblich
   *   map-Kategorie  -> Kategorie: ...
   */
  function getCurrentMapDisaggregations() {
    if (!printConfig.disaggregations.enabled) {
      return [];
    }

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
    if (!printConfig.disaggregations.enabled) {
      return '';
    }

    var items = getCurrentMapDisaggregations();

    if (!items.length) {
      return '';
    }

    var label = printConfig.disaggregations.label || 'Kartenauswahl';

    return (
      '<div class="mt-print-meta mt-print-disaggregations">' +
        '<strong>' + escapeHtml(label) + ':</strong> ' +
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
    if (!printConfig.header.year) {
      state.cachedYearText = '';
      return;
    }

    state.cachedYearText = getCurrentYearText();
    log('Year cached before print.', state.cachedYearText);
  }

  /**
   * Cache the currently selected map disaggregations before the print view is created.
   */
  function cacheCurrentMapDisaggregations() {
    if (!printConfig.disaggregations.enabled) {
      state.cachedDisaggregationHtml = '';
      return;
    }

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
    if (!printConfig.legend.enabled) {
      state.cachedLegendHtml = '';
      return;
    }

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
    if (!printConfig.header.enabled) {
      return '';
    }

    var lines = [];

    if (printConfig.header.title) {
      lines.push(
        '<div class="mt-print-title">' +
          escapeHtml(getPrintHeadingText()) +
        '</div>'
      );
    }

    if (printConfig.header.year) {
      var yearText = state.cachedYearText || getCurrentYearText();
      var referenceYearLabel = getReferenceYearLabel();

      if (yearText) {
        lines.push(
          '<div class="mt-print-meta"><strong>' +
            escapeHtml(referenceYearLabel) +
            ':</strong> ' +
            escapeHtml(yearText) +
          '</div>'
        );
      }
    }

    return (
      '<div class="mt-print-header">' +
        lines.join('') +
      '</div>'
    );
  }

  /**
   * Build the print footer.
   */
  function buildFooterHtml() {
    if (!printConfig.footer.enabled || !printConfig.footer.source) {
      return '';
    }

    var dataSourceLabel = getDataSourceLabel();

    return (
      '<div class="mt-print-footer-source"><strong>' +
        escapeHtml(dataSourceLabel) +
        ':</strong> https://www.integrationsmonitoring.niedersachsen.de</div>'
    );
  }

  /**
   * Get print mode according to config.
   */
  function buildPrintModes() {
    var orientation = String(printConfig.page.orientation || 'landscape').toLowerCase();
    var format = printConfig.page.format || 'A4';

    var modeFactory = L.BrowserPrint.Mode.Landscape;

    if (orientation === 'portrait' && L.BrowserPrint.Mode.Portrait) {
      modeFactory = L.BrowserPrint.Mode.Portrait;
    }

    return [
      modeFactory(format, {
        title: 'Print',
        margin: {
          top: printConfig.page.margin.top,
          right: printConfig.page.margin.right,
          bottom: printConfig.page.margin.bottom,
          left: printConfig.page.margin.left
        },
        enableZoom: false,
        header: {
          enabled: !!printConfig.header.enabled,
          text: buildHeaderHtml(),
          size: printConfig.header.size || '16mm',
          overTheMap: !!printConfig.header.overTheMap
        },
        footer: {
          enabled: !!printConfig.footer.enabled,
          text: buildFooterHtml(),
          size: printConfig.footer.size || '5mm',
          overTheMap: !!printConfig.footer.overTheMap
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

    var position = String(printConfig.disaggregations.position || 'top-left').toLowerCase();

    var vertical = 'top: 14mm;';
    var horizontal = 'left: 6mm;';

    if (position.indexOf('bottom') !== -1) {
      vertical = 'bottom: 8mm;';
    }

    if (position.indexOf('right') !== -1) {
      horizontal = 'right: 6mm;';
    }

    var style = doc.createElement('style');
    style.id = 'mt-print-overlay-styles';

    style.textContent = ''
      + '.mt-print-disaggregation-overlay {'
      + '  position: absolute;'
      + '  ' + horizontal
      + '  ' + vertical
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
      + '}'
      + '.mt-print-legend-overlay {'
      + '  z-index: 99998;'
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
    if (!printConfig.disaggregations.enabled) {
      return;
    }

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
    if (!printConfig.legend.enabled) {
      return;
    }

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

    if (printConfig.legend.heading) {
      var heading = doc.createElement('div');
      heading.className = 'mt-print-legend-heading';
      heading.textContent = '{{ page.t.indicator.map_legend | default: "Legende" | escape }}';
      wrapper.appendChild(heading);
    }

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
    if (!printConfig.header.enabled) {
      return;
    }

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
    if (!printConfig.enabled) {
      log('Map print disabled by site_config.yml.');
      return false;
    }

    if (!printConfig.control.enabled) {
      log('Map print control disabled by site_config.yml.');
      return false;
    }

    if (!isLeafletAvailable()) {
      warn('Leaflet or leaflet.browser.print is not available.');
      return false;
    }

    if (!map || map._mtPrintControlAdded) {
      return false;
    }

    var baseLayer = getPrintableBaseLayer(map);

    try {
      L.control.browserPrint({
        title: printConfig.control.title || 'Karte drucken',
        position: printConfig.control.position || 'topleft',
        documentTitle: getIndicatorTitle(),
        printLayer: baseLayer,
        printModes: buildPrintModes()
      }).addTo(map);

      map.on(L.BrowserPrint.Event.PrePrint, function () {
        var hasSelection = hasSelectedLegendItems();

        document.body.classList.toggle('mt-print-has-selection', hasSelection);

        cacheCurrentYearText();
        cacheCurrentMapDisaggregations();

        if (printConfig.cleanup.removeTransientUi && !hasSelection) {
          removeTransientMapUi(map.getContainer());
        }

        cacheLegendHtml();
      });

      map.on(L.BrowserPrint.Event.Print, function (event) {
        if (event && event.printMap) {
          var hasSelection = hasSelectedLegendItems();

          if (printConfig.cleanup.removeTransientUi && !hasSelection) {
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
   * Observe #mapview because Open SDG may render or update the map asynchronously.
   */
  function observeMapView() {
    var mapView = getMapView();
    if (!mapView || state.observer) return;

    state.observer = new MutationObserver(function () {
      if (state.attached) return;

      if (isLeafletAvailable()) {
        registerLeafletInitHook();
        scanWindowForMaps();
        attachIfPossible();
      }
    });

    state.observer.observe(mapView, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
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

      if (isLeafletAvailable()) {
        registerLeafletInitHook();
        scanWindowForMaps();
        attachIfPossible();
      }

      if (attempts >= maxAttempts) {
        window.clearInterval(state.interval);
        state.interval = null;

        warn('Map print readiness watcher timed out. Will retry on map tab activation.');
      }
    }, 500);
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

        observeMapView();

        if (isLeafletAvailable()) {
          registerLeafletInitHook();
          scanWindowForMaps();
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
    if (!printConfig.enabled) {
      log('Map print disabled by site_config.yml.');
      return;
    }

    if (!printConfig.control.enabled) {
      log('Map print control disabled by site_config.yml.');
      return;
    }

    bindMapActivationEvents();
    observeMapView();
    startReadinessWatcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();