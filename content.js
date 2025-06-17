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
  const LABEL_VERSION = 1;  // TODO: switch to "config version"
  const HIGHLIGHT_GRID = debugOptions.highlightGrid || false;
  const DEBUG_ONE_LABEL = debugOptions.debugOneLabel || false;
  const USE_LABEL_REMOTE = debugOptions.enableRemoteConfig !== false; // Default to true
  const USE_LABEL_CACHE = debugOptions.enableRemoteConfigCache !== false;
  const LOG_LEVEL = debugOptions.logLevel || 0;

  // Enhanced logging function
  function log(level, ...args) {
    if (level <= LOG_LEVEL) {
      console.log("wokemaps:", ...args);
    }
  }

  // Track state
  let mapCanvas = null;
  let mapContext = null;
  let canvasParent = null;
  let lastCenter = null;
  let lastZoom = 0;
  let observer = null;
  let zoomInteractionTimeout = null;
  let isPotentiallyZooming = false;

  // Transform tracking
  let canvasTransform = { translateX: 0, translateY: 0, scale: 1 };
  let parentTransform = { translateX: 0, translateY: 0, scale: 1 };

  // Parameters
  let tileSize = 256;
  let transformMultiplier = 1;
  let parentIsZero = false;

  // Pre-rendered labels system
  let labelsCanvas = null;
  let labelsContext = null;
  let preRenderedLabels = [];
  let fontLoaded = false;

  // Load custom handwritten font
  function loadCustomFont() {
    const fontFace = new FontFace('Permanent Marker', 'url(https://fonts.gstatic.com/s/permanentmarker/v16/Fh4uPib9Iyv2ucM6pGQMWimMp004La2Cf5b6jlg.woff2)');
    fontFace.load().then(font => {
      document.fonts.add(font);
      fontLoaded = true;
      console.log("Custom font loaded successfully");
      // Re-render labels with proper font
      initializeLabelsCanvas();
    }).catch(err => {
      console.error("Failed to load font:", err);
      // Initialize with fallback font
      initializeLabelsCanvas();
    });
  }


  // Load app data
  const appDataManager = new AppDataManager(optionsManager);
  const LABELS = await appDataManager.getLabels();

  if (await optionsManager.getOption('enableAnnouncements', true)) {
    const announcements = await appDataManager.getAnnouncements();
    window.wokemapsAnnouncements.initialize(announcements);
  }

  loadCustomFont();

  // Draw a label at the specified position and return its dimensions
  function drawLabelAtPosition(context, x, y, text, color, background, scale, rotation = -1.5) {
    context.save();
    const fontSize = 24 * scale;

    // Set font
    if (fontLoaded) {
      context.font = `bold ${fontSize}px "Permanent Marker", Arial, sans-serif`;
    } else {
      context.font = `bold ${fontSize}px Arial, sans-serif`;
    }

    context.textAlign = 'center';
    context.textBaseline = 'middle';

    // Measure text
    const lines = text.split('\n');
    const textWidth = lines.reduce(
        (accumulator, line) => Math.max(accumulator, context.measureText(line).width),
        0
    );
    const lineHeight = fontSize + 6;
    const textHeight = lineHeight * lines.length;
    const padding = 8;

    const totalWidth = textWidth + padding * 2;
    const totalHeight = textHeight + padding * 2;

    // Draw background
    context.fillStyle = background;
    context.fillRect(
        x - totalWidth / 2,
        y - totalHeight / 2,
        totalWidth,
        totalHeight
    );

    // Draw border
    // context.strokeStyle = 'rgba(0, 0, 0, 0)';
    // context.lineWidth = 1;
    // context.strokeRect(
    //     x - totalWidth / 2,
    //     y - totalHeight / 2,
    //     totalWidth,
    //     totalHeight
    // );

    // Draw text with rotation
    context.translate(x, y);
    context.rotate(rotation * Math.PI / 180);

    context.fillStyle = color;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      context.fillText(line, 0, (i - (lines.length - 1) / 2.0) * lineHeight);
    }

    context.restore();
    return { width: totalWidth, height: totalHeight };
  }

  // Initialize the offscreen labels canvas
  function initializeLabelsCanvas() {
    // Create a large offscreen canvas for pre-rendered labels
    labelsCanvas = document.createElement('canvas');
    labelsCanvas.width = 512;
    labelsCanvas.height = 2048;
    labelsContext = labelsCanvas.getContext('2d');

    // Clear previous labels
    preRenderedLabels = [];
    labelsContext.clearRect(0, 0, labelsCanvas.width, labelsCanvas.height);

    let currentY = 50;
    const spacing = 10;

    // Pre-render each label
    LABELS.forEach((label, index) => {
      if (DEBUG_ONE_LABEL && index > 0) return;
      const renderedLabel = preRenderLabel(label, currentY);
      if (renderedLabel) {
        preRenderedLabels.push({
          ...label,
          ...renderedLabel,
          index
        });
        currentY += renderedLabel.height + spacing;
      }
    });

    console.log(`Pre-rendered ${preRenderedLabels.length} labels`);
  }

  // Pre-render a single label to the offscreen canvas
  function preRenderLabel(label, startY) {
    const scale = label.scale || 1;
    const color = label.color || "#000066";
    const background = label.backgroundType === 'rect' ? '#ffffffb3' : '#00000000';
    const rotation = label.rotation || -1.5;
    const centerX = labelsCanvas.width / 2;
    const centerY = startY + 100; // Estimate center, will be adjusted

    // Draw the label and get its dimensions
    const dimensions = drawLabelAtPosition(
        labelsContext,
        centerX,
        centerY,
        label.text,
        color,
        background,
        scale,
        rotation
    );

    // Check if we have enough space
    if (startY + dimensions.height > labelsCanvas.height) {
      console.warn(`Not enough space for label: ${label.text}`);
      return null;
    }

    // Adjust the actual center Y position
    const actualCenterY = startY + dimensions.height / 2;

    // Clear and redraw at the correct position
    labelsContext.clearRect(
        centerX - dimensions.width / 2 - 10,
        centerY - dimensions.height / 2 - 10,
        dimensions.width + 20,
        dimensions.height + 20
    );

    drawLabelAtPosition(
        labelsContext,
        centerX,
        actualCenterY,
        label.text,
        color,
        background,
        scale,
        rotation
    );

    return {
      canvasX: centerX - dimensions.width / 2,
      canvasY: actualCenterY - dimensions.height / 2,
      width: dimensions.width,
      height: dimensions.height
    };
  }

  function findMapRenderingCanvas() {
    // Find ONLY the map rendering canvas that's tile-based
    const canvases = document.querySelectorAll('canvas');
    let mapRenderingCanvas = null;
    let maxArea = 0;

    console.log(`Found ${canvases.length} canvas elements`);

    for (let canvas of canvases) {
      const width = canvas.width;
      const height = canvas.height;
      const area = width * height;

      console.log(`Canvas: ${width}x${height}, area: ${area}, tile-based: ${width % 256 === 0 && height % 256 === 0}`);

      // ONLY accept canvases where both dimensions are multiples of 256 (tile-based rendering)
      // and it's large enough to be the main map
      if (width > 0 && height > 0 &&
          width % 256 === 0 && height % 256 === 0 &&
          area > maxArea && area > 100000) { // Minimum size check
        try {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            mapRenderingCanvas = canvas;
            maxArea = area;
            console.log(`Selected tile-based canvas: ${width}x${height}`);
          }
        } catch (e) {
          console.log("Error accessing canvas:", e);
        }
      }
    }
    return mapRenderingCanvas;
  }

  // Initialize immediately
  function initialize() {
    // Detect retina display and set appropriate parameters
    detectDisplayType();

    // Try to find the map rendering canvas. If we can't, try again after a short delay
    // in the hopes that further initialization yields the right canvas.
    const mapRenderingCanvas = findMapRenderingCanvas();
    if (!mapRenderingCanvas) {
      console.log("No tile-based canvas found, retrying in 500ms");
      setTimeout(initialize, 500);
      return;
    }

    mapCanvas = mapRenderingCanvas;
    mapContext = mapCanvas.getContext('2d', { willReadFrequently: true });
    canvasParent = mapCanvas.parentElement;

    console.log(`Using canvas: ${mapCanvas.width}x${mapCanvas.height}`);
    console.log(`Display type: Tile size ${tileSize}px, Transform multiplier ${transformMultiplier}x`);

    // Get initial values
    updateCanvasTransform();
    updateParentTransform();
    updatePositionFromUrl();

    // Start observing and drawing
    setupObserver();
  }

  // Detect display type (retina vs standard) and set parameters
  function detectDisplayType() {
    const devicePixelRatio = window.devicePixelRatio || 1;

    if (devicePixelRatio > 1.5) {
      tileSize = 512;
      transformMultiplier = 2;
      console.log(`Detected retina display (pixel ratio: ${devicePixelRatio})`);
    } else {
      tileSize = 256;
      transformMultiplier = 1;
      console.log(`Detected standard display (pixel ratio: ${devicePixelRatio})`);
    }
  }

  // Get parent div dimensions properly
  function getParentDimensions() {
    if (!canvasParent) {
      console.error("No canvas parent found");
      return { width: 0, height: 0 };
    }

    // Method 1: Try getBoundingClientRect first
    const rect = canvasParent.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      console.log(`Parent dimensions from getBoundingClientRect: ${rect.width}×${rect.height}`);
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    }

    // Method 2: Try offsetWidth/Height
    if (canvasParent.offsetWidth > 0 && canvasParent.offsetHeight > 0) {
      console.log(`Parent dimensions from offset: ${canvasParent.offsetWidth}×${canvasParent.offsetHeight}`);
      return { width: canvasParent.offsetWidth, height: canvasParent.offsetHeight };
    }

    // Method 3: Try clientWidth/Height
    if (canvasParent.clientWidth > 0 && canvasParent.clientHeight > 0) {
      console.log(`Parent dimensions from client: ${canvasParent.clientWidth}×${canvasParent.clientHeight}`);
      return { width: canvasParent.clientWidth, height: canvasParent.clientHeight };
    }

    // Method 4: Get computed style
    const computedStyle = window.getComputedStyle(canvasParent);
    const width = parseInt(computedStyle.width, 10);
    const height = parseInt(computedStyle.height, 10);

    if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
      console.log(`Parent dimensions from computed style: ${width}×${height}`);
      return { width, height };
    }

    // If all else fails, check the grandparent (sometimes the map container is nested)
    const grandParent = canvasParent.parentElement;
    if (grandParent) {
      const grandRect = grandParent.getBoundingClientRect();
      if (grandRect.width > 0 && grandRect.height > 0) {
        return { width: Math.round(grandRect.width), height: Math.round(grandRect.height) };
      }
    }

    console.error("Could not determine parent dimensions");
    return { width: 0, height: 0 };
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
      const hash = getTileContentHash(mapContext, transform, dx, dy, dw, dh);
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
    if (!mapContext || !lastCenter || !preRenderedLabels.length) return;
    const extent = e.detail.extent;
    const transform = e.detail.transform;
    const {dx, dy, dw, dh} = extent;
    let shouldDelay = false;

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
      mapContext.save();
      mapContext.resetTransform();
      mapContext.strokeStyle = 'rgba(200, 255, 200, 100)';
      mapContext.lineWidth = 3;
      mapContext.strokeRect(topLeft.x, topLeft.y, dw, dh);
      mapContext.restore();
    }

    // Filter labels by zoom level first
    const zoomFilteredLabels = preRenderedLabels.filter(label =>
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

    // Get the projected pixel position for both the label and map center
    const labelPixel = googleMapsLatLngToPoint(lat, lng, lastZoom, tileSize);
    const centerPixel = googleMapsLatLngToPoint(lastCenter.lat, lastCenter.lng, lastZoom, tileSize);

    if (!labelPixel || !centerPixel) return null;

    // Calculate offset from center in projected coordinates
    const worldOffsetX = labelPixel.x - centerPixel.x;
    const worldOffsetY = labelPixel.y - centerPixel.y;

    // Convert to canvas coordinates using the same logic as drawLabel
    const canvasCenterX = mapCanvas.width / 2;
    const canvasCenterY = mapCanvas.height / 2;

    const parentDimensions = getParentDimensions();
    const tileAlignmentX = -tileSize + (parentDimensions.width % (tileSize / 2));
    const tileAlignmentY = -tileSize + (parentDimensions.height % (tileSize / 2));

    const x = canvasCenterX + worldOffsetX - (canvasTransform.translateX * transformMultiplier) + tileAlignmentX;
    const y = canvasCenterY + worldOffsetY - (canvasTransform.translateY * transformMultiplier) + tileAlignmentY;

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
    if (!labelsCanvas || !mapContext) return;

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
      mapContext.save();
      // It is important we draw with no transform because the parameters we are passing are
      // relative to the origin of the canvas.
      mapContext.resetTransform();
      mapContext.drawImage(
          labelsCanvas,
          srcX, srcY, srcW, srcH,
          destX, destY, destW, destH
      );
      mapContext.restore();
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
    observer.observe(mapCanvas, {
      attributes: true,
      attributeFilter: ['style', 'width', 'height']
    });

    // Observe the canvas parent for transform changes
    if (canvasParent) {
      observer.observe(canvasParent, {
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
        if (mutation.target === mapCanvas) {
          shouldUpdateCanvasTransform = true;
        } else if (mutation.target === canvasParent) {
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
    if (!mapCanvas) return;

    const canvasStyle = window.getComputedStyle(mapCanvas);
    const canvasTransformStr = canvasStyle.transform || canvasStyle.webkitTransform;

    if (canvasTransformStr && canvasTransformStr !== 'none') {
      const transformValues = parseTransform(canvasTransformStr);
      logTransformIfDifferent("canvas", transformValues, canvasTransform);
      canvasTransform = transformValues;
    }
  }

  // Update parent transform information
  function updateParentTransform() {
    if (!canvasParent) return;

    const parentStyle = window.getComputedStyle(canvasParent);
    const parentTransformStr = parentStyle.transform || parentStyle.webkitTransform;

    if (parentTransformStr && parentTransformStr !== 'none') {
      const transformValues = parseTransform(parentTransformStr);
      if (transformValues) {
        //logTransformIfDifferent("parent", transformValues, parentTransform);
        parentTransform = transformValues;
      }
    } else {
      const transformValues = { translateX: 0, translateY: 0, scale: 1 };
      //logTransformIfDifferent("parent", transformValues, parentTransform);
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
    if (!mapCanvas || !mapContext || !lastCenter) return;

    const zoom = lastZoom;

    // Draw each label
    LABELS.forEach(label => {
      // Check if within this label's zoom range
      if (zoom >= label.minZoom && zoom <= label.maxZoom) {
        drawLabel(label);
      }
    });
  }

  // Draw a single label (fallback method)
  function drawLabel(label) {
    // TODO: normalize all data on load so default values applied once
    const { lat, lng, text } = label;
    const color = label.color || "#000066";
    const scale = label.scale || 1.0;
    const labelOffsetX = label.xOffset || 0;
    const labelOffsetY = label.yOffset || 0;
    const background = label.backgroundType === 'rect' ? '#ffffffb3' : '#00000000';

    // Calculate the pixel position using the Mercator projection
    const labelPixel = googleMapsLatLngToPoint(lat, lng, lastZoom, tileSize);
    const centerPixel = googleMapsLatLngToPoint(lastCenter.lat, lastCenter.lng, lastZoom, tileSize);

    if (!labelPixel || !centerPixel) return;

    // Calculate base offset from center (world coordinates)
    const worldOffsetX = labelPixel.x - centerPixel.x;
    const worldOffsetY = labelPixel.y - centerPixel.y;

    // Calculate canvas center (in canvas pixels)
    const canvasCenterX = mapCanvas.width / 2;
    const canvasCenterY = mapCanvas.height / 2;

    // Apply the correct formula: SUBTRACT transform with retina multiplier
    // All calculations are in canvas pixel coordinates

    // Get parent dimensions for the tile alignment calculation
    const parentDimensions = getParentDimensions();

    // Calculate the tile alignment offset based on parent size
    // X is affected by width, Y by height
    const tileAlignmentX = -tileSize + (parentDimensions.width % (tileSize / 2));
    const tileAlignmentY = -tileSize + (parentDimensions.height % (tileSize / 2));

    // This is the "center point" of the label.
    const x = canvasCenterX + worldOffsetX + labelOffsetX - (canvasTransform.translateX * transformMultiplier) + tileAlignmentX;
    const y = canvasCenterY + worldOffsetY + labelOffsetY - (canvasTransform.translateY * transformMultiplier) + tileAlignmentY;

    // Check if on screen (with margin)
    //TODO: this necessary?
    if (x < -100 || x > mapCanvas.width + 100 || y < -100 || y > mapCanvas.height + 100) {
      return;
    }

    // Use the shared label drawing function
    drawLabelAtPosition(mapContext, x, y, text, color, background, scale, -1.5);
  }

  // Accurate Google Maps style projection with tile size parameter
  function googleMapsLatLngToPoint(lat, lng, zoom, tileSize) {
    try {
      // First, we need the normalized coordinates between 0 and 1
      const normX = (lng + 180) / 360;

      // Convert latitude to radians for sin calculation
      const latRad = lat * Math.PI / 180;

      // Apply the Mercator projection formula
      const mercN = Math.log(Math.tan((Math.PI / 4) + (latRad / 2)));
      const normY = 0.5 - mercN / (2 * Math.PI);

      // Scale by the world size at this zoom level
      const scale = Math.pow(2, zoom);
      const worldSize = scale * tileSize;

      // Convert to pixel coordinates
      const pixelX = Math.floor(normX * worldSize);
      const pixelY = Math.floor(normY * worldSize);

      return { x: pixelX, y: pixelY };
    } catch (e) {
      console.error("Error in googleMapsLatLngToPoint:", e);
      return null;
    }
  }

  // Start the process
  initialize();

  // Periodically check if we need to reinitialize
  setInterval(() => {
    if (!document.body.contains(mapCanvas) || !observer) {
      console.log("Canvas lost or observer disconnected, reinitializing");

      // Clean up old observer if it exists
      if (observer) {
        observer.disconnect();
        observer = null;
      }

      mapCanvas = null;
      mapContext = null;
      canvasParent = null;
      initialize();
    }
  }, 5000);
})();
