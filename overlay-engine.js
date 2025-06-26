// Overlay Engine - WebGL Implementation
// Handles label rendering to overlay canvas and manages visibility during interactions

class OverlayEngine {
    constructor(mapCanvas, mapState, labelRenderer, allLabels) {
        this.mapCanvas = mapCanvas;
        this.mapState = mapState;
        this.labelRenderer = labelRenderer;
        this.allLabels = allLabels;
    }

    /**
     * Initialize the overlay engine and set up event listeners
     */
    initialize() {
        // Listen for map state changes
        this.mapState.addChangeListener((changeType) => this.handleStateChange(changeType));
        this.mapCanvas.addChangeListener((changeType) => this.handleCanvasChange(changeType));

        // Initial render
        this.redrawAllLabels();

        console.log('OverlayEngine: initialized');
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
        //console.log('state change', changeType);
        // TODO: simplify these state changes, probably just need position and movement
        switch (changeType) {
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
        if (!this.mapCanvas.canvas || !this.mapCanvas.context || !this.mapState.center) {
            console.log('wokemaps: Cannot render - missing canvas or center');
            return;
        }

        // Clear the overlay canvas
        const canvasDimensions = this.mapCanvas.getDimensions();
        this.mapCanvas.context.clearRect(0, 0, canvasDimensions.width, canvasDimensions.height);

        // Skip rendering if currently zooming
        if (this.mapState.isPotentiallyZooming) {
            console.log('wokemaps: Skipping render during zoom interaction');
            return;
        }

        console.log('wokemaps: Redrawing labels');

        const zoom = this.mapState.zoom;
        let renderedCount = 0;

        // Render each label that's in zoom range
        this.allLabels.forEach(label => {
            if (zoom >= label.minZoom && zoom <= label.maxZoom) {
                if (this.renderLabelToOverlay(label)) {
                    renderedCount++;
                }
            }
        });

        // Update last rendered state
        this.lastRenderedState = {
            center: { ...this.mapState.center },
            zoom: this.mapState.zoom,
            movementOffset: { ...this.mapState.movementOffset },
            timestamp: Date.now()
        };

        //console.log(`wokemaps: Rendered ${renderedCount} labels to overlay at zoom ${zoom}`);
    }

    /**
     * Render a single label to the overlay canvas
     */
    renderLabelToOverlay(label) {
        //console.log("rendering label", label);
        if (!this.mapState.center) return false;

        // Calculate the pixel position for this label
        const labelPosition = this.calculateLabelPosition(label);
        if (!labelPosition) return false;

        // Check if label is visible on screen
        const canvasDimensions = this.mapCanvas.getDimensions();
        const devicePixelRatio = window.devicePixelRatio || 1;
        const displayWidth = canvasDimensions.width / devicePixelRatio;
        const displayHeight = canvasDimensions.height / devicePixelRatio;

        if (labelPosition.x < -100 || labelPosition.x > displayWidth + 100 ||
            labelPosition.y < -100 || labelPosition.y > displayHeight + 100) {
            return false; // Off screen
        }

        // Get label properties
        const labelProps = this.labelRenderer.getLabelProperties(label);

        // Draw the label
        this.labelRenderer.drawLabelAtPosition(
            this.mapCanvas.context,
            labelPosition.x,
            labelPosition.y,
            labelProps
        );

        return true;
    }

    /**
     * Calculate the display position for a label based on current map state
     */
    calculateLabelPosition(label) {
        if (!this.mapState.center) return null;

        // Convert label lat/lng to world pixel coordinates
        const labelPixel = this.labelRenderer.googleMapsLatLngToPoint(label.lat, label.lng, this.mapState.zoom);
        const centerPixel = this.labelRenderer.googleMapsLatLngToPoint(
            this.mapState.center.lat, this.mapState.center.lng, this.mapState.zoom);

        if (!labelPixel || !centerPixel) return null;

        // Calculate offset from center in world coordinates
        const worldOffsetX = labelPixel.x - centerPixel.x;
        const worldOffsetY = labelPixel.y - centerPixel.y;

        // Get overlay canvas center in display coordinates
        const canvasDimensions = this.mapCanvas.getDimensions();
        const devicePixelRatio = window.devicePixelRatio || 1;
        const canvasCenterX = (canvasDimensions.width / devicePixelRatio) / 2;
        const canvasCenterY = (canvasDimensions.height / devicePixelRatio) / 2;

        // Calculate final position
        // Note: We don't apply movement offset here because that's handled by CSS transform
        const x = canvasCenterX + worldOffsetX + (label.xOffset || 0);
        const y = canvasCenterY + worldOffsetY + (label.yOffset || 0);

        return { x, y };
    }

    /**
     * Force a complete redraw (useful for external triggers)
     */
    forceRedraw() {
        this.redrawAllLabels();
    }

    /**
     * Clear the overlay canvas
     */
    clear() {
        if (this.mapCanvas.context) {
            const canvasDimensions = this.mapCanvas.getDimensions();
            this.mapCanvas.context.clearRect(0, 0, canvasDimensions.width, canvasDimensions.height);
        }
    }

}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.OverlayEngine = OverlayEngine;
}
