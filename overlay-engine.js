// Overlay Engine - WebGL Implementation
// Handles label rendering to overlay canvas and manages visibility during interactions

class OverlayEngine {
    constructor(mapCanvas, mapState, labelRenderer, allLabels, debugOptions) {
        this.mapCanvas = mapCanvas;
        this.mapState = mapState;
        this.labelRenderer = labelRenderer;
        this.debugOptions = debugOptions;
        this.allLabels = allLabels.map((label) => labelRenderer.getLabelProperties(label));
    }

    /**
     * Initialize the overlay engine and set up event listeners
     */
    initialize() {
        // Listen for map state changes
        this.mapState.addChangeListener((changeType) => this.handleStateChange(changeType));
        this.mapCanvas.addChangeListener((changeType) => this.handleCanvasChange(changeType));
        window.addEventListener('wokemaps_canvasDrawImageCalled', (e) => this.handleCanvasImageDrawn(e));
        window.addEventListener('wokemaps_canvasAnimationFrameComplete', (e) => this.handleCanvasRedrawComplete(e));

        // Initial render
        this.redrawAllLabels();

        log.detail('init','OverlayEngine: initialized');
    }

    /**
     * Handle map canvas changes
     */
    handleCanvasChange(changeType) {
        switch (changeType) {
            case 'canvasResize':
                this.redrawAllLabels();
                break;
        }
    }

    /**
     * Handle map state changes
     */
    handleStateChange(changeType) {
        // TODO: simplify these state changes, probably just need position and movement
        switch (changeType) {
            case 'canvasTransform':
                // If our canvas has been translated, match it
                this.mapCanvas.setOverlayTranslate(
                    this.mapState.canvasTransform.translateX,
                    this.mapState.canvasTransform.translateY);
                this.redrawAllLabels();
                break;

            case 'position':
                // URL position changed - need full redraw
                this.redrawAllLabels();
                break;

            case 'movement':
                // Tile movement detected. The overlay will move via CSS transform,
                // handled either by Maps itself (CSS changes on the parent) or
                // by our in-page script (responds to tile movement by making CSS
                // changes on our overlay canvas).
                // We do have a bug in the WebGL version where fractional zooms mess up
                // our offset detection because the tile clipping (which we listen to) is done
                // differently, so hide during movement IF our zoom is fractional.
                if (this.mapState.zoom !== Math.round(this.mapState.zoom)) {
                    this.mapCanvas.hideOverlay();
                }
                break;

            case 'baseline':
                // Baseline position reset - need full redraw
                this.mapCanvas.showOverlay();
                this.redrawAllLabels();
                break;

            case 'zoomResolved':
                // Zoom operation finished - show overlay and redraw
                this.mapCanvas.showOverlay();
                this.redrawAllLabels();
                break;
        }
    }

    /**
     * Render all visible labels to the overlay canvas
     */
    redrawAllLabels() {
        if (!this.mapCanvas.overlayCanvas || !this.mapCanvas.overlayContext || !this.mapState.center) {
            log.warn('render','Cannot render - missing canvas or center');
            return;
        }

        // Clear the overlay canvas
        const canvasDimensions = this.mapCanvas.getDimensions();
        this.mapCanvas.overlayContext.clearRect(0, 0, canvasDimensions.width, canvasDimensions.height);

        // Skip rendering if currently zooming
        if (this.mapState.isPotentiallyZooming) {
            log.debug('render','Cannot render - missing canvas or center');
            return;
        }

        log.detail('render','Redrawing labels');

        const zoom = this.mapState.zoom;
        let renderedCount = 0;

        // Render each label that's in zoom range
        this.allLabels.forEach(label => {
            if (zoom >= label.zoomLimits[0] && zoom < label.zoomLimits[1]) {
                if (this.renderLabelToOverlay(label)) {
                    renderedCount++;
                }
            }
        });

        if (this.debugOptions.highlightCanvasOrigins) {
            // Render overlay origin (native origin will be handled separately, when tiles are redrawn)
            const canvasDimensions = this.mapCanvas.getDimensions();
            const x = canvasDimensions.width / 2 - this.mapState.canvasTransform.translateX * window.devicePixelRatio;
            const y = canvasDimensions.height / 2 - this.mapState.canvasTransform.translateY * window.devicePixelRatio;
            this.debugRenderOriginMarker(this.mapCanvas.overlayContext, {x, y}, 'x', '#ff0000cc');
        }

        if (this.debugOptions.highlightGrid) {
            // Render overlay grid
            const context = this.mapCanvas.overlayContext;
            const tileSize = this.mapCanvas.tileSize;
            const canvasDimensions = this.mapCanvas.getDimensions();
            context.save();
            context.lineWidth = 3;
            context.strokeStyle = 'rgba(255, 200, 200, 100)';
            for (let y = 0; y < canvasDimensions.height; y += tileSize) {
                for (let x = 0; x < canvasDimensions.width; x += tileSize) {
                    context.strokeRect(x, y, tileSize, tileSize);
                }
            }
            context.restore();
        }
    }

