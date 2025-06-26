// Overlay Engine
// Handles detecting tile redraws and overlaying labels on map tiles

class OverlayEngine {
    constructor(mapCanvas, mapState, labelRenderer, options, allLabels) {
        this.mapCanvas = mapCanvas;
        this.mapState = mapState;
        this.labelRenderer = labelRenderer;
        this.debugOptions = options.debug || {};
        this.allLabels = allLabels;

        // Tile rendering sequence tracking
        this.firstTileInSequence = null;
        this.previousFirstTileInSequence = null;
        this.sequenceInProgress = false;
        this.sequenceMayHaveNewTransform = false;
    }

    /**
     * Initialize the overlay engine and set up event listeners
     */
    initialize() {
        window.addEventListener('wokemaps_canvasDrawImageCalled', (e) => this.onCanvasImageDrawn(e));
        this.mapState.addChangeListener((c) => {
            if (c === 'zoomResolved') {
                // A zoom operation was in progress and so we suspended drawing overlays in response to redraws.
                // Now we must draw labels.
                this.drawAllLabels();
            }
        });

        console.log('OverlayEngine: canvas draw listener initialized');
    }

    /**
     * Get tile content hash for tracking tile sequences
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Object} transform - Transform matrix
     * @param {number} dx - Destination X
     * @param {number} dy - Destination Y
     * @param {number} dw - Destination width
     * @param {number} dh - Destination height
     * @returns {number} Hash of tile content
     */
    getTileContentHash(ctx, transform, dx, dy, dw, dh) {
        let hash = 0x9e3779b9; // Golden ratio based seed

        // Only do 1 out of every `prime` pixels to do a "random" sampling of the tile,
        // to avoid doing too much work.
        const prime = 13; // Prime increment (must be < tileSize)

        // Get all pixel data at once. `getImageData` does not use context's
        // current transform.
        const topLeft = this.applyContextTransform(dx, dy, transform);
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

    /**
     * Record the first tile in a rendering sequence
     * @param {Object} extent - Tile extent {dx, dy, dw, dh}
     * @param {Object} transform - Transform matrix
     */
    recordTileInSequence(extent, transform) {
        if (this.firstTileInSequence === null) {
            // Only need record the first tile
            const {dx, dy, dw, dh} = extent;
            const hash = this.getTileContentHash(this.mapCanvas.context, transform, dx, dy, dw, dh);
            this.firstTileInSequence = hash >>> 0;
            console.log(`Maps is rendering tiles, first is ${this.firstTileInSequence.toString(16)}`);
            this.sequenceMayHaveNewTransform = this.firstTileInSequence !== this.previousFirstTileInSequence;
        }
    }

    /**
     * End the current tile rendering sequence
     */
    endTileSequence() {
        if (this.firstTileInSequence !== null) {
            this.previousFirstTileInSequence = this.firstTileInSequence;
            this.firstTileInSequence = null;
            // Don't reset `sequenceMayHaveNewTransform` as the labels come after the tiles / canvas
        }
    }

    /**
     * Handle canvas image draw events
     * @param {CustomEvent} e - Canvas draw event
     */
    onCanvasImageDrawn(e) {
        if (!this.mapCanvas.context || !this.mapState.center ||
            !this.labelRenderer.getPreRenderedLabels().length) {
            return;
        }

        const extent = e.detail.extent;
        const transform = e.detail.transform;
        const {dx, dy, dw, dh} = extent;
        let shouldDelay = false;

        // Image draw requests are typically for tiles (square), for labels (smaller), or
        // for the whole canvas.
        const isTile = dw === this.mapCanvas.tileSize && dh === this.mapCanvas.tileSize;
        // TODO: is there a better way, maybe just compare to "whole canvas" size?
        // don't want to break on small windows / assumptions
        const isCanvas = dw > this.mapCanvas.tileSize * 2 && dh > this.mapCanvas.tileSize * 2;

        if (isCanvas) {
            // Large canvas render - end current sequence, and no need to try to redraw anything.
            this.endTileSequence();
            return;
        }

        // Check if we should start a new sequence
        if (isTile && !this.sequenceInProgress) {
            // Make sure our transform info is up to date.
            this.mapState.updateCanvasTransform();
            this.mapState.updateParentTransform();
            this.recordTileInSequence(extent, transform);
        }

        if (this.mapState.isPotentiallyZooming) {
            // We have recently processed an interaction that could potentially zoom the view and our state will be
            // out of sync, causing us to render in the wrong place, leaving a visual artifact without recourse.
            // Instead of rendering, wait until zoom settles.
            return;
        }

        if (this.sequenceMayHaveNewTransform) {
            // We are getting a different first tile, which means the tileset has changed, we might have
            // panned or zoomed. But our transform may not have been updated, so just to be sure we delay
            // until the transform changes. This may cause flicker but it's much preferable to drawing
            // in the wrong place.
            shouldDelay = true;
        }

        if (shouldDelay) {
            setTimeout(() => this.renderOverlappingLabels(extent, transform), 1);
        } else {
            this.renderOverlappingLabels(extent, transform);
        }
    }

    /**
     * Render labels that overlap with the given tile extent
     * @param {Object} extent - Tile extent {dx, dy, dw, dh}
     * @param {Object} transform - Transform matrix
     */
    renderOverlappingLabels(extent, transform) {
        const {dx, dy, dw, dh} = extent;
        const isTile = dw === this.mapCanvas.tileSize && dh === this.mapCanvas.tileSize;

        const topLeft = this.applyContextTransform(dx, dy, transform);
        const bottomRight = this.applyContextTransform(dx + dw, dy + dh, transform);
        const imageCanvasBounds = {
            left: topLeft.x,
            right: bottomRight.x,
            top: topLeft.y,
            bottom: bottomRight.y,
        };

        // Highlight grid for debugging
        if (this.debugOptions.highlightGrid && isTile) {
            const context = this.mapCanvas.context;
            context.save();
            context.resetTransform();
            context.strokeStyle = 'rgba(200, 255, 200, 100)';
            context.lineWidth = 3;
            context.strokeRect(topLeft.x, topLeft.y, dw, dh);
            context.restore();
        }

        // Filter labels by zoom level first
        const zoomFilteredLabels = this.labelRenderer.getPreRenderedLabels().filter(label =>
            this.mapState.zoom >= label.minZoom && this.mapState.zoom <= label.maxZoom
        );

        // Process each potentially visible label
        zoomFilteredLabels.forEach(label => {
            // Convert label's lat/lng to canvas pixel coordinates.
            // Requires canvas transform to be up to date.
            const labelCanvasPos = this.latLngToCanvasPixel(label.lat, label.lng);
            if (!labelCanvasPos) return;

            // Calculate label bounds in canvas coordinates
            const labelCanvasBounds = {
                left: labelCanvasPos.x + (label.xOffset || 0) - label.width / 2,
                right: labelCanvasPos.x + (label.xOffset || 0) + label.width / 2,
                top: labelCanvasPos.y + (label.yOffset || 0) - label.height / 2,
                bottom: labelCanvasPos.y + (label.yOffset || 0) + label.height / 2
            };

            // Check for overlap and get overlap details
            const overlap = this.calculateImageLabelOverlap(imageCanvasBounds, labelCanvasBounds);

            if (overlap) {
                this.drawLabelOverlap(label, overlap, transform);
            }
        });
    }

    /**
     * Convert lat/lng to canvas pixel coordinates using current map state
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @returns {Object|null} Canvas coordinates {x, y} or null if failed
     */
    latLngToCanvasPixel(lat, lng) {
        if (!this.mapState.center) return null;

        // Get the projected pixel position for both the label and map center
        const labelPixel = this.labelRenderer.googleMapsLatLngToPoint(lat, lng, this.mapState.zoom);
        const centerPixel = this.labelRenderer.googleMapsLatLngToPoint(
            this.mapState.center.lat, this.mapState.center.lng, this.mapState.zoom);

        if (!labelPixel || !centerPixel) return null;

        // Calculate offset from center in projected coordinates
        const worldOffsetX = labelPixel.x - centerPixel.x;
        const worldOffsetY = labelPixel.y - centerPixel.y;

        // Convert to canvas coordinates using the same logic as drawLabel
        const canvasCenter = this.mapCanvas.getCenter();
        const parentDimensions = this.mapCanvas.getParentDimensions();

        const tileAlignmentX = -this.mapCanvas.tileSize + (parentDimensions.width % (this.mapCanvas.tileSize / 2));
        const tileAlignmentY = -this.mapCanvas.tileSize + (parentDimensions.height % (this.mapCanvas.tileSize / 2));

        const x = canvasCenter.x + worldOffsetX -
            (this.mapState.canvasTransform.translateX * window.devicePixelRatio) + tileAlignmentX;
        const y = canvasCenter.y + worldOffsetY -
            (this.mapState.canvasTransform.translateY * window.devicePixelRatio) + tileAlignmentY;

        return { x, y };
    }

    /**
     * Calculate overlap between label and tile bounds
     * @param {Object} imageBounds - Image bounds {left, right, top, bottom}
     * @param {Object} labelBounds - Label bounds {left, right, top, bottom}
     * @returns {Object|null} Overlap info or null if no overlap
     */
    calculateImageLabelOverlap(imageBounds, labelBounds) {
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

    /**
     * Draw label overlap directly to canvas coordinates
     * @param {Object} label - Label configuration with pre-rendered info
     * @param {Object} overlap - Overlap calculation result
     * @param {Object} transform - Transform matrix
     */
    drawLabelOverlap(label, overlap, transform) {
        if (!this.labelRenderer.labelsCanvas || !this.mapCanvas.context) return;

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
            this.mapCanvas.context.save();
            // It is important we draw with no transform because the parameters we are passing are
            // relative to the origin of the canvas.
            this.mapCanvas.context.resetTransform();
            this.mapCanvas.context.drawImage(
                this.labelRenderer.labelsCanvas,
                srcX, srcY, srcW, srcH,
                destX, destY, destW, destH
            );
            this.mapCanvas.context.restore();
        } catch (e) {
            console.error("Error drawing label overlap:", e);
        }
    }

    /**
     * Apply transform to convert canvas coordinates
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {Object} transform - Transform matrix {a, b, c, d, e, f}
     * @returns {Object} Transformed coordinates {x, y}
     */
    applyContextTransform(x, y, transform) {
        const { a, b, c, d, e, f } = transform;
        return {
            x: a * x + c * y + e,
            y: b * x + d * y + f
        };
    }

    // Draw all labels on the canvas (fallback method)
    drawAllLabels() {
        if (!this.mapCanvas.canvas || !this.mapCanvas.context || !this.mapState.center) return;

        const zoom = this.mapState.zoom;
        this.allLabels.forEach(label => {
            // Check if within this label's zoom range
            if (zoom >= label.minZoom && zoom <= label.maxZoom) {
                this.labelRenderer.drawLabelToCanvas(
                    label,
                    { center: this.mapState.center, zoom: this.mapState.zoom },
                    this.mapState.canvasTransform);
            }
        });
    }

}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.OverlayEngine = OverlayEngine;
}
