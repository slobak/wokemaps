// Woke Maps
// Tries to respond to Google Maps rendering at certain locations, and overwrites with
// labels more desirable to the user.

console.log("wokemaps: extension initializing");

(async function() {

  // Initialize options manager
  const optionsManager = new OptionsManager();
  const options = await optionsManager.getOptions();
  const debugOptions = options.debug || {};

  // Use options instead of constants
  const HIGHLIGHT_GRID = debugOptions.highlightGrid || false;
  const DEBUG_ONE_LABEL = debugOptions.debugOneLabel || false;
  const LOG_LEVEL = debugOptions.logLevel || 0;

  // Enhanced logging function
  function log(level, ...args) {
    if (level <= LOG_LEVEL) {
      console.log("wokemaps:", ...args);
    }
  }

  // Track state
  let lastCenter = null;
  let lastZoom = 0;
  let observer = null;
  let zoomInteractionTimeout = null;
  let isPotentiallyZooming = false;

  // Transform tracking
  let canvasTransform = { translateX: 0, translateY: 0, scale: 1 };
  let parentTransform = { translateX: 0, translateY: 0, scale: 1 };
  let parentIsZero = false;

  // Load app data
  const appDataManager = new AppDataManager(optionsManager);
  const LABELS = await appDataManager.getLabels();

  if (await optionsManager.getOption('enableAnnouncements', true)) {
    const announcements = await appDataManager.getAnnouncements();
    window.announcementManager = new AnnouncementManager(announcements);
    // Runs on its own.
  }

  const mapCanvas = new MapCanvas();
  const labelRenderer = new LabelRenderer(mapCanvas);
  await labelRenderer.initialize(LABELS);

  // Initialize immediately
  function initialize() {
    // Try to initialize the map canvas
    if (!mapCanvas.tryInitialize()) {
      console.log("No tile-based canvas found, retrying in 500ms");
      setTimeout(initialize, 500);
      return;
    }

    // Get initial values
    updateCanvasTransform();
    updateParentTransform();
    updatePositionFromUrl();

    // Start observing and drawing
    setupObserver();
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
    if (!mapCanvas.context || !lastCenter || !labelRenderer.getPreRenderedLabels().length) return;
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
      updateCanvasTransform();
      updateParentTransform();
      recordTileInSequence(extent, transform);
    }

    if (isPotentiallyZooming) {
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

    if (HIGHLIGHT_GRID && isTile) {
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
        lastZoom >= label.minZoom && lastZoom <= label.maxZoom
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
    if (!lastCenter) return null;
    const tileSize = mapCanvas.tileSize;

    // Get the projected pixel position for both the label and map center
    const labelPixel = labelRenderer.googleMapsLatLngToPoint(lat, lng, lastZoom, tileSize);
    const centerPixel = labelRenderer.googleMapsLatLngToPoint(lastCenter.lat, lastCenter.lng, lastZoom, tileSize);

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
        (canvasTransform.translateX * mapCanvas.transformMultiplier) + tileAlignmentX;
    const y = canvasCenter.y + worldOffsetY -
        (canvasTransform.translateY * mapCanvas.transformMultiplier) + tileAlignmentY;

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

  function setupMapsHooks() {
    window.addEventListener('wokemaps_canvasDrawImageCalled', onCanvasImageDrawn);
    window.addEventListener('wokemaps_urlChanged', onMapsUrlChanged);
    window.addEventListener('wokemaps_potentialZoomInteraction', handlePotentialZoomInteraction);
    console.log('wokemaps: hook listeners initialized');
  }

  function onMapsUrlChanged(e) {
    if (parentIsZero) {
      console.log("onMapsUrlChanged: Parent transform is zero - updating center from URL");
      updatePositionFromUrl();
      if (zoomInteractionTimeout !== null) {
        console.log("zoom resolved, redrawing")
        clearTimeout(zoomInteractionTimeout);
        zoomInteractionTimeout = null;
        isPotentiallyZooming = false;
        updateCanvasTransform();
        updateParentTransform();
        drawAllLabels();
      }
    }
  }

  // Set up MutationObserver to watch for map changes
  function setupObserver() {
    // Set up the observer to watch for DOM changes
    observer = new MutationObserver(handleMutations);

    // Observe the canvas for attribute changes
    observer.observe(mapCanvas.canvas, {
      attributes: true,
      attributeFilter: ['style', 'width', 'height']
    });

    // Observe the canvas parent for transform changes
    if (mapCanvas.parent) {
      observer.observe(mapCanvas.parent, {
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    }

    // Watch for when map tiles are redrawn
    setupMapsHooks();

    console.log("MutationObserver and event listeners set up");
  }


  // Handle DOM mutations
  function handleMutations(mutations) {
    let shouldUpdateCanvasTransform = false;
    let shouldUpdateParentTransform = false;

    for (const mutation of mutations) {
      // If the mutation involves style changes on canvas or parent
      if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
        if (mutation.target === mapCanvas.canvas) {
          shouldUpdateCanvasTransform = true;
        } else if (mutation.target === mapCanvas.parent) {
          shouldUpdateParentTransform = true;
        }
      }
    }

    if (shouldUpdateCanvasTransform) {
      updateCanvasTransform();
    }

    if (shouldUpdateParentTransform) {
      updateParentTransform();
    }
  }

  // Update canvas transform information
  function updateCanvasTransform() {
    if (!mapCanvas.canvas) return;

    const canvasStyle = window.getComputedStyle(mapCanvas.canvas);
    const canvasTransformStr = canvasStyle.transform || canvasStyle.webkitTransform;

    if (canvasTransformStr && canvasTransformStr !== 'none') {
      const transformValues = parseTransform(canvasTransformStr);
      logTransformIfDifferent("canvas", transformValues, canvasTransform);
      canvasTransform = transformValues;
    }
  }

  // Update parent transform information
  function updateParentTransform() {
    if (!mapCanvas.parent) return;

    const parentStyle = window.getComputedStyle(mapCanvas.parent);
    const parentTransformStr = parentStyle.transform || parentStyle.webkitTransform;

    if (parentTransformStr && parentTransformStr !== 'none') {
      const transformValues = parseTransform(parentTransformStr);
      if (transformValues) {
        //logTransformIfDifferent("parent", transformValues, parentTransform);
        parentTransform = transformValues;
      }
    } else {
      const transformValues = { translateX: 0, translateY: 0, scale: 1 };
      logTransformIfDifferent("parent", transformValues, parentTransform);
      parentTransform = transformValues;
    }

    // Check if parent transform is zero
    const wasZero = parentIsZero;
    parentIsZero = Math.abs(parentTransform.translateX) < 1 && Math.abs(parentTransform.translateY) < 1;

    // If parent just went to zero, update the center from URL
    if (!wasZero && parentIsZero) {
      console.log("Parent transform went to zero - updating center from URL");
      updatePositionFromUrl();
    }
  }

  function logTransformIfDifferent(name, newTransform, oldTransform) {
    if (newTransform.translateX !== oldTransform.translateX ||
        newTransform.translateY !== oldTransform.translateY ||
        newTransform.scale !== oldTransform.scale) {
      console.log(`${name} transform changes`, newTransform);
    }
  }

  // Parse a transform string into component values
  function parseTransform(transformStr) {
    try {
      // Handle matrix format: matrix(a, b, c, d, tx, ty)
      if (transformStr.startsWith('matrix')) {
        const matrixMatch = transformStr.match(/matrix\(([^)]+)\)/);
        if (matrixMatch && matrixMatch[1]) {
          const values = matrixMatch[1].split(',').map(v => parseFloat(v.trim()));
          if (values.length === 6) {
            const translateX = values[4];
            const translateY = values[5];
            const scale = Math.sqrt(values[0] * values[0] + values[1] * values[1]);

            return { translateX, translateY, scale };
          }
        }
      }

      // Handle translate and scale separately
      let translateX = 0;
      let translateY = 0;
      let scale = 1;

      // Extract translate values
      const translateMatch = transformStr.match(/translate\(([^)]+)\)/);
      if (translateMatch && translateMatch[1]) {
        const values = translateMatch[1].split(',').map(v => parseFloat(v.trim()));
        if (values.length >= 1) translateX = values[0];
        if (values.length >= 2) translateY = values[1];
      }

      // Extract translateX/Y values
      const translateXMatch = transformStr.match(/translateX\(([^)]+)\)/);
      if (translateXMatch && translateXMatch[1]) {
        translateX = parseFloat(translateXMatch[1]);
      }

      const translateYMatch = transformStr.match(/translateY\(([^)]+)\)/);
      if (translateYMatch && translateYMatch[1]) {
        translateY = parseFloat(translateYMatch[1]);
      }

      // Extract scale value
      const scaleMatch = transformStr.match(/scale\(([^)]+)\)/);
      if (scaleMatch && scaleMatch[1]) {
        scale = parseFloat(scaleMatch[1]);
      }

      return { translateX, translateY, scale };
    } catch (e) {
      console.error("Error parsing transform:", e);
      return { translateX: 0, translateY: 0, scale: 1 };
    }
  }

  // Handle map interactions that might result in a zoom (button click, wheel, etc.)
  function handlePotentialZoomInteraction() {
    // Suspend redrawing - zoom may be changing and we could draw in the wrong place.
    // Better to disappear/flicker for a bit.
    isPotentiallyZooming = true;
    console.log("potential zoom interaction, suspending redraw");

    // Update transforms
    if (zoomInteractionTimeout) {
      clearTimeout(zoomInteractionTimeout);
    }
    zoomInteractionTimeout = setTimeout(() => {
      console.log("zoom interaction timeout, redrawing");
      zoomInteractionTimeout = null;
      isPotentiallyZooming = false;
      updatePositionFromUrl();
      updateCanvasTransform();
      updateParentTransform();
      drawAllLabels();
    }, 1000);
  }

  // Update position information from URL
  function updatePositionFromUrl() {
    // Only proceed if parent transform is zero or near zero
    if (!parentIsZero) {
      return;
    }

    const url = window.location.href;

    // Extract center coordinates
    lastCenter = null;
    const centerMatch = url.match(/@([-\d.]+),([-\d.]+)/);
    if (centerMatch && centerMatch.length >= 3) {
      const lat = parseFloat(centerMatch[1]);
      const lng = parseFloat(centerMatch[2]);

      if (!isNaN(lat) && !isNaN(lng)) {
        lastCenter = { lat, lng };
      }
    }

    // Extract zoom level
    // TODO: fix for satellite mode
    lastZoom = null;
    const zoomMatch = url.match(/@[-\d.]+,[-\d.]+,(\d+\.?\d*)z/);
    if (zoomMatch && zoomMatch.length >= 2) {
      const zoom = parseFloat(zoomMatch[1]);
      if (!isNaN(zoom)) {
        lastZoom = Math.round(zoom);
      }
    }
  }

  // Draw all labels on the canvas (fallback method)
  function drawAllLabels() {
    if (!mapCanvas.canvas || !mapCanvas.context || !lastCenter) return;

    const zoom = lastZoom;

    // Draw each label
    LABELS.forEach(label => {
      // Check if within this label's zoom range
      if (zoom >= label.minZoom && zoom <= label.maxZoom) {
        labelRenderer.drawLabelToCanvas(label, { center: lastCenter, zoom: lastZoom }, canvasTransform);
      }
    });
  }

  // Start the init process
  initialize();
})();
