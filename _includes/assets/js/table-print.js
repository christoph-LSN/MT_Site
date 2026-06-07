(function () {
  'use strict';

  var state = {
    currentTable: null,
    currentButtonApi: null,
    externalButtonBound: false
  };

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

  function getSelectionsTable() {
    return document.getElementById('selectionsTable');
  }

  function getStableButtonArea() {
    return (
      document.getElementById('tableview') ||
      (getSelectionsTable() ? getSelectionsTable().closest('.tab-pane') : null) ||
      null
    );
  }

  function getCurrentTableElement() {
    return document.querySelector('#selectionsTable table');
  }

  function isInsideSelectionsTable(tableNode) {
    var selectionsTable = getSelectionsTable();
    return !!(selectionsTable && tableNode && selectionsTable.contains(tableNode));
  }

  function getIndicatorTitle() {
    var el =
      document.querySelector('.heading h1') ||
      document.querySelector('h1');

    if (el && el.textContent) {
      return el.textContent.trim();
    }

    return document.title || 'Table';
  }

  function getTableCaptionText(tableEl) {
    if (!tableEl) return '';

    var caption = tableEl.querySelector('caption');
    if (caption && caption.textContent) {
      return caption.textContent.trim();
    }

    return '';
  }

  function isButtonsReady() {
    return !!(
      window.jQuery &&
      jQuery.fn &&
      jQuery.fn.dataTable &&
      jQuery.fn.dataTable.Buttons &&
      jQuery.fn.dataTable.ext &&
      jQuery.fn.dataTable.ext.buttons &&
      jQuery.fn.dataTable.ext.buttons.print
    );
  }

  function ensureExternalButtonHost() {
    var area = getStableButtonArea();
    if (!area) {
      return null;
    }

    var existing = area.querySelector('.table-print-buttons');
    if (existing) {
      return existing;
    }

    var host = document.createElement('div');
    host.className = 'table-print-buttons';

    area.insertBefore(host, area.firstChild);
    return host;
  }

  function ensureExternalPrintButton() {
    var host = ensureExternalButtonHost();
    if (!host) {
      warn('Could not create stable external print button host.');
      return null;
    }

    var existing = host.querySelector('.table-print-trigger');
    if (existing) {
      return existing;
    }

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'table-print-trigger btn btn-primary';
    button.textContent = 'Tabelle drucken';

    host.appendChild(button);
    return button;
  }

  /**
   * Bind the visible external button only once.
   *
   * Important:
   * We do NOT use button().trigger() anymore because DataTables explicitly notes
   * that some button types may not be triggerable programmatically.
   * Instead we retrieve the actual action function via button().action()
   * and execute it directly.
   */
  function bindExternalButtonClick() {
    if (state.externalButtonBound) {
      return;
    }

    var visibleButton = ensureExternalPrintButton();
    if (!visibleButton) {
      return;
    }

    visibleButton.addEventListener('click', function (e) {
      if (!state.currentTable || !state.currentButtonApi) {
        warn('No active DataTable / print button API available.');
        return;
      }

      try {
        var action = state.currentButtonApi.action();
        if (typeof action !== 'function') {
          warn('Print button action is not a function.');
          return;
        }

        var dt = state.currentTable;
        var buttonNode = jQuery(state.currentButtonApi.node());
        var config = state.currentButtonApi.conf;

        action.call(state.currentButtonApi, e, dt, buttonNode, config);

        log('Executed native DataTables print action from external button.');
      } catch (error) {
        warn('Failed to execute DataTables print action.', error);
      }
    });

    state.externalButtonBound = true;
  }

  /**
   * Ensure that the current DataTable instance has a hidden native print button.
   * The visible UI remains our external stable button.
   */
  function ensureHiddenPrintButtonForTable(dataTable, tableEl) {
    if (!dataTable || !tableEl) return false;
    if (!isInsideSelectionsTable(tableEl)) return false;

    if (!isButtonsReady()) {
      warn('DataTables Buttons / print extension is not available.');
      return false;
    }

    var settings = dataTable.settings()[0];

    // Already configured for this DataTable instance.
    if (settings._mtHiddenTablePrintAttached) {
      state.currentTable = dataTable;
      state.currentButtonApi = dataTable.button('mtTablePrint:name', 0);
      return true;
    }

    var printTitle = getIndicatorTitle();
    var tableCaption = getTableCaptionText(tableEl);

    new jQuery.fn.dataTable.Buttons(dataTable, {
      name: 'mtTablePrint',
      buttons: [
        {
          extend: 'print',
          text: 'Tabelle drucken',
          className: 'buttons-print',
          autoPrint: false,
          title: printTitle,
          exportOptions: {
            columns: ':visible',
            modifier: {
              search: 'applied',
              order: 'applied'
            }
          },
          customize: function (win) {
            var doc = win.document;
            var body = doc.body;

            body.classList.add('mt-table-print');

            if (tableCaption) {
              var caption = doc.createElement('div');
              caption.className = 'mt-table-print-caption';
              caption.textContent = tableCaption;
              body.insertBefore(caption, body.firstChild.nextSibling);
            }

            var source = doc.createElement('div');
            source.className = 'mt-table-print-source';
            source.textContent = 'Quelle: Integrationsmonitoring Niedersachsen';
            body.appendChild(source);

            var printedTable = body.querySelector('table');
            if (printedTable) {
              printedTable.classList.add(
                'table',
                'table-bordered',
                'table-sm',
                'mt-table-print-table'
              );
            }
          }
        }
      ]
    });

    // Keep the native container hidden in the document,
    // but fully initialised and available through the API.
    var hiddenContainer = dataTable.buttons('mtTablePrint:name', null).container();
    hiddenContainer.addClass('mt-hidden-dt-buttons');
    jQuery(document.body).append(hiddenContainer);

    settings._mtHiddenTablePrintAttached = true;

    state.currentTable = dataTable;
    state.currentButtonApi = dataTable.button('mtTablePrint:name', 0);

    log('Hidden table print button attached to DataTable instance.', {
      tableId: tableEl.id
    });

    return true;
  }

  function attachToCurrentTable() {
    if (!window.jQuery || !jQuery.fn || !jQuery.fn.dataTable) {
      warn('jQuery DataTables is not available.');
      return false;
    }

    var tableEl = getCurrentTableElement();
    if (!tableEl) {
      warn('No table found in #selectionsTable.');
      return false;
    }

    if (!jQuery.fn.dataTable.isDataTable(tableEl)) {
      warn('The current table exists, but is not an active DataTable yet.');
      return false;
    }

    var dataTable = jQuery(tableEl).DataTable();
    bindExternalButtonClick();
    return ensureHiddenPrintButtonForTable(dataTable, tableEl);
  }

  /**
   * React globally to DataTables lifecycle changes.
   *
   * draw: fired when the table is redrawn
   * init: fired when a DataTable is initialised
   */
  function bindGlobalDataTableEvents() {
    if (!window.jQuery) return;

    jQuery(document).off('.mtTablePrint');

    jQuery(document).on('init.dt.mtTablePrint draw.dt.mtTablePrint', function (e, settings) {
      try {
        if (!settings || !settings.nTable) return;

        var tableNode = settings.nTable;
        if (!isInsideSelectionsTable(tableNode)) return;

        var dataTable = jQuery(tableNode).DataTable();
        ensureHiddenPrintButtonForTable(dataTable, tableNode);
        bindExternalButtonClick();
      } catch (error) {
        warn('Error while reacting to DataTables lifecycle event.', error);
      }
    });
  }

  function bootstrapWithRetry() {
    bindGlobalDataTableEvents();
    bindExternalButtonClick();

    var attempts = 0;
    var maxAttempts = 30;

    var retryTimer = window.setInterval(function () {
      attempts += 1;

      var attached = attachToCurrentTable();
      if (attached || attempts >= maxAttempts) {
        window.clearInterval(retryTimer);

        if (!attached) {
          warn('Giving up after retrying to connect the stable table print button.');
        }
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapWithRetry);
  } else {
    bootstrapWithRetry();
  }
})();
``
