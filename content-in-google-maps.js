// Everything in an anonymous closure to minimize pollution of the global namespace.
(function() {
    let mapCanvasInfo = null;
    let overlayCanvas = null;

    // Tile movement tracking for WebGL
    const tileTracker = {
        urlBaseline: null,
        frameBaseline: null,
        totalMovement: { x: 0, y: 0 },
        mapPosition: null,
        canvasId: null,
        currentFrame: { tiles: [], anchor: null }
    };

    const TILE_SIZE = 512;
    const allWebGLContexts = new Set();

    // Override getContext to detect the main map rendering canvas
    const originalGetContext = HTMLCanvasElement.prototype.getContext;

    HTMLCanvasElement.prototype.getContext = function(contextType, ...args) {
        const context = originalGetContext.call(this, contextType, ...args);
        if (context) {
            const found = checkForMapCanvas(this, contextType, context);
            if (found && (contextType === 'webgl' || contextType === 'webgl2')) {
                interceptWebGL(context, this);
            }
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
        log.detail('init', 'considering canvas', contextType, width, height);

        // WebGL canvas is typically 300x150 initially
        if ((contextType === 'webgl' || contextType === 'webgl2') && width === 300 && height === 150) {
            selectMapCanvas(canvas, contextType, context);
            return true;
        }

        if (!document.contains(canvas)) {
            // Canvas is not in DOM, not the right 2d one.
            return false;
        }

        // 2D canvas should be tile-based (multiples of 256) and reasonably large (at least 2 tiles each direction)
        if (contextType === '2d' &&
            width > 0 && height > 0 &&
            width % 256 === 0 && height % 256 === 0 &&
            width * height > 250000) {
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

        log.info('init', `Selected map canvas: ${canvas.width}x${canvas.height}, ${contextType}, ${canvasId}`);

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

    // WebGL tile movement tracking functions
    function calculateVirtualTilePosition(tiles) {
        const virtualTiles = [];
        const sortedByX = [...tiles].sort((a, b) => a.x - b.x);

        for (let i = 0; i < sortedByX.length; i++) {
            const tile = sortedByX[i];
            let virtualX = tile.x;
            let virtualY = tile.y;

            // Calculate virtual X position
            if (tile.width === TILE_SIZE) {
                virtualX = tile.x;
            } else if (tile.width > 0) {
                const rightTile = sortedByX[i + 1];
                if (rightTile && rightTile.width > 0) {
                    virtualX = tile.x + tile.width - TILE_SIZE;
                } else if (rightTile && rightTile.width === 0) {
                    virtualX = rightTile.x - tile.width;
                } else {
                    virtualX = tile.x + tile.width - TILE_SIZE;
                }
            }

            // Calculate virtual Y position
            if (tile.height === TILE_SIZE) {
                virtualY = tile.y;
            } else if (tile.height > 0) {
                const tilesAtSameX = tiles.filter(t => t.x === tile.x).sort((a, b) => a.y - b.y);
                const currentIndex = tilesAtSameX.findIndex(t => t.y === tile.y);
                const belowTile = tilesAtSameX[currentIndex + 1];

                if (belowTile && belowTile.height > 0) {
                    virtualY = tile.y + tile.height - TILE_SIZE;
                } else if (belowTile && belowTile.height === 0) {
                    virtualY = belowTile.y - tile.height;
                } else {
                    virtualY = tile.y + tile.height - TILE_SIZE;
                }
            }

            virtualTiles.push({ ...tile, virtualX, virtualY });
        }

        return virtualTiles;
    }

    function findAnchorTile(tiles) {
        if (tiles.length === 0) return null;

        const visibleTiles = tiles.filter(
            t => t.width > 0 && t.height > 0 && t.width <= TILE_SIZE && t.height <= TILE_SIZE);
        if (visibleTiles.length === 0) return null;

        const virtualTiles = calculateVirtualTilePosition(visibleTiles);
        let anchor = virtualTiles[0];
        for (const tile of virtualTiles) {
            if (tile.virtualX + tile.virtualY < anchor.virtualX + anchor.virtualY) {
                anchor = tile;
            }
        }

        return {
            x: anchor.virtualX,
            y: anchor.virtualY,
            scissor: { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height }
        };
    }

    function calculateFrameMovement(fromAnchor, toAnchor) {
        if (!fromAnchor || !toAnchor) return null;

        const deltaX = toAnchor.x - fromAnchor.x;
        const deltaY = toAnchor.y - fromAnchor.y;

        let adjustedDeltaX = deltaX;
        let adjustedDeltaY = deltaY;
        let wrapped = false;

        if (Math.abs(deltaX) > 256) {
            adjustedDeltaX = deltaX > 0 ? deltaX - 512 : deltaX + 512;
            wrapped = true;
        }
        if (Math.abs(deltaY) > 256) {
            adjustedDeltaY = deltaY > 0 ? deltaY - 512 : deltaY + 512;
            wrapped = true;
        }

        return { x: adjustedDeltaX, y: adjustedDeltaY, wrapped };
    }

    function processFrame() {
        if (tileTracker.currentFrame.tiles.length === 0) return;

        // TODO: with fractional zooms the scissor calls and resulting tiles we accumulate
        // don't make a lot of sense so we generate bad offsets and stuff jumps around, we should
        // figure out what's happening or at least hide the canvas during movement on fractional zoom.

        const anchor = findAnchorTile(tileTracker.currentFrame.tiles);
        if (!anchor) {
            log.detail('state', "No anchor tile found in frame");
            return;
        }
        log.detail('state', "Found anchor tile", anchor);

        tileTracker.currentFrame.anchor = anchor;

        // Set URL baseline on first anchor after URL change
        if (!tileTracker.urlBaseline) {
            tileTracker.urlBaseline = anchor;
            tileTracker.totalMovement = { x: 0, y: 0 };
            tileTracker.frameBaseline = anchor;

            log.detail('state', `URL BASELINE set at virtual[${anchor.x}, ${anchor.y}]`);

            if (overlayCanvas) {
                overlayCanvas.style.transform = '';
            }

            // Notify isolated world of baseline reset
            window.postMessage({
                type: 'WOKEMAPS_BASELINE_RESET'
            }, '*');
            return;
        }

        // Calculate movement from previous frame
        const frameMovement = calculateFrameMovement(tileTracker.frameBaseline, anchor);

        if (frameMovement && (frameMovement.x !== 0 || frameMovement.y !== 0)) {
            tileTracker.totalMovement.x += frameMovement.x;
            tileTracker.totalMovement.y += frameMovement.y;
            const movementX = tileTracker.totalMovement.x;
            const movementY = tileTracker.totalMovement.y;

            log.detail('state', `Movement [${tileTracker.totalMovement.x >= 0 ? '+' : ''}${tileTracker.totalMovement.x}, ${tileTracker.totalMovement.y >= 0 ? '+' : ''}${tileTracker.totalMovement.y}] (frame: [${frameMovement.x >= 0 ? '+' : ''}${frameMovement.x}, ${frameMovement.y >= 0 ? '+' : ''}${frameMovement.y}])`);

            // Send movement to isolated world
            window.postMessage({
                type: 'WOKEMAPS_TILE_MOVEMENT',
                movement: { x: movementX, y: movementY }
            }, '*');

            // Update CSS to achieve immediate translation
            if (overlayCanvas) {
                overlayCanvas.style.transform =
                    `translate(${movementX / window.devicePixelRatio}px, ${-movementY / window.devicePixelRatio}px)`;
            }
        }

        tileTracker.frameBaseline = anchor;
        tileTracker.currentFrame.tiles = [];
        tileTracker.currentFrame.anchor = null;
    }

    // TODO: don't detect baseline from here, maybe do it on the other side, post a message?
    function resetBaselines(newPosition) {
        tileTracker.mapPosition = newPosition;

        // Update URL baseline to current frame position (preserve current state)
        if (tileTracker.frameBaseline) {
            tileTracker.urlBaseline = { ...tileTracker.frameBaseline };
            tileTracker.totalMovement = { x: 0, y: 0 };
        } else {
            tileTracker.urlBaseline = null;
            tileTracker.totalMovement = { x: 0, y: 0 };
        }

        // Notify isolated world
        window.postMessage({
            type: 'WOKEMAPS_BASELINE_RESET'
        }, '*');
    }

    /**
     * This is a slightly different version of the same content method from UrlParser.
     * It does not distinguish between zoom and meters, just puts them in a
     * `magnification` field. Presently it is not used for computation on this side.
     *
     * @param url
     * @returns {null|{magnification: number, lng: number, lat: number}}
     */
    function extractMapParameters(url = window.location.href) {
        const match = url.match(/@([-\d.]+),([-\d.]+),(\d+\.?\d*)[zm]/);
        if (match) {
            return {
                lat: parseFloat(match[1]),
                lng: parseFloat(match[2]),
                magnification: parseFloat(match[3])
            };
        }
        return null;
    }

    function handleURLChange(url) {
        const newPosition = extractMapParameters(url);
        if (newPosition) {
            // We used to only reset baselines if the position actually changed ..
            // but any signal that the URL changed should mean Maps has reset some state
            // and we should reset ours.
            // const positionChanged = !tileTracker.mapPosition ||
            //     Math.abs(newPosition.lat - tileTracker.mapPosition.lat) > 0.000001 ||
            //     Math.abs(newPosition.lng - tileTracker.mapPosition.lng) > 0.000001 ||
            //     newPosition.magnification !== tileTracker.mapPosition.magnification;
            resetBaselines(newPosition);
        }
    }

    function interceptWebGL(gl, canvas) {
        const canvasInfo = {
            id: canvas.getAttribute('data-wokemaps-canvas-id'),
            gl: gl
        };

        const contextData = { firstScissorInFrame: true, canvasInfo: canvasInfo, gl: gl };
        allWebGLContexts.add(contextData);

        // Hook scissor to collect all tile positions
        const originalScissor = gl.scissor;
        gl.scissor = function(x, y, width, height) {
            // Identify main canvas on first scissor activity
            if (contextData.firstScissorInFrame && !tileTracker.canvasId) {
                tileTracker.canvasId = canvasInfo.id;
                log.debug('init', `Set ${canvasInfo.id} as main maps canvas for tile tracking`);
            }

            // Collect scissor calls for the main canvas
            if (tileTracker.canvasId === canvasInfo.id && width <= TILE_SIZE && height <= TILE_SIZE) {
                tileTracker.currentFrame.tiles.push({ x, y, width, height });
            }

            log.detail('state', 'Captured scissor() call', x, y, width, height);

            contextData.firstScissorInFrame = false;
            return originalScissor.call(this, x, y, width, height);
        };
    }

    // Hook requestAnimationFrame for frame processing
    const originalRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = function(callback) {
        return originalRAF.call(this, function(timestamp) {
            // Reset first scissor flag for all contexts at start of new frame
            allWebGLContexts.forEach(contextData => {
                contextData.firstScissorInFrame = true;
            });

            log.detail('state', 'Starting new drawing frame');
            const result = callback(timestamp);

            // Process frame immediately after rendering
            processFrame();

            window.dispatchEvent(new CustomEvent('wokemaps_canvasAnimationFrameComplete', {}));

            return result;
        });
    };

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
            supported: mapCanvasInfo.contextType === '2d' || mapCanvasInfo.contextType === 'webgl' || mapCanvasInfo.contextType === 'webgl2'
        }, '*');
    }


    // Listen for requests from isolated script for canvas info
    window.addEventListener('message', (event) => {
        if (event.origin !== window.location.origin) return;

        if (event.data.type === 'WOKEMAPS_REQUEST_CANVAS_INFO') {
            if (mapCanvasInfo) {
                log.debug('init', 'Canvas info requested and available');
                communicateMapCanvasInfo();
            } else {
                log.debug('init', 'Canvas info requested but not yet detected, will send when available');
            }
        }

        if (event.data.type === 'WOKEMAPS_REGISTER_WEBGL_OVERLAY_CANVAS') {
            const canvasId = event.data.canvasId;
            log.debug('init', `Registering overlay canvas for immediate transforms: ${canvasId}`);
            overlayCanvas = document.getElementById(canvasId);
            if (!overlayCanvas) {
                log.warn('init', `No overlay canvas found with id ${canvasId}`);
            }
        }
    });


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

    // History API overrides
    const originalPushState = history.pushState;
    history.pushState = function(...args) {
        const result = originalPushState.apply(this, args);
        window.dispatchEvent(new CustomEvent('wokemaps_urlChanged', {
            detail: {
                url: window.location.href
            }
        }));
        handleURLChange(args[2] || window.location.href);
        return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
        const result = originalReplaceState.apply(this, args);
        window.dispatchEvent(new CustomEvent('wokemaps_urlChanged', {
            detail: {
                url: window.location.href
            }
        }));
        handleURLChange(args[2] || window.location.href);
        return result;
    };

    // Interaction tracking
    function handleMouseUp(e) {
        const target = e.target;
        const zoomInButton = document.getElementById('widget-zoom-in');
        const zoomOutButton = document.getElementById('widget-zoom-out');
        if (target === zoomInButton || zoomInButton.contains(target) ||
            target === zoomOutButton || zoomOutButton.contains(target)) {
            log.detail('ui', 'Clicked on zoom button');
            handlePotentialZoomInteraction(e);
        }

        if (target.getAttribute('jsaction')?.startsWith('drawer.') ||
            (target.parentNode &&
                target.parentNode.getAttribute &&
                target.parentNode.getAttribute('jsaction')?.startsWith('drawer.'))) {
            log.detail('ui', 'Clicked on drawer open/close');
            // In WebGL mode the tile frame scissor coords shift a ton between drawer
            // open and close, and then stay that way .. so we handle the transition
            // by just resetting our baselines so the map doesn't move.
            // We're not hiding the overlay so if the drawer is open/closed WHILE
            // the map is still moving, there will be a brief misdraw until the URL
            // change resets the baselines again.
            setTimeout(() => {
                tileTracker.frameBaseline = null;
                resetBaselines(tileTracker.mapPosition);
            }, 1);
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

    log.setPrefix('wokemaps*');
    log.initializeInPage();

    window.addEventListener('mouseup', handleMouseUp, { capture: true, passive: true });
    window.addEventListener('wheel', handlePotentialZoomInteraction, { capture: true, passive: true });
    window.addEventListener('keydown', handleKeyDown, { capture: true, passive: true });

    // URL change tracking for WebGL tile movement
    window.addEventListener('popstate', () => {
        handleURLChange(window.location.href);
    });

    // Initialize with current URL
    const currentPosition = extractMapParameters();
    if (currentPosition) {
        resetBaselines(currentPosition);
    }

    log.debug('init', 'Canvas detection and tile tracking initialized');
})();