    /**
     * Handle canvas image draw events
     * @param {CustomEvent} e - Canvas draw event
     */
    handleCanvasImageDrawn(e) {
        // We are only doing this to support grid highlighting.
        if (!this.debugOptions.highlightGrid) return;
        if (this.mapState.isPotentiallyZooming) {
            // We have recently processed an interaction that could potentially zoom the view and our state will be
            // out of sync, causing us to render in the wrong place, leaving a visual artifact without recourse.
            // Instead of rendering, wait until zoom settles.
            return;
        }
        // Do it delayed, it's ok if the grid is a bit flickery we just don't want it disappearing.
        setTimeout(() => {
            const extent = e.detail.extent;
            const transform = e.detail.transform;
            const {dx, dy, dw, dh} = extent;
            const isTile = (dw % this.mapCanvas.tileSize === 0) && (dh % this.mapCanvas.tileSize === 0);
            if (!isTile) return;

            // Draw a box around the tile.
            const context = this.mapCanvas.context;
            const topLeft = MapCanvas.applyContextTransform(dx, dy, transform);
            context.save();
            context.resetTransform();
            context.strokeStyle = 'rgba(200, 255, 200, 100)';
            context.lineWidth = 3;
            context.strokeRect(topLeft.x, topLeft.y, dw, dh);
            context.restore();
        }, 1);
    }

    handleCanvasRedrawComplete() {
        if (this.debugOptions.highlightCanvasOrigins) {
            const canvasDimensions = this.mapCanvas.getDimensions();
            const x = canvasDimensions.width / 2 - this.mapState.canvasTransform.translateX * window.devicePixelRatio;
            const y = canvasDimensions.height / 2 - this.mapState.canvasTransform.translateY * window.devicePixelRatio;
            this.debugRenderOriginMarker(this.mapCanvas.mapCanvas.getContext('2d'), {x, y}, 'o', '#00cc00cc');
        }
    }

    debugRenderOriginMarker(context, position, style, color) {
        const radius = 25;
        context.save();
        context.resetTransform();
        context.translate(position.x, position.y);
        context.lineWidth = 7;
        context.strokeStyle = color;
        // circle
        if (style === 'o') {
            context.beginPath();
            context.arc(0, 0, radius, 0, 2 * Math.PI, false);
            context.stroke();
        }
        if (style === 'x') {
            context.beginPath();
            context.moveTo(-radius, -radius);
            context.lineTo(radius, radius);
            context.moveTo(radius, -radius);
            context.lineTo(-radius, radius);
            context.stroke();
        }
        context.restore();
    }

    /**
     * Render a single label to the overlay canvas
     */
    renderLabelToOverlay(label) {
        log.detail('render', "rendering label", label);
        if (!this.mapState.center) return false;

        // Calculate the pixel position for this label
        const labelPosition = this.calculateLabelPosition(label);
        if (!labelPosition) return false;

        // Check if label is visible on screen
        const canvasDimensions = this.mapCanvas.getDimensions();
        const devicePixelRatio = window.devicePixelRatio || 1;
        const displayWidth = canvasDimensions.width / devicePixelRatio;
        const displayHeight = canvasDimensions.height / devicePixelRatio;

        const tileSize = this.mapCanvas.tileSize;
        if (labelPosition.x < -tileSize || labelPosition.x > displayWidth + tileSize ||
            labelPosition.y < -tileSize || labelPosition.y > displayHeight + tileSize) {
            return false; // >1 tile offscreen
        }

        // Draw the label
        this.labelRenderer.drawLabelAtPosition(
            this.mapCanvas.overlayContext,
            labelPosition.x,
            labelPosition.y,
            label
        );

        return true;
    }

    /**
     * Calculate the display position for a label based on current map state
     */
    calculateLabelPosition(label) {
        // Get base position from context-aware MapState
        const basePosition = this.mapState.mapLatLngToCanvas(label.latLng[0], label.latLng[1]);
        if (!basePosition) return null;

        // Apply label-specific offset
        return {
            x: basePosition.x + label.offset[0],
            y: basePosition.y + label.offset[1]
        };
    }


}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.OverlayEngine = OverlayEngine;
}
