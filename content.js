// Woke Maps
// Tries to respond to Google Maps rendering at certain locations, and overwrites with
// labels more desirable to the user.

console.log("Woke Map extension initialized (final implementation)");

(function() {

  // Track state
  let mapCanvas = null;
  let mapContext = null;
  let canvasParent = null;
  let lastCenter = null;
  let lastZoom = 0;
  let observer = null;
  let drawLabelsTimeout = null;

  // Transform tracking
  let canvasTransform = { translateX: 0, translateY: 0, scale: 1 };
  let parentTransform = { translateX: 0, translateY: 0, scale: 1 };

  // Parameters
  let tileSize = 256;
  let transformMultiplier = 1;
  let parentIsZero = false;

  // Load custom handwritten font
  let fontLoaded = false;
  function loadCustomFont() {
    const fontFace = new FontFace('Permanent Marker', 'url(https://fonts.gstatic.com/s/permanentmarker/v16/Fh4uPib9Iyv2ucM6pGQMWimMp004La2Cf5b6jlg.woff2)');
    fontFace.load().then(font => {
      document.fonts.add(font);
      fontLoaded = true;
      console.log("Custom font loaded successfully");
    }).catch(err => {
      console.error("Failed to load font:", err);
    });
  }
  loadCustomFont();

  // Initialize immediately
  function initialize() {
    // Detect retina display and set appropriate parameters
    detectDisplayType();

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

    // NO FALLBACK - only use tile-based canvas or retry
    if (mapRenderingCanvas) {
      mapCanvas = mapRenderingCanvas;
      mapContext = mapCanvas.getContext('2d');
      canvasParent = mapCanvas.parentElement;

      console.log(`Using canvas: ${mapCanvas.width}x${mapCanvas.height}`);
      console.log(`Display type: Tile size ${tileSize}px, Transform multiplier ${transformMultiplier}x`);

      // Get initial values
      updateCanvasTransform();
      updateParentTransform();
      updatePositionFromUrl();

      // Start observing and drawing
      setupObserver();
    } else {
      console.log("No tile-based canvas found, retrying in 500ms");
      setTimeout(initialize, 500);
    }
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
        //console.log(`Using grandparent dimensions: ${grandRect.width}×${grandRect.height}`);
        return { width: Math.round(grandRect.width), height: Math.round(grandRect.height) };
      }
    }

    console.error("Could not determine parent dimensions");
    return { width: 0, height: 0 };
  }

  function setupMapRedrawListener() {
    // TODO: this would need to be done via a background page and the `chrome.scripting` API
    // to run in the context of the web page.
    // Maybe for speed, this whole script gets injected into the page?
    const injectedScript = `
(function() {
  // Store the original drawImage function
  const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
  
  // Debounce variables
  let debounceTimeout = null;
  
  // Override the drawImage prototype
  CanvasRenderingContext2D.prototype.drawImage = function(...args) {
    // Call the original drawImage function first
    const result = originalDrawImage.apply(this, args);
    
    // Clear any existing timeout
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    
    // Set a new debounced timeout
    debounceTimeout = setTimeout(() => {
      // Send a custom event that the content script can listen for
      window.dispatchEvent(new CustomEvent('canvasDrawImageCalled', {
        detail: {
          timestamp: Date.now(),
        }
      }));
      
      // Reset the timeout variable
      debounceTimeout = null;
    }, 1);
    
    return result;
  };  
})();
`;

    // Create and inject the script element
    const script = document.createElement('script');
    script.textContent = injectedScript;
    script.onload = function() {
      // Remove the script element after execution to keep the DOM clean
      this.remove();
    };

    // Inject at the beginning of the document to ensure it runs before other scripts
    (document.head || document.documentElement).appendChild(script);

    // Listen for the custom event from the injected script
    window.addEventListener('canvasDrawImageCalled', function(event) {
      drawLabels();
    });

    console.log('Canvas drawImage override initialized');
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

    // Also listen for user interactions that likely change the map
    mapCanvas.addEventListener('mousemove', handleMapRedraw);
    document.addEventListener('mouseup', handleMapInteraction);
    document.addEventListener('wheel', handleMapInteraction);
    window.addEventListener('resize', handleMapInteraction);

    // Watch for URL changes (only update center when parent transform is zero)
    setupUrlChangeDetection();

    // Draw initial labels
    setTimeout(() => {
      updateCanvasTransform();
      updateParentTransform();
      drawLabels();
    }, 500);

    console.log("MutationObserver and event listeners set up");
  }

  // Handle DOM mutations
  function handleMutations(mutations) {
    let shouldUpdateCanvasTransform = false;
    let shouldUpdateParentTransform = false;
    let shouldRedraw = false;

    for (const mutation of mutations) {
      // If the mutation involves style changes on canvas or parent
      if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
        if (mutation.target === mapCanvas) {
          shouldUpdateCanvasTransform = true;
          shouldRedraw = true;
        } else if (mutation.target === canvasParent) {
          shouldUpdateParentTransform = true;
          shouldRedraw = true;
        }
      }
    }

    if (shouldUpdateCanvasTransform) {
      updateCanvasTransform();
    }

    if (shouldUpdateParentTransform) {
      updateParentTransform();
    }

    if (shouldRedraw) {
      drawLabels();
    }
  }

  // Update canvas transform information
  function updateCanvasTransform() {
    if (!mapCanvas) return;

    const canvasStyle = window.getComputedStyle(mapCanvas);
    const canvasTransformStr = canvasStyle.transform || canvasStyle.webkitTransform;

    if (canvasTransformStr && canvasTransformStr !== 'none') {
      const transformValues = parseTransform(canvasTransformStr);
      if (transformValues) {
        canvasTransform = transformValues;
      }
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
        parentTransform = transformValues;
      }
    } else {
      parentTransform = { translateX: 0, translateY: 0, scale: 1 };
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

  // Handle map interactions (mouse, wheel, etc.)
  function handleMapInteraction() {
    // Update transforms and redraw after interaction
    setTimeout(() => {
      updateCanvasTransform();
      updateParentTransform();
      drawLabels();
    }, 50);
  }

  // Handle possible map redraws
  let mapRedrawTimeout = null;
  function handleMapRedraw() {
    if (!mapRedrawTimeout) {
      mapRedrawTimeout = setTimeout(() => {
        drawLabels();
        mapRedrawTimeout = null;
      }, 0);
    }
  }

  // Set up URL change detection (but only update center when parent is zero)
  function setupUrlChangeDetection() {
    let lastUrl = window.location.href;

    // Check periodically for URL changes
    const checkUrlInterval = setInterval(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;

        // Only update center from URL if parent transform is near zero
        if (parentIsZero) {
          console.log("Parent transform is zero - updating center from URL");
          updatePositionFromUrl();
        }

        drawLabels();
      }
    }, 500);
  }

  // Update position information from URL
  function updatePositionFromUrl() {
    // Only proceed if parent transform is zero or near zero
    if (!parentIsZero) {
      return;
    }

    const url = window.location.href;

    // Extract center coordinates
    const centerMatch = url.match(/@([-\d.]+),([-\d.]+)/);
    if (centerMatch && centerMatch.length >= 3) {
      const lat = parseFloat(centerMatch[1]);
      const lng = parseFloat(centerMatch[2]);

      if (!isNaN(lat) && !isNaN(lng)) {
        lastCenter = { lat, lng };
      }
    }

    // Extract zoom level
    const zoomMatch = url.match(/@[-\d.]+,[-\d.]+,(\d+\.?\d*)z/);
    if (zoomMatch && zoomMatch.length >= 2) {
      const zoom = parseFloat(zoomMatch[1]);
      if (!isNaN(zoom)) {
        lastZoom = Math.round(zoom);
      }
    }

    // If we couldn't get from URL, use defaults
    if (!lastCenter) {
      lastCenter = { lat: 25.334537, lng: -90.054921 }; // Default to Gulf of Mexico
    }

    if (!lastZoom) {
      lastZoom = 6;
    }
  }

  // Draw all labels on the canvas
  function drawLabels() {
    if (!mapCanvas || !mapContext || !lastCenter) return;

    const zoom = lastZoom;

    // Draw each label
    LABELS.forEach(label => {
      // Check if within this label's zoom range
      if (zoom >= label.minZoom && zoom <= label.maxZoom) {
        drawLabel(label.lat, label.lng, label.text, label.color, label.scale);
      }
    });
  }

  // Draw a single label
  function drawLabel(lat, lng, text, color, scale) {
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

    const x = canvasCenterX + worldOffsetX - (canvasTransform.translateX * transformMultiplier) + tileAlignmentX;
    const y = canvasCenterY + worldOffsetY - (canvasTransform.translateY * transformMultiplier) + tileAlignmentY;

    // Check if on screen (with margin)
    if (x < -100 || x > mapCanvas.width + 100 || y < -100 || y > mapCanvas.height + 100) {
      return;
    }

    // Draw the label with handwritten style
    mapContext.save();

    // Use custom font if loaded, otherwise fall back
    const fontSize = 24 * scale;
    if (fontLoaded) {
      mapContext.font = `bold ${fontSize}px "Permanent Marker", Arial, sans-serif`;
    } else {
      mapContext.font = `bold ${fontSize}px Arial, sans-serif`;
    }

    // Set alignment
    mapContext.textAlign = 'center';
    mapContext.textBaseline = 'middle';

    // Measure text
    const lines = text.split('\n');
    const textWidth = lines.reduce(
        (accumulator, line) => Math.max(accumulator, mapContext.measureText(line).width),
        0);
    const lineHeight = fontSize + 6;
    const textHeight = lineHeight * lines.length;
    const padding = 8;

    // Draw background with rounded corners effect
    //mapContext.fillStyle = 'rgba(255, 255, 255, 0.85)';
    mapContext.fillStyle = 'rgba(255, 255, 255, 0.85)';
    mapContext.fillRect(
        x - textWidth / 2 - padding,
        y - textHeight / 2 - padding,
        textWidth + padding * 2,
        textHeight + padding * 2
    );

    // // Add subtle border
    //mapContext.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    mapContext.strokeStyle = 'rgba(0, 0, 0, 0)';
    mapContext.lineWidth = 1;
    mapContext.strokeRect(
        x - textWidth / 2 - padding,
        y - textHeight / 2 - padding,
        textWidth + padding * 2,
        textHeight + padding * 2
    );

    // Apply slight rotation for handwritten effect
    mapContext.translate(x, y);
    mapContext.rotate(-1.5 * Math.PI / 180); // -1.5 degrees

    // Draw text with shadow
    // mapContext.fillStyle = 'rgba(0, 0, 0, 0.1)';
    // mapContext.fillText(text, 1, 1); // Shadow

    mapContext.fillStyle = color;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      mapContext.fillText(line, 0, (i - (lines.length - 1) / 2.0) * lineHeight); // Main text
    }

    mapContext.restore();
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
  // TODO: setupMapRedrawListener(); // modifies page JS env, only ever do once

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
