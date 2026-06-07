(function () {
  'use strict';

  /**
   * Shared runtime state.
   */
  var state = {
    currentTable: null,
    currentTableId: null,
    externalButtonBound: false
  };

  /**
   * Log helper.
   */
  function log(message, data) {
    if (window.console && console.log) {
      if (typeof data !== 'undefined') {
        console.log('[table-print] ' + message, data);
      } else {
        console.log('[table-print] ' + message);
      }
    }
  }

  /**
   * Warning helper.
   */
  function warn(message, data) {
    if (window.console && console.warn) {
      if (typeof data !== 'undefined') {
        console.warn('[table-print] ' + message, data);
      } else {
        console.warn('[table-print] ' + message);
      }
    }
  }

  /**
   * Current Open SDG table container.
   */
  function getSelectionsTable() {
    return document.getElementById('selectionsTable');
  }

  /**
   * Stable parent for the visible print button.
   *
   * Based on your debug logs, #selectionsTable and #tableSelectionDownload
   * are rebuilt on Gebietseinheit changes.
   *
   * Therefore we place the external print button higher up in #tableview,
   * which is the table tab panel itself.
   */
  function getStableButtonArea() {
    return (
      document.getElementById('tableview') ||
      (getSelectionsTable() ? getSelectionsTable().closest('.tab-pane') : null) ||
      null
    );
  }

  /**
   * Read the visible table element.
   */
  function getCurrentTableElement() {
    return document.querySelector('#selectionsTable table');
  }

  /**
   * Check whether a table node belongs to the current table view.
   */
  function isInsideSelectionsTable(tableNode) {
    var selectionsTable = getSelectionsTable();
    return !!(selectionsTable && tableNode && selectionsTable.contains(tableNode));
  }

  /**
   * Read the page heading / indicator title.
   */
  function getIndicatorTitle() {
    var el =
      document.querySelector('.heading h1') ||
      document.querySelector('h1');

    if (el && el.textContent) {
      return el.textContent.trim();
    }

    return document.title || 'Table';
  }

  /**
   * Read the table caption if present.
   */
  function getTableCaptionText(tableEl) {
    if (!tableEl) return '';

    var caption = tableEl.querySelector('caption');
    if (caption && caption.textContent) {
      return caption.textContent.trim();
    }

    return '';
  }

  /**
   * Check whether DataTables Buttons and the print button type are available.
   */
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

  /**
   * Create a stable external host for our custom visible print button.
   */
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

    // Put it near the top of the table tab.
    area.insertBefore(host, area.firstChild);
    return host;
  }

  /**
   * Create or reuse the visible external print button.
   *
   * This button is NOT the native DataTables button.
   * It is our own stable UI element that calls the hidden DataTables
   * print button via API.
   */
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
   * Bind the click handler of the stable external print button once.
   *
   * DataTables Buttons allows programmatic triggering of a button action
   * using button().trigger(). 【3-0c7993】【4-4237d1】
   */
  function bindExternalButtonClick() {
    if (state.externalButtonBound) {
      return;
    }

    var button = ensureExternalPrintButton();
    if (!button) {
      return;
    }

    button.addEventListener('click', function () {
      if (!state.currentTable) {
        warn('No active DataTable available for printing.');
        return;
      }

      try {
        state.currentTable.button('mtTablePrint:name', 0).trigger();
        log('Triggered DataTables print action via external button.');
      } catch (error) {
        warn('Failed to trigger DataTables print button.', error);
      }
    });

    state.externalButtonBound = true;
  }

  /**
   * For the current DataTable instance, create a hidden DataTables Buttons
   * instance containing only the print button.
   *
   * We keep this hidden and use the external stable button to trigger it.
   */
  function ensureHiddenPrintButtonsForTable(dataTable, tableEl) {
    if (!dataTable || !tableEl) return false;
    if (!isInsideSelectionsTable(tableEl)) return false;

    if (!isButtonsReady()) {
      warn('DataTables Buttons / print extension is not available.');
      return false;
    }

    var settings = dataTable.settings()[0];

    // Already prepared for this exact DataTable instance.
    if (settings._mtHiddenTablePrintAttached) {
      state.currentTable = dataTable;
      state.currentTableId = tableEl.id || null;
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

    /**
     * We do not show the DataTables Buttons UI.
     * But we append the hidden container once to the document body so that the
     * Buttons instance is fully initialised and available via API.
     */
    var hiddenContainer = dataTable.buttons('mtTablePrint:name', null).container();
    hiddenContainer.addClass('mt-hidden-dt-buttons');
    jQuery(document.body).append(hiddenContainer);

    settings._mtHiddenTablePrintAttached = true;

    state.currentTable = dataTable;
    state.currentTableId = tableEl.id || null;

    log('Hidden table print button attached to DataTable instance.', {
      tableId: state.currentTableId
    });

    return true;
  }

  /**
   * Attach to the currently visible table if possible.
   */
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
    return ensureHiddenPrintButtonsForTable(dataTable, tableEl);
  }

  /**
   * Listen globally for DataTables lifecycle events.
   *
   * DataTables documents:
   * - draw: fired on every redraw
   * - init: fired on initialisation
   * - these events can be listened for centrally because they bubble. 【5-d63033】【6-f1d601】【7-f5a8b9】
   *
   * This is important because your logs show that selecting a Gebietseinheit
   * creates a new table instance (DataTables_Table_0 -> DataTables_Table_1).
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
        ensureHiddenPrintButtonsForTable(dataTable, tableNode);
        bindExternalButtonClick();
      } catch (error) {
        warn('Error while reacting to DataTables lifecycle event.', error);
      }
    });
  }

  /**
   * Initial retry because Open SDG may finish table initialisation
   * shortly after DOM ready.
   */
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
