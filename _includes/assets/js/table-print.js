(function () {
  'use strict';

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

  /**
   * Main Open SDG table container.
   */
  function getSelectionsTable() {
    return document.getElementById('selectionsTable');
  }

  /**
   * Stable host area for the visible print button.
   *
   * This version places the native DataTables print button into the table tab
   * area, above the table content.
   */
  function getStableButtonArea() {
    return (
      document.getElementById('tableview') ||
      (getSelectionsTable() ? getSelectionsTable().closest('.tab-pane') : null) ||
      null
    );
  }

  /**
   * Create or reuse the host for the native DataTables print button.
   */
  function ensureButtonHost() {
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

  /**
   * Check whether a table belongs to the current Open SDG table tab.
   */
  function isInsideSelectionsTable(tableNode) {
    var selectionsTable = getSelectionsTable();
    return !!(selectionsTable && tableNode && selectionsTable.contains(tableNode));
  }

  /**
   * Read the indicator title from the page heading.
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
   * Read the HTML table caption if present.
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
   * Move the native DataTables Buttons container into the host.
   *
   * DataTables Buttons supports retrieving a Buttons container and inserting it
   * into the document with standard jQuery methods. 【1-b5a005】【2-4bbc61】
   */
  function placeButtonsContainer(dataTable) {
    var host = ensureButtonHost();
    if (!host) {
      warn('Could not create stable button host.');
      return false;
    }

    jQuery(host).empty();
    dataTable.buttons('mtTablePrint:name', null).container().appendTo(host);
    return true;
  }

  /**
   * Ensure that the given DataTable instance has a native print button attached,
   * and place its container into the host.
   */
  function ensurePrintButtonForTable(dataTable, tableEl) {
    if (!dataTable || !tableEl) return false;
    if (!isInsideSelectionsTable(tableEl)) return false;

    if (!isButtonsReady()) {
      warn('DataTables Buttons / print extension is not available.');
      return false;
    }

    var settings = dataTable.settings()[0];

    // If already attached for this DataTable instance, only move the container.
    if (settings._mtTablePrintAttached) {
      placeButtonsContainer(dataTable);
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

    settings._mtTablePrintAttached = true;
    placeButtonsContainer(dataTable);

    log('Native DataTables print button attached and placed.', {
      tableId: tableEl.id
    });

    return true;
  }

  /**
   * Attach to the current visible table if available.
   */
  function attachToCurrentTable() {
    if (!window.jQuery || !jQuery.fn || !jQuery.fn.dataTable) {
      warn('jQuery DataTables is not available.');
      return false;
    }

    var tableEl = document.querySelector('#selectionsTable table');
    if (!tableEl) {
      warn('No table found in #selectionsTable.');
      return false;
    }

    if (!jQuery.fn.dataTable.isDataTable(tableEl)) {
      warn('The current table exists, but is not an active DataTable yet.');
      return false;
    }

    var dataTable = jQuery(tableEl).DataTable();
    return ensurePrintButtonForTable(dataTable, tableEl);
  }

  /**
   * Listen globally for DataTables lifecycle events.
   *
   * DataTables documents:
   * - draw: fired whenever the table is redrawn
   * - init: fired whenever a DataTable is initialised
   * - these events bubble and can be listened for centrally. 【3-7d5be4】【4-266252】【5-b30c02】
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
        ensurePrintButtonForTable(dataTable, tableNode);
      } catch (error) {
        warn('Error while reacting to DataTables lifecycle event.', error);
      }
    });
  }

  /**
   * Retry initial attachment because Open SDG may initialise the table
   * slightly after DOM ready.
   */
  function bootstrapWithRetry() {
    bindGlobalDataTableEvents();

    var attempts = 0;
    var maxAttempts = 30;

    var retryTimer = window.setInterval(function () {
      attempts += 1;

      var attached = attachToCurrentTable();
      if (attached || attempts >= maxAttempts) {
        window.clearInterval(retryTimer);

        if (!attached) {
          warn('Giving up after retrying to attach the native table print button.');
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
