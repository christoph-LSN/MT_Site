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
   * Return the current Open SDG table container.
   */
  function getSelectionsTable() {
    return document.getElementById('selectionsTable');
  }

  /**
   * Find a stable parent container for the print button.
   *
   * Important:
   * We do NOT place the button inside #selectionsTable itself anymore,
   * because that area can be rebuilt / replaced when filters change.
   *
   * Instead we try to place it in the surrounding tab panel (or a similar
   * parent container) and keep it above the dynamic table area.
   */
  function getStableTableArea() {
    var selectionsTable = getSelectionsTable();
    if (!selectionsTable) return null;

    return (
      selectionsTable.closest('.tab-pane') ||
      selectionsTable.parentNode ||
      selectionsTable
    );
  }

  /**
   * Check whether a table node belongs to the current table view.
   */
  function isInsideSelectionsTable(tableNode) {
    var selectionsTable = getSelectionsTable();
    return !!(selectionsTable && tableNode && selectionsTable.contains(tableNode));
  }

  /**
   * Read the page / indicator title.
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
   * Read the HTML caption from the current table.
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
   * Create or reuse a stable host for the print button.
   *
   * The host is inserted BEFORE #selectionsTable inside the stable parent
   * container, so it survives redraws / replacements of the table itself.
   */
  function ensureButtonHost() {
    var stableArea = getStableTableArea();
    var selectionsTable = getSelectionsTable();

    if (!stableArea || !selectionsTable) {
      return null;
    }

    var existing = stableArea.querySelector('.table-print-buttons');
    if (existing) {
      return existing;
    }

    var host = document.createElement('div');
    host.className = 'table-print-buttons';

    stableArea.insertBefore(host, selectionsTable);
    return host;
  }

  /**
   * Check whether the DataTables Buttons extension and the print button type
   * are available.
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
   * Reinsert the existing Buttons container into our stable host.
   *
   * DataTables explicitly supports obtaining a Buttons container through the API
   * and then inserting it wherever needed with standard jQuery methods. 【4-602cd6】【5-c5b8be】
   */
  function reattachButtonsContainer(dataTable) {
    var host = ensureButtonHost();
    if (!host) {
      warn('Could not create stable button host.');
      return false;
    }

    jQuery(host).empty();
    dataTable.buttons('mtTablePrint', null).container().appendTo(host);
    return true;
  }

  /**
   * Attach or reattach the print button to the given DataTable instance.
   *
   * Safe to call multiple times:
   * - if already attached, only the DOM insertion is repeated
   * - otherwise a new Buttons instance is created once for this table
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

    // If this table instance already has the print button, simply reinsert it.
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
   * Attach to the currently visible table in the table tab, if available.
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
   * Listen globally for DataTables lifecycle events.
   *
   * Why global?
   * Open SDG may replace or recreate the table when selections change.
   * Binding only to one initial table instance is therefore not robust enough.
   *
   * DataTables documents that:
   * - 'draw' fires whenever a redraw happens
   * - 'init' fires when a DataTable is initialised
   * - these events bubble and can be listened to centrally. 【1-d7abcd】【2-b1e96b】【3-463451】
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
   * Retry bootstrap for a short period because Open SDG may initialise
   * the table slightly after DOM ready.
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
``
