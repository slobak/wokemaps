// Coordinate Transformer Utility
// Shared utility for converting between geographic and pixel coordinates

class CoordinateTransformer {
    /**
     * Convert lat/lng to world pixel coordinates using Google Maps Mercator projection
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude  
     * @param {number} zoom - Zoom level
     * @returns {Object|null} Pixel coordinates {x, y} or null if error
     */
    static googleMapsLatLngToPoint(lat, lng, zoom) {
        try {
            // First, we need the normalized coordinates between 0 and 1
            const normX = (lng + 180) / 360;

            // Convert latitude to radians for sin calculation
            const latRad = lat * Math.PI / 180;

            // Apply the Mercator projection formula
            const mercN = Math.log(Math.tan((Math.PI / 4) + (latRad / 2)));
            const normY = 0.5 - mercN / (2 * Math.PI);

            // Scale by the world size at this zoom level.
            // This is just a fixed constant based on maps data.
            const worldSize = Math.pow(2, zoom) * 256;

            // Convert to pixel coordinates
            const pixelX = Math.floor(normX * worldSize);
            const pixelY = Math.floor(normY * worldSize);

            return { x: pixelX, y: pixelY };
        } catch (e) {
            if (typeof log !== 'undefined') {
                log.error('coord', "Error in googleMapsLatLngToPoint:", e);
            }
            return null;
        }
    }

    /**
     * Calculate pixel coordinate offset between two lat/lng points
     * @param {number} fromLat - Source latitude
     * @param {number} fromLng - Source longitude
     * @param {number} toLat - Target latitude  
     * @param {number} toLng - Target longitude
     * @param {number} zoom - Zoom level
     * @returns {Object|null} Pixel offset {x, y} or null if error
     */
    static calculatePixelOffset(fromLat, fromLng, toLat, toLng, zoom) {
        const fromPixel = this.googleMapsLatLngToPoint(fromLat, fromLng, zoom);
        const toPixel = this.googleMapsLatLngToPoint(toLat, toLng, zoom);
        
        if (!fromPixel || !toPixel) return null;
        
        return {
            x: toPixel.x - fromPixel.x,
            y: toPixel.y - fromPixel.y
        };
    }

    /**
     * Convert meters visible to zoom level for satellite mode URLs
     * @param {number} metersVisible - Meters visible in vertical extent
     * @param {number} lat - Center latitude for mercator adjustment
     * @param {number} viewportHeight - Viewport height in pixels
     * @returns {number} Calculated zoom level
     */
    static convertMetersToZoom(metersVisible, lat, viewportHeight) {
        // Earth's circumference at equator in meters
        const EARTH_CIRCUMFERENCE = 40075017;
        
        // Web Mercator tile size in pixels
        const TILE_SIZE = 256;
        
        // Calculate meters per pixel at zoom 0 at equator
        const equatorMetersPerPixelZoom0 = EARTH_CIRCUMFERENCE / TILE_SIZE;
        
        // Calculate current meters per pixel
        const currentMetersPerPixel = metersVisible / viewportHeight;
        
        // Calculate scale factor at equator
        const scaleFactorAtEquator = equatorMetersPerPixelZoom0 / currentMetersPerPixel;
        
        // Calculate zoom level at equator
        const zoomAtEquator = Math.log2(scaleFactorAtEquator);
        
        // Adjust for latitude using mercator scale factor
        const mercatorScaleFactor = 1 / Math.cos(lat * Math.PI / 180);
        const adjustedZoom = zoomAtEquator - Math.log2(mercatorScaleFactor);
        
        return Math.max(0, adjustedZoom);
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.CoordinateTransformer = CoordinateTransformer;
}