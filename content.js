// Woke Maps
// Tries to respond to Google Maps rendering at certain locations, and overwrites with
// labels more desirable to the user.

console.log("wokemaps: extension initializing");

(async function() {

  // Initialize options manager
  const optionsManager = new OptionsManager();
  const options = await optionsManager.getOptions();
  const debugOptions = options.debug || {};

  // Enhanced logging function
  function log(level, ...args) {
    if (level <= (debugOptions.logLevel || 0)) {
      console.log("wokemaps:", ...args);
    }
  }

  // Load app data
  const appDataManager = new AppDataManager(optionsManager);
  const allLabels = await appDataManager.getLabels();

  const announcements = (await optionsManager.getOption('enableAnnouncements', true)) ?
      (await appDataManager.getAnnouncements()) : [];
  const announcementManager = new AnnouncementManager(announcements);

  const mapCanvas = new MapCanvas();
  const mapState = new MapState(mapCanvas);
  const labelRenderer = new LabelRenderer(mapCanvas);
  await labelRenderer.initialize(allLabels);

  // Initialize immediately
  function initialize() {
    // Try to initialize the map canvas
    if (!mapCanvas.tryInitialize()) {
      console.log("No tile-based canvas found, retrying in 500ms");
      setTimeout(initialize, 500);
      return;
    }

    // Initialize map state tracking
    mapState.initialize();
    mapState.addChangeListener((c) => {
      if (c === 'zoomResolved') {
        // A zoom operation was in progress and so we suspended drawing overlays in response to redraws.
        // Now we must draw labels.
        drawAllLabels();
      }
    });

    window.addEventListener('wokemaps_canvasDrawImageCalled', onCanvasImageDrawn);
  }

  // Track tile rendering sequences
  let firstTileInSequence = null;
  let previousFirstTileInSequence = null;
  let sequenceInProgress = false;
  let sequenceMayHaveNewTransform = false;

  function getTileContentHash(ctx, transform, dx, dy, dw, dh) {
    let hash = 0x9e3779b9; // Golden ratio based seed

    // Only do 1 out of every `prime` pixels to do a "random" sampling of the tile,
    // to avoid doing too much work.
    const prime = 13; // Prime increment (must be < tileSize)

    // Get all pixel data at once. `getImageData` does not use context's
    // current transform.
    const topLeft = applyContextTransform(dx, dy, transform);
    const imageData = ctx.getImageData(topLeft.x, topLeft.y, dw, dh);
    const data = imageData.data; // RGBA array

    let x = 0;
    let y = 0;
    let samplesCount = 0;
    const maxSamples = Math.floor((dw * dh) / prime); // Rough estimate to avoid infinite loops

    while (y < dh && samplesCount < maxSamples) {
      // Calculate index in the RGBA array
      const pixelIndex = (y * dw + x) * 4; // 4 bytes per pixel (RGBA)

      if (pixelIndex + 3 < data.length) {
        const r = data[pixelIndex];
        const g = data[pixelIndex + 1];
        const b = data[pixelIndex + 2];
        const a = data[pixelIndex + 3];

        // Combine RGBA into hash using bit shifting and XOR
        hash ^= (r << 24) | (g << 16) | (b << 8) | a;
        // Rotate hash to avoid patterns
        hash = (hash << 1) | (hash >>> 31);
        samplesCount++;
      }

      // Increment by prime
      x += prime;

      // Wrap to next row if we exceed width
      if (x >= dw) {
        x -= dw;
        y += 1;
      }
    }
    return hash;
  }

  function recordTileInSequence(extent, transform) {
    if (firstTileInSequence === null) {
      // Only need record the first tile
      const {dx, dy, dw, dh} = extent;
      const hash = getTileContentHash(mapCanvas.context, transform, dx, dy, dw, dh);
      firstTileInSequence = hash >>> 0;
      console.log(`Maps is rendering tiles, first is ${firstTileInSequence.toString(16)}`);
      sequenceMayHaveNewTransform = firstTileInSequence !== previousFirstTileInSequence;
    }
  }

  function endTileSequence() {
    if (firstTileInSequence !== null) {
      previousFirstTileInSequence = firstTileInSequence;
      firstTileInSequence = null;
      // Don't reset `sequenceMayHaveNewTransform` as the labels come after the tiles / canvas
    }
  }

  /**
   * Respond to a canvas image being redrawn.
   *
   * @param e
   */
  function onCanvasImageDrawn(e) {
    if (!mapCanvas.context || !mapState.center || !labelRenderer.getPreRenderedLabels().length) return;
    const extent = e.detail.extent;
    const transform = e.detail.transform;
    const {dx, dy, dw, dh} = extent;
    let shouldDelay = false;
    const tileSize = mapCanvas.tileSize;

    // Image draw requests are typically for tiles (square), for labels (smaller), or
    // for the whole canvas.
    const isTile = dw === tileSize && dh === tileSize;
    // TODO: is there a better way, maybe just compare to "whole canvas" size?
    // don't want to break on small windows / assumptions
    const isCanvas = dw > tileSize * 2 && dh > tileSize * 2;

    if (isCanvas) {
      // Large canvas render - end current sequence, and no need to try to redraw anything.
      endTileSequence();
      return;
    }

    // Check if we should start a new sequence
    if (isTile && !sequenceInProgress) {
      // Make sure our transform info is up to date.
      mapState.updateCanvasTransform();
      mapState.updateParentTransform();
      recordTileInSequence(extent, transform);
    }

    if (mapState.isPotentiallyZooming) {
      // We have recently processed an interaction that could potentially zoom the view and our state will be
      // out of sync, causing us to render in the wrong place, leaving a visual artifact without recourse.
      // Instead of rendering, wait until zoom settles.
      return;
    }

    if (sequenceMayHaveNewTransform) {
      // We are getting a different first tile, which means the tileset has changed, we might have
      // panned or zoomed. But our transform may not have been updated, so just to be sure we delay
      // until the transform changes. This may cause flicker but it's much preferable to drawing
      // in the wrong place.
      shouldDelay = true;
    }

    if (shouldDelay) {
      setTimeout(() => renderOverlappingLabels(extent, transform), 1);
    } else {
      renderOverlappingLabels(extent, transform);
    }
  }

  function renderOverlappingLabels(extent, transform) {
    const {dx, dy, dw, dh} = extent;

    const tileSize = mapCanvas.tileSize;
    const isTile = dw === tileSize && dh === tileSize;

    const topLeft = applyContextTransform(dx, dy, transform);
    const bottomRight = applyContextTransform(dx + dw, dy + dh, transform);
    const imageCanvasBounds = {
      left: topLeft.x,
      right: bottomRight.x,
      top: topLeft.y,
      bottom: bottomRight.y,
    };

    if (debugOptions.highlightGrid && isTile) {
      const context = mapCanvas.context;
      context.save();
      context.resetTransform();
      context.strokeStyle = 'rgba(200, 255, 200, 100)';
      context.lineWidth = 3;
      context.strokeRect(topLeft.x, topLeft.y, dw, dh);
      context.restore();
    }

    // Filter labels by zoom level first
    const zoomFilteredLabels = labelRenderer.getPreRenderedLabels().filter(label =>
        mapState.zoom >= label.minZoom && mapState.zoom <= label.maxZoom
    );

    // Process each potentially visible label
    zoomFilteredLabels.forEach(label => {
      // Convert label's lat/lng to canvas pixel coordinates.
      // Requires `canvasTransform` to be up to date.
      const labelCanvasPos = latLngToCanvasPixel(label.lat, label.lng);
      if (!labelCanvasPos) return;

      // Calculate label bounds in canvas coordinates
      const labelCanvasBounds = {
        left: labelCanvasPos.x + (label.xOffset || 0) - label.width / 2,
        right: labelCanvasPos.x + (label.xOffset || 0) + label.width / 2,
        top: labelCanvasPos.y + (label.yOffset || 0) - label.height / 2,
        bottom: labelCanvasPos.y + (label.yOffset || 0) + label.height / 2
      };

      // Check for overlap and get overlap details
      const overlap = calculateImageLabelOverlap(
          imageCanvasBounds,
          labelCanvasBounds,
      );

      if (overlap) {
        // console.log("Drawing label overlap", imageCanvasBounds, labelCanvasBounds, overlap);
        drawLabelOverlap(label, overlap, transform);
      }
    });
  }

  // Convert lat/lng to canvas pixel coordinates using current map state
  function latLngToCanvasPixel(lat, lng) {
    if (!mapState.center) return null;
    const tileSize = mapCanvas.tileSize;

    // Get the projected pixel position for both the label and map center
    const labelPixel = labelRenderer.googleMapsLatLngToPoint(lat, lng, mapState.zoom, tileSize);
    const centerPixel = labelRenderer.googleMapsLatLngToPoint(mapState.center.lat, mapState.center.lng, mapState.zoom, tileSize);

    if (!labelPixel || !centerPixel) return null;

    // Calculate offset from center in projected coordinates
    const worldOffsetX = labelPixel.x - centerPixel.x;
    const worldOffsetY = labelPixel.y - centerPixel.y;

    // Convert to canvas coordinates using the same logic as drawLabel
    const canvasCenter = mapCanvas.getCenter();

    const parentDimensions = mapCanvas.getParentDimensions();
    const tileAlignmentX = -tileSize + (parentDimensions.width % (tileSize / 2));
    const tileAlignmentY = -tileSize + (parentDimensions.height % (tileSize / 2));

    const x = canvasCenter.x + worldOffsetX -
        (mapState.canvasTransform.translateX * mapCanvas.transformMultiplier) + tileAlignmentX;
    const y = canvasCenter.y + worldOffsetY -
        (mapState.canvasTransform.translateY * mapCanvas.transformMultiplier) + tileAlignmentY;

    return { x, y };
  }

  // Calculate overlap between label and tile bounds
  function calculateImageLabelOverlap(imageBounds, labelBounds) {
    // Check if rectangles overlap first
    if (labelBounds.right < imageBounds.left ||
        imageBounds.right < labelBounds.left ||
        labelBounds.bottom < imageBounds.top ||
        imageBounds.bottom < labelBounds.top) {
      return null; // No overlap
    }

    // Calculate intersection in canvas coordinates
    const canvasRegion = {
      left: Math.max(labelBounds.left, imageBounds.left),
      right: Math.min(labelBounds.right, imageBounds.right),
      top: Math.max(labelBounds.top, imageBounds.top),
      bottom: Math.min(labelBounds.bottom, imageBounds.bottom)
    };

    const labelRegion = {
      left: canvasRegion.left - labelBounds.left,
      right: canvasRegion.right - labelBounds.left,
      top: canvasRegion.top - labelBounds.top,
      bottom: canvasRegion.bottom - labelBounds.top,
    };

    return { canvasRegion, labelRegion };
  }

  // Draw label overlap directly to canvas coordinates
  function drawLabelOverlap(label, overlap, transform) {
    if (!labelRenderer.labelsCanvas || !mapCanvas.context) return;

    const { canvasRegion, labelRegion } = overlap;

    // Calculate source rectangle in the labels canvas (using label overlap coordinates)
    const srcX = label.canvasX + labelRegion.left;
    const srcY = label.canvasY + labelRegion.top;
    const srcW = labelRegion.right - labelRegion.left;
    const srcH = labelRegion.bottom - labelRegion.top;

    // Destination is the canvas area.
    const destX = canvasRegion.left;
    const destY = canvasRegion.top;
    const destW = canvasRegion.right - canvasRegion.left;
    const destH = canvasRegion.bottom - canvasRegion.top;

    // Draw the label portion
    try {
      const context = mapCanvas.context;
      context.save();
      // It is important we draw with no transform because the parameters we are passing are
      // relative to the origin of the canvas.
      context.resetTransform();
      context.drawImage(
          labelRenderer.labelsCanvas,
          srcX, srcY, srcW, srcH,
          destX, destY, destW, destH
      );
      context.restore();
    } catch (e) {
      console.error("Error drawing label overlap:", e);
    }
  }

  // Apply transform to convert canvas coordinates
  function applyContextTransform(x, y, transform) {
    const { a, b, c, d, e, f } = transform;
    return {
      x: a * x + c * y + e,
      y: b * x + d * y + f
    };
  }

  // Draw all labels on the canvas (fallback method)
  function drawAllLabels() {
    if (!mapCanvas.canvas || !mapCanvas.context || !mapState.center) return;

    const zoom = mapState.zoom;

    // Draw each label
    allLabels.forEach(label => {
      // Check if within this label's zoom range
      if (zoom >= label.minZoom && zoom <= label.maxZoom) {
        labelRenderer.drawLabelToCanvas(label, { center: mapState.center, zoom: mapState.zoom }, mapState.canvasTransform);
      }
    });
  }

  // Start the init process
  initialize();
})();
