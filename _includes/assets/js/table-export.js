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
      return el.textContent.trim().replace(/\s+/g, ' ');
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
      return caption.textContent.trim().replace(/\s+/g, ' ');
    }

    return '';
  }

  /**
   * Create or reuse a title/action bar inside #selectionsTable.
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
   * Prepare a safe file name.
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
   * Excel worksheet names have restrictions.
   */
  function sanitizeWorksheetName(value) {
    var name = String(value || 'Tabelle')
      .replace(/[\[\]\*\/\\\?\:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!name) name = 'Tabelle';
    return name.substring(0, 31);
  }

  /**
   * Decide whether a cell should be written as Number or String.
   */
  function getExcelDataType(value) {
    var text = String(value == null ? '' : value).trim();

    if (text === '') {
      return 'String';
    }

    // Keep leading-zero values as strings
    if (/^0\d+$/.test(text)) {
      return 'String';
    }

    // Plain integer or decimal number
    if (/^-?\d+(?:[.,]\d+)?$/.test(text)) {
      return 'Number';
    }

    return 'String';
  }

  /**
   * Normalize number values for Excel XML.
   */
  function getExcelCellValue(value, type) {
    var text = String(value == null ? '' : value).trim();

    if (type === 'Number') {
      return text.replace(',', '.');
    }

    return text;
  }

  /**
   * Estimate a useful Excel column width from header/body text lengths.
   */
  function estimateColumnWidth(headerText, bodyRows, colIndex) {
    var maxLen = String(headerText || '').length;

    bodyRows.forEach(function (row) {
      var cell = row[colIndex] == null ? '' : String(row[colIndex]);
      if (cell.length > maxLen) {
        maxLen = cell.length;
      }
    });

    // Simple heuristic for SpreadsheetML width
    return Math.max(12, Math.min(maxLen + 2, 40));
  }

  /**
   * Build SpreadsheetML (Excel 2003 XML) so that Excel opens it
   * as a formatted worksheet instead of a raw XML tree.
   *
   * This is intentionally a single-sheet workbook.
   */
  function buildSpreadsheetMl(exportData, meta) {
    var header = exportData && exportData.header ? exportData.header : [];
    var body = exportData && exportData.body ? exportData.body : [];

    var title = meta.indicatorTitle || '';
    var caption = meta.tableCaption || '';
    var source = meta.source || '';
    var sheetName = sanitizeWorksheetName(caption || title || 'Tabelle');

    var mergeAcross = Math.max(header.length - 1, 0);

    // Row count:
    // title + caption + blank + header + body rows + blank + source
    var expandedRowCount = 1 + 1 + 1 + 1 + body.length + 1 + 1;
    var expandedColumnCount = Math.max(header.length, 1);

    var lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<?mso-application progid="Excel.Sheet"?>');
    lines.push('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"');
    lines.push(' xmlns:o="urn:schemas-microsoft-com:office:office"');
    lines.push(' xmlns:x="urn:schemas-microsoft-com:office:excel"');
    lines.push(' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"');
    lines.push(' xmlns:html="http://www.w3.org/TR/REC-html40">');

    lines.push('  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">');
    lines.push('    <Author>M365 Copilot</Author>');
    lines.push('    <Created>' + escapeXml(meta.exportedAt || '') + '</Created>');
    lines.push('    <Version>11.9999</Version>');
    lines.push('  </DocumentProperties>');

    lines.push('  <ExcelWorkbook xmlns="urn:schemas-microsoft-com:office:excel">');
    lines.push('    <ProtectStructure>False</ProtectStructure>');
    lines.push('    <ProtectWindows>False</ProtectWindows>');
    lines.push('  </ExcelWorkbook>');

    lines.push('  <Styles>');
    lines.push('    <Style ss:ID="Default" ss:Name="Normal">');
    lines.push('      <Alignment ss:Vertical="Bottom"/>');
    lines.push('      <Borders/>');
    lines.push('      <Font ss:FontName="Calibri" ss:Size="11"/>');
    lines.push('      <Interior/>');
    lines.push('      <NumberFormat/>');
    lines.push('      <Protection/>');
    lines.push('    </Style>');

    lines.push('    <Style ss:ID="Title">');
    lines.push('      <Font ss:FontName="Calibri" ss:Size="20" ss:Bold="1"/>');
    lines.push('      <Alignment ss:Vertical="Center"/>');
    lines.push('    </Style>');

    lines.push('    <Style ss:ID="Subtitle">');
    lines.push('      <Font ss:FontName="Calibri" ss:Size="11"/>');
    lines.push('      <Alignment ss:Vertical="Center"/>');
    lines.push('    </Style>');

    lines.push('    <Style ss:ID="Header">');
    lines.push('      <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/>');
    lines.push('      <Interior ss:Color="#E6E6E6" ss:Pattern="Solid"/>');
    lines.push('      <Borders>');
    lines.push('        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>');
    lines.push('        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>');
    lines.push('        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>');
    lines.push('        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>');
    lines.push('      </Borders>');
    lines.push('    </Style>');

    lines.push('    <Style ss:ID="Data">');
    lines.push('      <Borders>');
    lines.push('        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>');
    lines.push('        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>');
    lines.push('        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>');
    lines.push('        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>');
    lines.push('      </Borders>');
    lines.push('    </Style>');

    lines.push('    <Style ss:ID="DataAlt">');
    lines.push('      <Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/>');
    lines.push('      <Borders>');
    lines.push('        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>');
    lines.push('        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>');
    lines.push('        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>');
    lines.push('        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>');
    lines.push('      </Borders>');
    lines.push('    </Style>');

    lines.push('    <Style ss:ID="Source">');
    lines.push('      <Font ss:FontName="Calibri" ss:Size="10"/>');
    lines.push('    </Style>');
    lines.push('  </Styles>');

    lines.push('  <Worksheet ss:Name="' + escapeXml(sheetName) + '">');
    lines.push(
      '    <Table ss:ExpandedColumnCount="' + escapeXml(expandedColumnCount) +
      '" ss:ExpandedRowCount="' + escapeXml(expandedRowCount) +
      '" x:FullColumns="1" x:FullRows="1" ss:DefaultRowHeight="15">'
    );

    // Column widths
    header.forEach(function (columnName, colIndex) {
      var width = estimateColumnWidth(columnName, body, colIndex);
      lines.push('      <Column ss:Width="' + escapeXml(width * 6.5) + '"/>');
    });

    // Title row
    lines.push('      <Row ss:Height="30">');
    lines.push(
      '        <Cell ss:StyleID="Title"' +
      (mergeAcross > 0 ? ' ss:MergeAcross="' + escapeXml(mergeAcross) + '"' : '') +
      '><Data ss:Type="String">' + escapeXml(title) + '</Data></Cell>'
    );
    lines.push('      </Row>');

    // Subtitle / caption row
    lines.push('      <Row ss:Height="18">');
    lines.push(
      '        <Cell ss:StyleID="Subtitle"' +
      (mergeAcross > 0 ? ' ss:MergeAcross="' + escapeXml(mergeAcross) + '"' : '') +
      '><Data ss:Type="String">' + escapeXml(caption) + '</Data></Cell>'
    );
    lines.push('      </Row>');

    // Blank row
    lines.push('      <Row ss:Height="8"/>');

    // Header row
    lines.push('      <Row>');
    header.forEach(function (columnName) {
      lines.push(
        '        <Cell ss:StyleID="Header"><Data ss:Type="String">' +
          escapeXml(columnName) +
        '</Data></Cell>'
      );
    });
    lines.push('      </Row>');

    // Data rows
    body.forEach(function (row, rowIndex) {
      var styleId = rowIndex % 2 === 0 ? 'Data' : 'DataAlt';

      lines.push('      <Row>');
      row.forEach(function (cellValue) {
        var dataType = getExcelDataType(cellValue);
        var normalizedValue = getExcelCellValue(cellValue, dataType);

        lines.push(
          '        <Cell ss:StyleID="' + styleId + '"><Data ss:Type="' +
            dataType +
            '">' +
            escapeXml(normalizedValue) +
          '</Data></Cell>'
        );
      });
      lines.push('      </Row>');
    });

    // Blank row
    lines.push('      <Row ss:Height="8"/>');

    // Source row
    lines.push('      <Row>');
    lines.push(
      '        <Cell ss:StyleID="Source"' +
      (mergeAcross > 0 ? ' ss:MergeAcross="' + escapeXml(mergeAcross) + '"' : '') +
      '><Data ss:Type="String">' + escapeXml(source) + '</Data></Cell>'
    );
    lines.push('      </Row>');

    lines.push('    </Table>');
    lines.push('    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">');
    lines.push('      <PageSetup>');
    lines.push('        <Layout x:Orientation="Landscape"/>');
    lines.push('      </PageSetup>');
    lines.push('      <Selected/>');
    lines.push('      <ProtectObjects>False</ProtectObjects>');
    lines.push('      <ProtectScenarios>False</ProtectScenarios>');
    lines.push('    </WorksheetOptions>');
    lines.push('  </Worksheet>');

    lines.push('</Workbook>');

    return lines.join('\n');
  }

  /**
   * Trigger a client-side download of the generated SpreadsheetML file.
   *
   * Note:
   * The site can reliably trigger the download. Whether Excel opens
   * automatically depends on browser/system settings.
   */
  function downloadSpreadsheetMl(fileName, xmlString) {
    var blob = new Blob([xmlString], {
      type: 'application/vnd.ms-excel;charset=utf-8'
    });
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
   * Create the SpreadsheetML export from the current DataTable state.
   */
  function exportCurrentTableAsSpreadsheetMl(dt, tableEl) {
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

    var xmlString = buildSpreadsheetMl(exportData, {
      indicatorTitle: indicatorTitle,
      tableCaption: tableCaption,
      exportedAt: exportedAt,
      source: 'Quelle: Integrationsmonitoring Niedersachsen'
    });

    var baseName = sanitizeFileName(tableCaption || indicatorTitle || 'table-export');
    var fileName = (baseName || 'table-export') + '.xml';

    downloadSpreadsheetMl(fileName, xmlString);
  }

  /**
   * Attach (or reattach) the export buttons to the current DataTable instance.
   *
   * Buttons included:
   * - Print (if Buttons print plug-in is loaded)
   * - XML export (SpreadsheetML / Excel XML)
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

    if (settings._mtTableExportAttached) {
      return placeButtonsContainer(dataTable);
    }

    var indicatorTitle = getIndicatorTitle();

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

    // SpreadsheetML export button
    buttons.push({
      text: '🧾 XML exportieren',
      className: 'buttons-xml mt-table-xml-button',
      action: function (e, dt) {
        try {
          exportCurrentTableAsSpreadsheetMl(dt, tableEl);
        } catch (error) {
          warn('SpreadsheetML export failed.', error);
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
   * Needed after area rebuilds triggered by the region selection.
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
   * We only react to init.dt here.
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