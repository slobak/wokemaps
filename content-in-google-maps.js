(function() {
    let mapCanvasInfo = null;

    // Override getContext to detect the main map rendering canvas
    const originalGetContext = HTMLCanvasElement.prototype.getContext;

    HTMLCanvasElement.prototype.getContext = function(contextType, ...args) {
        const context = originalGetContext.call(this, contextType, ...args);
        if (context) {
            const found = checkForMapCanvas(this, contextType, context);
            if (found) {
                // Stop overriding.
                HTMLCanvasElement.prototype.getContext = originalGetContext;
            }
        }
        return context;
    };

    // Check if this canvas is the map canvas
    function checkForMapCanvas(canvas, contextType, context) {
        const width = canvas.width;
        const height = canvas.height;

        if (!document.contains(canvas)) {
            // Canvas is not in DOM, not the one.
            return false;
        }

        // WebGL canvas is typically 300x150 initially
        if ((contextType === 'webgl' || contextType === 'webgl2') && width === 300 && height === 150) {
            selectMapCanvas(canvas, contextType, context);
            return true;
        }

        // 2D canvas should be tile-based (multiples of 256) and reasonably large
        if (contextType === '2d' &&
            width > 0 && height > 0 &&
            width % 256 === 0 && height % 256 === 0 &&
            width * height > 100000) {
            selectMapCanvas(canvas, contextType, context);
            return true;
        }

        return false;
    }

    // Select this canvas as the map canvas
    function selectMapCanvas(canvas, contextType, context) {
        // Generate canvas ID for tracking
        const canvasId = generateCanvasId(canvas);

        mapCanvasInfo = {
            canvasId: canvasId,
            canvas: canvas,
            contextType: contextType,
            context: context,
            width: canvas.width,
            height: canvas.height
        };

        // Mark the canvas
        canvas.setAttribute('data-wokemaps-map-canvas', contextType);

        console.log(`wokemaps: Selected map canvas: ${canvas.width}x${canvas.height}, ${contextType}`);

        // Communicate to isolated script
        communicateMapCanvasInfo();
    }

    // Generate a unique ID for canvas tracking
    function generateCanvasId(canvas) {
        if (!canvas.dataset.wokemapsCanvasId) {
            canvas.dataset.wokemapsCanvasId = 'wokemaps_canvas_' + Math.random().toString(36).substr(2, 9);
        }
        return canvas.dataset.wokemapsCanvasId;
    }

    // Communicate map canvas info to isolated script
    function communicateMapCanvasInfo() {
        if (!mapCanvasInfo) return;

        window.postMessage({
            type: 'WOKEMAPS_MAP_CANVAS_DETECTED',
            canvasId: mapCanvasInfo.canvasId,
            contextType: mapCanvasInfo.contextType,
            width: mapCanvasInfo.width,
            height: mapCanvasInfo.height,
            isTileBased: mapCanvasInfo.width % 256 === 0 && mapCanvasInfo.height % 256 === 0,
            supported: mapCanvasInfo.contextType === '2d' // Only 2D is supported for now
        }, '*');
    }

    // Override the drawImage prototype (for 2D contexts only)
    const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(...args) {
        // Call the original drawImage function first
        originalDrawImage.apply(this, args);

        // Only track draw calls on the map canvas
        if (mapCanvasInfo && this.canvas === mapCanvasInfo.canvas && mapCanvasInfo.contextType === '2d') {
            // Send a custom event that the content script can listen for
            const transform = this.getTransform();
            let dx, dy, dw, dh;
            if (args.length === 3) {
                // drawImage(image, dx, dy)
                dx = args[1];
                dy = args[2];
                dw = args[0].width;
                dh = args[0].height;
            } else if (args.length === 5) {
                // drawImage(image, dx, dy, dw, dh)
                dx = args[1];
                dy = args[2];
                dw = args[3];
                dh = args[4];
            } else if (args.length === 9) {
                // drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
                dx = args[5];
                dy = args[6];
                dw = args[7];
                dh = args[8];
            }

            window.dispatchEvent(new CustomEvent('wokemaps_canvasDrawImageCalled', {
                detail: {
                    timestamp: Date.now(),
                    canvasId: mapCanvasInfo.canvasId,
                    extent: { dx, dy, dw, dh },
                    transform: {
                        a: transform.a,
                        b: transform.b,
                        c: transform.c,
                        d: transform.d,
                        e: transform.e,
                        f: transform.f
                    },
                    canvas: {
                        width: this.canvas.width,
                        height: this.canvas.height
                    }
                }
            }));
        }
    };

    // History API overrides (unchanged)
    const originalPushState = history.pushState;
    history.pushState = function(...args) {
        originalPushState.apply(history, args);
        window.dispatchEvent(new CustomEvent('wokemaps_urlChanged', {
            detail: {
                url: window.location.href
            }
        }));
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
        originalReplaceState.apply(history, args);
        window.dispatchEvent(new CustomEvent('wokemaps_urlChanged', {
            detail: {
                url: window.location.href
            }
        }));
    };

    // Interaction tracking (unchanged)
    function handleMouseUp(e) {
        const target = e.target;
        const zoomInButton = document.getElementById('widget-zoom-in');
        const zoomOutButton = document.getElementById('widget-zoom-out');
        if (target === zoomInButton || zoomInButton.contains(target) ||
            target === zoomOutButton || zoomOutButton.contains(target)) {
            handlePotentialZoomInteraction(e);
        }
    }

    function handleKeyDown(e) {
        const key = e.key;
        if (key === '-' || key === '+' || key === '=') {
            handlePotentialZoomInteraction(e);
        }
    }

    function handlePotentialZoomInteraction() {
        window.dispatchEvent(new CustomEvent('wokemaps_potentialZoomInteraction', {}));
    }

    window.addEventListener('mouseup', handleMouseUp, { capture: true, passive: true });
    window.addEventListener('wheel', handlePotentialZoomInteraction, { capture: true, passive: true });
    window.addEventListener('keydown', handleKeyDown, { capture: true, passive: true });

    console.log('wokemaps: simplified canvas detection initialized');
})();
