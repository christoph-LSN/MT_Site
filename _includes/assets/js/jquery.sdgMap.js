          // ========== MAP IMAGE DOWNLOAD ==========
          // Registriere Click-Handler mit .on() statt .one()
          // Das ermöglicht mehrfache Downloads
          $(document).on('click', '#btnSaveMap', function (e) {
            e.preventDefault();
            
            var mapElement = document.getElementById('map');
            if (!mapElement) {
              console.error('Map element not found');
              return;
            }

            // Prüfe ob Libraries vorhanden sind
            if (typeof html2canvas === 'undefined') {
              alert('html2canvas is not loaded');
              return;
            }
            if (typeof saveAs === 'undefined') {
              alert('saveAs is not loaded');
              return;
            }

            var filename = plugin.indicatorId + '_map.png';

            var options = {
              width: $(mapElement).width(),
              height: $(mapElement).height(),
              windowWidth: $(mapElement).width(),
              windowHeight: $(mapElement).height(),
              x: 0,
              y: 0,
              scrollX: 0,
              scrollY: 0,
              scale: 2,
              backgroundColor: '#FFFFFF',
              onclone: function (clone) {
                clone.body.classList.add('map-download-in-progress');
                $(clone).find('.leaflet-control').hide();
              },
              ignoreElements: function (el) {
                var keepTags = ['STYLE', 'HEAD', 'LINK'];
                if (keepTags.indexOf(el.tagName) !== -1) {
                  return false;
                }
                if (mapElement.contains(el) || el.contains(mapElement)) {
                  return false;
                }
                return true;
              }
            };

            console.log('Starting map download...');
            
            html2canvas(mapElement, options).then(function (canvas) {
              console.log('Canvas created, size:', canvas.width, 'x', canvas.height);
              canvas.toBlob(function (blob) {
                console.log('Blob created, downloading file...');
                saveAs(blob, filename);
              });
            }).catch(function(error) {
              console.error('Error during map download:', error);
              alert('Fehler beim Herunterladen der Karte: ' + error.message);
            });
          });
          // ========== END: MAP IMAGE DOWNLOAD ==========
