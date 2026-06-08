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
   * Find the visible table inside the Open SDG table tab.
   */
  function getTableElement() {
    return document.querySelector('#selectionsTable table');
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
   * Create or reuse a stable host container in #tableview
   * where the native DataTables print button will be rendered.
   *
   * This is the only intentional change compared with the earlier rollback:
   * the host is outside #selectionsTable so it survives table rebuilds better.
   */
  function ensureButtonHost() {
    var tableView = document.getElementById('tableview');
    if (!tableView) return null;

    var existing = tableView.querySelector('.table-print-buttons');
    if (existing) {
      return existing;
    }

    var host = document.createElement('div');
    host.className = 'table-print-buttons';

    tableView.insertBefore(host, tableView.firstChild);
    return host;
  }

  /**
   * Check whether the table is already an active DataTable.
   */
  function isDataTableReady($table) {
    return !!(
      window.jQuery &&
      jQuery.fn &&
      jQuery.fn.dataTable &&
      $table &&
      $table.length &&
      jQuery.fn.dataTable.isDataTable($table.get(0))
    );
  }

  /**
   * Check whether the Buttons extension and the print button type are loaded.
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
   * Insert (or re-insert) the button container into the stable host.
   *
   * DataTables Buttons supports retrieving the button container through
   * the API and inserting it into the document with standard jQuery methods. 【3-f4c352】【4-5a66ad】
   */
  function placeButtonsContainer(dataTable) {
    var buttonHost = ensureButtonHost();
    if (!buttonHost) {
      warn('Could not create button host inside #tableview.');
      return false;
    }

    jQuery(buttonHost).empty();
    dataTable.buttons('mtTablePrint', null).container().appendTo(buttonHost);
    return true;
  }

  /**
   * Attach the native DataTables print button to the given DataTable instance.
   *
   * If already attached for this table instance, only move the container back
   * into the stable host.
   */
  function ensurePrintButtonForTable(dataTable, tableEl) {
    if (!dataTable || !tableEl) return false;

    if (!isButtonsReady()) {
      warn('DataTables Buttons / print extension is not available.');
      return false;
    }

    var settings = dataTable.settings()[0];

    if (settings._mtTablePrintAttached) {
      return placeButtonsContainer(dataTable);
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
    log('Native table print button attached.', { tableId: tableEl.id });

    return placeButtonsContainer(dataTable);
  }

  /**
   * Attach to the currently visible table if available.
   */
  function attachToCurrentTable() {
    if (!window.jQuery || !jQuery.fn || !jQuery.fn.dataTable) {
      warn('jQuery DataTables is not available.');
      return false;
    }

    var tableEl = getTableElement();
    if (!tableEl) {
      warn('No table found in #selectionsTable.');
      return false;
    }

    var $table = jQuery(tableEl);

    if (!isDataTableReady($table)) {
      warn('The current table exists, but is not an active DataTable yet.');
      return false;
    }

    var dataTable = $table.DataTable();
    return ensurePrintButtonForTable(dataTable, tableEl);
  }

  /**
   * Listen globally for DataTables lifecycle events.
   *
   * DataTables documents:
   * - draw: fired whenever the table is redrawn
   * - init: fired whenever a DataTable is initialised
   * - these events bubble and can be listened for centrally. 【1-cc4196】【2-63821f】
   *
   * This matters here because your logs show that selecting a Gebietseinheit
   * creates a new table instance (DataTables_Table_0 -> DataTables_Table_1). 【1-cc4196】【2-63821f】
   */
  function bindGlobalDataTableEvents() {
    if (!window.jQuery) return;

    jQuery(document).off('.mtTablePrint');

    jQuery(document).on('init.dt.mtTablePrint draw.dt.mtTablePrint', function (e, settings) {
      try {
        if (!settings || !settings.nTable) return;

        var tableNode = settings.nTable;
        var selectionsTable = document.getElementById('selectionsTable');

        if (!selectionsTable || !selectionsTable.contains(tableNode)) {
          return;
        }

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

    var timer = window.setInterval(function () {
      attempts += 1;

      var attached = attachToCurrentTable();
      if (attached || attempts >= maxAttempts) {
        window.clearInterval(timer);

        if (!attached) {
          warn('Giving up after retrying to attach the table print button.');
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