(function () {
  'use strict';

  var reattachTimer = null;

  function log(message, data) {
    if (window.console && console.log) {
      if (typeof data !== 'undefined') {
        console.log('[table-export] ' + message, data);
      } else {
        console.log('[table-export] ' + message);
      }
    }
  }

  function warn(message, data) {
    if (window.console && console.warn) {
      if (typeof data !== 'undefined') {
        console.warn('[table-export] ' + message, data);
      } else {
        console.warn('[table-export] ' + message);
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
   * Create or reuse a title/action bar inside #selectionsTable.
   *
   * Structure:
   * .table-print-bar
   *   .table-print-title
   *   .table-print-actions
   */
  function ensureButtonHost() {
    var selectionsTable = document.getElementById('selectionsTable');
    if (!selectionsTable) return null;

    var existingActions = selectionsTable.querySelector('.table-print-actions');
    if (existingActions) {
      return existingActions;
    }

    var tableEl = getTableElement();
    var titleText = getTableCaptionText(tableEl) || getIndicatorTitle();

    var bar = document.createElement('div');
    bar.className = 'table-print-bar';

    var title = document.createElement('div');
    title.className = 'table-print-title';
    title.textContent = titleText;

    var actions = document.createElement('div');
    actions.className = 'table-print-actions';

    bar.appendChild(title);
    bar.appendChild(actions);

    selectionsTable.insertBefore(bar, selectionsTable.firstChild);

    // Hide the original visible table caption via CSS if desired.
    selectionsTable.classList.add('has-table-print-bar');

    return actions;
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
   * Check whether the Buttons core extension is available.
   */
  function isButtonsCoreReady() {
    return !!(
      window.jQuery &&
      jQuery.fn &&
      jQuery.fn.dataTable &&
      jQuery.fn.dataTable.Buttons
    );
  }

  /**
   * Check whether the Buttons print extension is available.
   */
  function isPrintButtonReady() {
    return !!(
      window.jQuery &&
      jQuery.fn &&
      jQuery.fn.dataTable &&
      jQuery.fn.dataTable.ext &&
      jQuery.fn.dataTable.ext.buttons &&
      jQuery.fn.dataTable.ext.buttons.print
    );
  }

  /**
   * Move / reinsert the button container into the title/action bar.
   */
  function placeButtonsContainer(dataTable) {
    var actionHost = ensureButtonHost();
    if (!actionHost) {
      warn('Could not create export action host inside #selectionsTable.');
      return false;
    }

    jQuery(actionHost).empty();
    dataTable.buttons('mtTableExport', null).container().appendTo(actionHost);
    return true;
  }

  /**
   * Prepare a safe file name for XML export.
   */
  function sanitizeFileName(value) {
    return String(value || 'table-export')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
  }

  /**
   * Escape values for XML text and attributes.
   */
  function escapeXml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Build a simple, robust XML export from DataTables exportData().
   *
   * Structure:
   * <tableExport>
   *   <meta>...</meta>
   *   <columns>...</columns>
   *   <rows>...</rows>
   * </tableExport>
   */
  function buildXmlString(exportData, meta) {
    var header = exportData && exportData.header ? exportData.header : [];
    var body = exportData && exportData.body ? exportData.body : [];

    var lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<tableExport>');

    lines.push('  <meta>');
    lines.push('    <indicatorTitle>' + escapeXml(meta.indicatorTitle || '') + '</indicatorTitle>');
    lines.push('    <tableCaption>' + escapeXml(meta.tableCaption || '') + '</tableCaption>');
    lines.push('    <exportedAt>' + escapeXml(meta.exportedAt || '') + '</exportedAt>');
    lines.push('    <rowCount>' + escapeXml(body.length) + '</rowCount>');
    lines.push('    <columnCount>' + escapeXml(header.length) + '</columnCount>');
    lines.push('  </meta>');

    lines.push('  <columns>');
    header.forEach(function (columnName, colIndex) {
      lines.push(
        '    <column index="' + escapeXml(colIndex) + '">' +
          escapeXml(columnName) +
        '</column>'
      );
    });
    lines.push('  </columns>');

    lines.push('  <rows>');
    body.forEach(function (row, rowIndex) {
      lines.push('    <row index="' + escapeXml(rowIndex) + '">');

      row.forEach(function (cellValue, colIndex) {
        var columnName = header[colIndex] || ('column-' + colIndex);
        lines.push(
          '      <cell columnIndex="' + escapeXml(colIndex) +
          '" columnName="' + escapeXml(columnName) + '">' +
          escapeXml(cellValue) +
          '</cell>'
        );
      });

      lines.push('    </row>');
    });
    lines.push('  </rows>');

    lines.push('</tableExport>');

    return lines.join('\n');
  }

  /**
   * Trigger a client-side download of the generated XML file.
   *
   * Note:
   * The website can reliably trigger the download, but whether the file
   * opens automatically in Excel or another XML handler depends on browser
   * and system settings, not on this script.
   */
  function downloadXmlFile(fileName, xmlString) {
    var blob = new Blob([xmlString], { type: 'application/xml;charset=utf-8' });
    var url = window.URL.createObjectURL(blob);

    var link = document.createElement('a');
    link.href = url;
    link.download = fileName;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.setTimeout(function () {
      window.URL.revokeObjectURL(url);
    }, 1000);
  }

  /**
   * Create the XML export from the current DataTable state.
   */
  function exportCurrentTableAsXml(dt, tableEl) {
    var indicatorTitle = getIndicatorTitle();
    var tableCaption = getTableCaptionText(tableEl);
    var exportedAt = new Date().toISOString();

    var exportData = dt.buttons.exportData({
      columns: ':visible',
      modifier: {
        search: 'applied',
        order: 'applied',
        selected: null
      },
      stripHtml: true,
      stripNewlines: false,
      decodeEntities: true
    });

    var xmlString = buildXmlString(exportData, {
      indicatorTitle: indicatorTitle,
      tableCaption: tableCaption,
      exportedAt: exportedAt
    });

    var baseName = sanitizeFileName(tableCaption || indicatorTitle || 'table-export');
    var fileName = baseName ? (baseName + '.xml') : 'table-export.xml';

    downloadXmlFile(fileName, xmlString);
  }

  /**
   * Attach (or reattach) the export buttons to the current DataTable instance.
   *
   * Buttons included:
   * - Print (if Buttons print plug-in is loaded)
   * - XML export (custom button)
   */
  function attachExportButtons() {
    var tableEl = getTableElement();
    if (!tableEl) {
      return false;
    }

    if (!window.jQuery) {
      warn('jQuery is not available.');
      return false;
    }

    var $table = jQuery(tableEl);

    if (!isDataTableReady($table)) {
      return false;
    }

    if (!isButtonsCoreReady()) {
      warn('DataTables Buttons core is not available.');
      return false;
    }

    var dataTable = $table.DataTable();
    var settings = dataTable.settings()[0];

    // If already attached for this table instance, simply reinsert the container.
    if (settings._mtTableExportAttached) {
      return placeButtonsContainer(dataTable);
    }

    var indicatorTitle = getIndicatorTitle();
    var tableCaption = getTableCaptionText(tableEl);

    var buttons = [];

    // Keep the existing print button if the extension is available.
    if (isPrintButtonReady()) {
      buttons.push({
        extend: 'print',
        text: '🖨 {{ page.t.indicator.print_table | default: "Drucken" | escape }}',
        className: 'buttons-print mt-table-print-button',
        autoPrint: false,
        title: indicatorTitle,
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

          var printedTable = body.querySelector('table');

          // Remove table caption so only the main title remains.
          body.querySelectorAll('caption').forEach(function (el) {
            if (el.parentNode) {
              el.parentNode.removeChild(el);
            }
          });

          var source = doc.createElement('div');
          source.className = 'mt-table-print-source';
          source.textContent = 'Quelle: Integrationsmonitoring Niedersachsen';
          body.appendChild(source);

          if (printedTable) {
            printedTable.classList.add(
              'table',
              'table-bordered',
              'table-sm',
              'mt-table-print-table'
            );
          }
        }
      });
    }

    // Add the XML export button as a custom DataTables button.
    buttons.push({
      text: '🧾 XML exportieren',
      className: 'buttons-xml mt-table-xml-button',
      action: function (e, dt /* DataTables API */, node, config) {
        try {
          exportCurrentTableAsXml(dt, tableEl);
        } catch (error) {
          warn('XML export failed.', error);
        }
      }
    });

    new jQuery.fn.dataTable.Buttons(dataTable, {
      name: 'mtTableExport',
      buttons: buttons
    });

    settings._mtTableExportAttached = true;
    log('Table export buttons attached.', { tableId: tableEl.id });

    return placeButtonsContainer(dataTable);
  }

  /**
   * Start a short retry cycle.
   *
   * This is mainly needed after area rebuilds triggered by the region selection.
   * We retry briefly until the current table is fully ready again.
   */
  function scheduleReattach() {
    if (reattachTimer) {
      window.clearInterval(reattachTimer);
      reattachTimer = null;
    }

    var attempts = 0;
    var maxAttempts = 12;

    reattachTimer = window.setInterval(function () {
      attempts += 1;

      var attached = attachExportButtons();
      if (attached || attempts >= maxAttempts) {
        window.clearInterval(reattachTimer);
        reattachTimer = null;

        if (!attached) {
          warn('Reattach attempt finished without visible export buttons.');
        }
      }
    }, 250);
  }

  /**
   * Listen globally for DataTables lifecycle events.
   *
   * We only react to init.dt here. That matches your current stable logic:
   * - initial page load => bootstrap() / scheduleReattach()
   * - checkbox driven area rebuild => change listener + init.dt
   * - sorting must NOT trigger a reattach
   */
  function bindGlobalDataTableEvents() {
    if (!window.jQuery) return;

    jQuery(document).off('.mtTableExport');

    jQuery(document).on('init.dt.mtTableExport', function (e, settings) {
      try {
        if (!settings || !settings.nTable) return;

        var tableNode = settings.nTable;
        var selectionsTable = document.getElementById('selectionsTable');

        if (!selectionsTable || !selectionsTable.contains(tableNode)) {
          return;
        }

        scheduleReattach();
      } catch (error) {
        warn('Error while reacting to DataTables init event.', error);
      }
    });
  }

  /**
   * React to checkbox changes in the region selection.
   *
   * This is the main trigger for the disaggregation / region workflow.
   */
  function bindSelectionChangeEvents() {
    document.addEventListener(
      'change',
      function (e) {
        var target = e.target;

        if (
          target &&
          target.tagName === 'INPUT' &&
          target.type === 'checkbox'
        ) {
          scheduleReattach();
        }
      },
      true
    );
  }

  /**
   * Initial bootstrap.
   */
  function bootstrap() {
    bindGlobalDataTableEvents();
    bindSelectionChangeEvents();
    scheduleReattach();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();