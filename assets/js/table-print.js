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
   * Prefer the existing Open SDG toolbar/download area above the table.
   *
   * Your debug logs showed mutations on:
   *   div#tableSelectionDownload.clearfix
   *
   * That makes it the best candidate for a stable print button host.
   */
  function getPrintHostParent() {
    return (
      document.getElementById('tableSelectionDownload') ||
      (getSelectionsTable() ? getSelectionsTable().closest('.tab-pane') : null) ||
      (getSelectionsTable() ? getSelectionsTable().parentNode : null) ||
      null
    );
  }

  /**
   * Find or create the host that will contain the print button.
   *
   * We deliberately place this host OUTSIDE the dynamic #selectionsTable block,
   * because #selectionsTable is rebuilt when disaggregation selections change.
   */
  function ensureButtonHost() {
    var parent = getPrintHostParent();
    if (!parent) {
      return null;
    }

    var existing = parent.querySelector('.table-print-buttons');
    if (existing) {
      return existing;
    }

    var host = document.createElement('div');
    host.className = 'table-print-buttons';

    parent.appendChild(host);
    return host;
  }

  /**
   * Check whether a table node belongs to the current Open SDG table view.
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
   * Re-insert the Buttons container into the stable host.
   *
   * DataTables Buttons explicitly supports obtaining the container for a
   * button set and moving it into the document with standard jQuery methods. 【4-2d1bf5】【5-73db1c】
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
   * Attach or reattach the print button to a specific DataTable instance.
   *
   * Safe to call multiple times:
   * - if already attached for this DataTable instance, only reinsert the container
   * - otherwise create the Buttons instance once
   */
  function attachPrintButtonToDataTable(dataTable, tableEl) {
    if (!dataTable || !tableEl) return false;
    if (!isInsideSelectionsTable(tableEl)) return false;

    if (!isButtonsReady()) {
      warn('DataTables Buttons / print extension is not available.');
      return false;
    }

    var settings = dataTable.settings()[0];

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

    log('Print button attached to DataTable instance.', {
      tableId: tableEl.id
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
   * DataTables documents:
   * - draw: fires whenever the table is redrawn
   * - init: fires when a DataTable is initialised
   * - these events bubble and can be listened for centrally. 【1-e3d63d】【2-34836b】【3-a71c6b】
   *
   * This is important because your logs show the table changes from
   * DataTables_Table_0 to DataTables_Table_1 when a Gebietseinheit is selected.
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
