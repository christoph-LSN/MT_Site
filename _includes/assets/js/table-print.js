(function () {
  'use strict';

  /**
   * Log helper for debugging.
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
   * Warning helper for debugging.
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
   * Return the current #selectionsTable container.
   */
  function getSelectionsTable() {
    return document.getElementById('selectionsTable');
  }

  /**
   * Check whether a table node belongs to the Open SDG table tab.
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
   * Create or reuse a host element for the print button.
   * The host sits above the current table inside #selectionsTable.
   */
  function ensureButtonHost() {
    var selectionsTable = getSelectionsTable();
    if (!selectionsTable) return null;

    var existing = selectionsTable.querySelector('.table-print-buttons');
    if (existing) {
      return existing;
    }

    var host = document.createElement('div');
    host.className = 'table-print-buttons';

    selectionsTable.insertBefore(host, selectionsTable.firstChild);
    return host;
  }

  /**
   * Check whether DataTables Buttons and the print button are available.
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
   * Re-insert the Buttons container into the current DOM.
   *
   * DataTables documents that Buttons containers can be accessed via the API
   * and inserted into the document using standard jQuery methods. 【4-439a9f】【5-16ad2e】
   */
  function reattachButtonsContainer(dataTable) {
    var host = ensureButtonHost();
    if (!host) {
      warn('Could not create button host.');
      return false;
    }

    jQuery(host).empty();
    dataTable.buttons('mtTablePrint', null).container().appendTo(host);
    return true;
  }

  /**
   * Attach (or reattach) the print button to a given DataTable instance.
   *
   * This function is safe to call repeatedly:
   * - if Buttons are already attached, it only re-inserts the button container
   * - otherwise it creates the Buttons instance once
   */
  function attachPrintButtonToDataTable(dataTable, tableEl) {
    if (!dataTable || !tableEl) return false;

    if (!isInsideSelectionsTable(tableEl)) {
      return false;
    }

    if (!isButtonsReady()) {
      warn('DataTables Buttons / print extension is not available.');
      return false;
    }

    var settings = dataTable.settings()[0];

    // If already attached, only reinsert the container into the current DOM.
    if (settings._mtTablePrintAttached) {
      reattachButtonsContainer(dataTable);
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

    reattachButtonsContainer(dataTable);

    settings._mtTablePrintAttached = true;
    log('Print button attached to current DataTable instance.');
    return true;
  }

  /**
   * Try to attach to the currently visible table in #selectionsTable.
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
      warn('The table exists, but is not an active DataTable yet.');
      return false;
    }

    var dataTable = jQuery(tableEl).DataTable();
    return attachPrintButtonToDataTable(dataTable, tableEl);
  }

  /**
   * Global event binding for DataTables lifecycle.
   *
   * DataTables events bubble and can be listened to centrally. The draw event
   * fires whenever the table is redrawn. The init event fires when a DataTable
   * has been initialised. 【1-c96af1】【2-546630】【3-e82120】
   *
   * This is more robust than attaching only to a single table instance,
   * because Open SDG may replace the table when filters / selections change.
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
        attachPrintButtonToDataTable(dataTable, tableNode);
      } catch (error) {
        warn('Error while reacting to DataTables event.', error);
      }
    });
  }

  /**
   * Initial bootstrap with retry because Open SDG may initialise the table
   * shortly after DOM ready.
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
