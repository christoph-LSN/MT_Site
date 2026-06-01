/**
 * TODO:
 * Integrate with high-contrast switcher.
 */
(function($) {

  if (typeof L === 'undefined') {
    return;
  }

  // Create the defaults once
  var defaults = {

    // Options for using tile imagery with leaflet.
    tileURL: '[replace me]',
    tileOptions: {
      id: '[relace me]',
      accessToken: '[replace me]',
      attribution: '[replace me]',
    },
    // Zoom limits.
    minZoom: 5,
    maxZoom: 10,
    // Visual/choropleth considerations.
    colorRange: chroma.brewer.BuGn,
    noValueColor: '#f0f0f0',
    styleNormal: {
      weight: 1,
      opacity: 1,
      color: '#888888',
      fillOpacity: 0.7
    },
    styleHighlighted: {
      weight: 1,
      opacity: 1,
      color: '#111111',
      fillOpacity: 0.7
    },
    styleStatic: {
      weight: 2,
      opacity: 1,
      fillOpacity: 0,
      color: '#172d44',
      dashArray: '5,5',
    },
  };

  // Defaults for each map layer.
  var mapLayerDefaults = {
    min_zoom: 0,
    max_zoom: 10,
    subfolder: 'regions',
    label: 'indicator.map',
    staticBorders: false,
  };

  function Plugin(element, options) {

    this.element = element;

    // Support colorRange map option in string format.
    if (typeof options.mapOptions.colorRange === 'string') {
      var colorRangeParts = options.mapOptions.colorRange.split('.'),
          colorRange = window,
          overrideColorRange = true;
      for (var i = 0; i < colorRangeParts.length; i++) {
        var colorRangePart = colorRangeParts[i];
        if (typeof colorRange[colorRangePart] !== 'undefined') {
          colorRange = colorRange[colorRangePart];
        }
        else {
          overrideColorRange = false;
          break;
        }
      }
      if (overrideColorRange && typeof colorRange === 'function') {
        var indicatorId = options.indicatorId.replace('indicator_', ''),
            indicatorIdParts = indicatorId.split('-'),
            goalId = (indicatorIdParts.length > 0) ? indicatorIdParts[0] : null,
            indicatorIdDots = indicatorIdParts.join('.');
        colorRange = colorRange(indicatorIdDots, goalId);
      }
      options.mapOptions.colorRange = (overrideColorRange) ? colorRange : defaults.colorRange;
    }

    this.options = $.extend(true, {}, defaults, options.mapOptions);
    this.mapLayers = [];
    this.indicatorId = options.indicatorId;
    this._precision = options.precision;
    this.precisionItems = options.precisionItems;
    this._decimalSeparator = options.decimalSeparator;
    this.currentDisaggregation = 0;
    this.dataSchema = options.dataSchema;
    this.viewHelpers = options.viewHelpers;
    this.modelHelpers = options.modelHelpers;
    this.chartTitles = options.chartTitles;
    this.proxy = options.proxy;
    this.proxySerieses = options.proxySerieses;
    this.startValues = options.startValues;
    this.configObsAttributes = {{ site.observation_attributes | jsonify }};
    this.allObservationAttributes = options.allObservationAttributes;
    this._browserDecimalSeparator = this.viewHelpers.getBrowserDecimalSeparator();

    // Require at least one geoLayer.
    if (!options.mapLayers || !options.mapLayers.length) {
      console.log('Map disabled - please add "map_layers" in site configuration.');
      return;
    }

    // Apply geoLayer defaults.
    for (var i = 0; i < options.mapLayers.length; i++) {
      this.mapLayers[i] = $.extend(true, {}, mapLayerDefaults, options.mapLayers[i]);
    }

    // Sort the map layers according to zoom levels.
    this.mapLayers.sort(function(a, b) {
      if (a.min_zoom === b.min_zoom) {
        return a.max_zoom - b.max_zoom;
      }
      return a.min_zoom - b.min_zoom;
    });

    this._defaults = defaults;
    this._name = 'sdgMap';

    this.init();
  }

  Plugin.prototype = {

    // Update title.
    updateTitle: function() {
      if (!this.modelHelpers) {
        return;
      }
      var currentSeries = this.disaggregationControls.getCurrentSeries(),
          currentUnit = this.disaggregationControls.getCurrentUnit(),
          newTitle = null;
      if (this.modelHelpers.GRAPH_TITLE_FROM_SERIES) {
        newTitle = currentSeries;
      }
      else {
        var currentTitle = $('#map-heading').text();
        newTitle = this.modelHelpers.getChartTitle(currentTitle, this.chartTitles, currentUnit, currentSeries);
      }
      if (newTitle) {
        if (this.proxy === 'proxy' || this.proxySerieses.includes(currentSeries)) {
            newTitle += ' ' + this.viewHelpers.PROXY_PILL;
        }
        $('#map-heading').html(newTitle);
      }
    },

    // Update footer fields.
    updateFooterFields: function() {
      if (!this.viewHelpers) {
        return;
      }
      var currentSeries = this.disaggregationControls.getCurrentSeries(),
          currentUnit = this.disaggregationControls.getCurrentUnit();
      this.viewHelpers.updateSeriesAndUnitElements(currentSeries, currentUnit);
      this.viewHelpers.updateUnitElements(currentUnit);
    },

    // Update precision.
    updatePrecision: function() {
      if (!this.modelHelpers) {
        return;
      }
      var currentSeries = this.disaggregationControls.getCurrentSeries(),
          currentUnit = this.disaggregationControls.getCurrentUnit();
      this._precision = this.modelHelpers.getPrecision(this.precisionItems, currentUnit, currentSeries);
    },

    // Zoom to a feature.
    zoomToFeature: function(layer) {
      this.map.fitBounds(layer.getBounds());
    },

    // Build content for a tooltip.
    getTooltipContent: function(feature) {
      var tooltipContent = feature.properties.name;
      var tooltipData = this.getData(feature.properties);
      var plugin = this;
      if (typeof tooltipData === 'number') {
        tooltipContent += ': ' + this.alterData(tooltipData);
      }
      if (feature.properties.observation_attributes) {
        var obsAtts = feature.properties.observation_attributes[plugin.currentDisaggregation][plugin.currentYear],
            footnoteNumbers = [];
        if (obsAtts) {
          Object.keys(obsAtts).forEach(function(field) {
            if (obsAtts[field]) {
              var hashKey = field + '|' + obsAtts[field];
              var footnoteNumber = plugin.allObservationAttributes[hashKey].footnoteNumber;
              footnoteNumbers.push(plugin.viewHelpers.getObservationAttributeFootnoteSymbol(footnoteNumber));
            }
          });
          if (footnoteNumbers.length > 0) {
            tooltipContent += ' ' + footnoteNumbers.join(' ');
          }
        }
      }

      return tooltipContent;
    },

    // Update a tooltip.
    updateTooltip: function(layer) {
      if (layer.getTooltip()) {
        var tooltipContent = this.getTooltipContent(layer.feature);
        layer.setTooltipContent(tooltipContent);
      }
    },

    // Create tooltip.
    createTooltip: function(layer) {
      if (!layer.getTooltip()) {
        var tooltipContent = this.getTooltipContent(layer.feature);
        layer.bindTooltip(tooltipContent, {
          permanent: true,
        }).addTo(this.map);
      }
    },

    // Select a feature.
    highlightFeature: function(layer) {
      // Abort if the layer is not on the map.
      if (!this.map.hasLayer(layer)) {
        return;
      }
      // Update the style.
      layer.setStyle(this.options.styleHighlighted);
      // Add a tooltip if not already there.
      this.createTooltip(layer);
      if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
        layer.bringToFront();
      }
      this.updateStaticLayers();
    },

    // Unselect a feature.
    unhighlightFeature: function(layer) {

      // Reset the feature's style.
      layer.setStyle(this.options.styleNormal);

      // Remove the tooltip if necessary.
      if (layer.getTooltip()) {
        layer.unbindTooltip();
      }

      // Make sure other selections are still highlighted.
      var plugin = this;
      this.selectionLegend.selections.forEach(function(selection) {
        plugin.highlightFeature(selection);
      });
    },

    // Get all of the GeoJSON layers.
    getAllLayers: function() {
      return L.featureGroup(this.dynamicLayers.layers);
    },

    // Get only the visible GeoJSON layers.
    getVisibleLayers: function() {
      // Unfortunately relies on an internal of the ZoomShowHide library.
      return this.dynamicLayers._layerGroup;
    },

    updateStaticLayers: function() {
      // Make sure the static borders are always visible.
      this.staticLayers._layerGroup.eachLayer(function(layer) {
        layer.bringToFront();
      });
    },

    // Update the colors of the Features on the map.
    updateColors: function() {
      var plugin = this;
      this.getAllLayers().eachLayer(function(layer) {
        layer.setStyle(function(feature) {
          return {
            fillColor: plugin.getColor(feature.properties),
          }
        });
      });
    },

    // Update the tooltips of the selected Features on the map.
    updateTooltips: function() {
      var plugin = this;
      this.selectionLegend.selections.forEach(function(selection) {
        plugin.updateTooltip(selection);
      });
    },

    // Alter data before displaying it.
    alterData: function(value) {
      opensdg.dataDisplayAlterations.forEach(function(callback) {
        value = callback(value);
      });
      if (typeof value !== 'number') {
        if (this._precision || this._precision === 0) {
          value = Number.parseFloat(value).toFixed(this._precision);
        }
        if (this._decimalSeparator) {
          value = value.toString().replace('.', this._decimalSeparator);
        }
      }
      else {
        var localeOpts = {};
        if (this._precision || this._precision === 0) {
            localeOpts.minimumFractionDigits = this._precision;
            localeOpts.maximumFractionDigits = this._precision;
        }
        value = value.toLocaleString(opensdg.language_numbers, localeOpts);
        // Still use the custom decimal separator if it is there.
        if (this._decimalSeparator) {
          value = value.toString().replace(this._browserDecimalSeparator, this._decimalSeparator);
        }
      }
      return value;
    },

    // Get the data from a feature's properties, according to the current year.
    getData: function(props) {
      var ret = false;
      if (props.values && props.values.length && this.currentDisaggregation < props.values.length) {
        var value = props.values[this.currentDisaggregation][this.currentYear];
        if (typeof value === 'number') {
          ret = opensdg.dataRounding(value, { indicatorId: this.indicatorId });
        }
      }
      return ret;
    },

    // Choose a color for a GeoJSON feature.
    getColor: function(props) {
      var data = this.getData(props);
      if (data) {
        return this.colorScale(data).hex();
      }
      else {
        return this.options.noValueColor;
      }
    },

    // Set (or re-set) the choropleth color scale.
    setColorScale: function() {
      this.colorScale = chroma.scale(this.options.colorRange)
        .domain(this.valueRanges[this.currentDisaggregation])
        .classes(this.options.colorRange.length);
    },

    // Get the (long) URL of a geojson file, given a particular subfolder.
    getGeoJsonUrl: function(subfolder) {
      var fileName = this.indicatorId + '.geojson';
      return [opensdg.remoteDataBaseUrl, 'geojson', subfolder, fileName].join('/');
    },

    getYearSlider: function() {
      var plugin = this,
          years = plugin.years[plugin.currentDisaggregation];
      return L.Control.yearSlider({
        years: years,
        yearChangeCallback: function(e) {
          plugin.currentYear = years[e.target._currentTimeIndex];
          plugin.updateColors();
          plugin.updateTooltips();
          plugin.selectionLegend.update();
        }
      });
    },

    replaceYearSlider: function() {
      var newSlider = this.getYearSlider();
      var oldSlider = this.yearSlider;
      this.map.addControl(newSlider);
      this.map.removeControl(oldSlider);
      this.yearSlider = newSlider;
      $(this.yearSlider.getContainer()).insertAfter($(this.disaggregationControls.getContainer()));
      this.yearSlider._timeDimension.setCurrentTimeIndex(this.yearSlider._timeDimension.getCurrentTimeIndex());
    },

    // Initialize the map itself.
    init: function() {

      // Create the map.
      this.map = L.map(this.element, {
        minZoom: this.options.minZoom,
        maxZoom: this.options.maxZoom,
        zoomControl: false,
      });
      this.map.setView([0, 0], 0);
      this.dynamicLayers = new ZoomShowHide();
      this.dynamicLayers.addTo(this.map);
      this.staticLayers = new ZoomShowHide();
      this.staticLayers.addTo(this.map);

      // Add scale.
      this.map.addControl(L.control.scale({position: 'bottomright'}));

      // Add tile imagery.
      if (this.options.tileURL && this.options.tileURL !== 'undefined' && this.options.tileURL != '') {
        L.tileLayer(this.options.tileURL, this.options.tileOptions).addTo(this.map);
      }

      // Because after this point, "this" rarely works.
      var plugin = this;

      // Below we'll be figuring out the min/max values and available years.
      var minimumValues = [],
          maximumValues = [],
          availableYears = [];

      // At this point we need to load the GeoJSON layer/s.
      var geoURLs = this.mapLayers.map(function(item) {
        return $.getJSON(plugin.getGeoJsonUrl(item.subfolder));
      });
      $.when.apply($, geoURLs).done(function() {

        // Apparently "arguments" can either be an array of responses, or if
        // there was only one response, the response itself. This behavior is
        // odd and should be investigated. In the meantime, a workaround is a
        // blunt check to see if it is a single response.
        var geoJsons = arguments;
        // In a response, the second element is a string (like 'success') so
        // check for that here to identify whether it is a response.
        if (arguments.length > 1 && typeof arguments[1] === 'string') {
          // If so, put it into an array, to match the behavior when there are
          // multiple responses.
          geoJsons = [geoJsons];
        }

        // Do a quick loop through to see which layers actually have data.
        for (var i = 0; i < geoJsons.length; i++) {
          var layerHasData = true;
          if (typeof geoJsons[i][0].features === 'undefined') {
            layerHasData = false;
          }
          else if*
