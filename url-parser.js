// URL Parser Utility
// Shared utility for extracting map position and zoom from Google Maps URLs

class URLParser {
    /**
     * Extract map position (lat, lng, zoom) from Google Maps URL
     * @param {string} url - The URL to parse (defaults to current window location)
     * @returns {Object|null} - {lat, lng, zoom} or null if not found
     */
    static extractMapParameters(url = window.location.href) {
        // Try standard zoom format first (@lat,lng,zoomz)
        const zoomMatch = url.match(/@([-\d.]+),([-\d.]+),(\d+\.?\d*)z/);
        if (zoomMatch && zoomMatch.length >= 4) {
            const lat = parseFloat(zoomMatch[1]);
            const lng = parseFloat(zoomMatch[2]);
            const zoom = parseFloat(zoomMatch[3]);
            
            if (!isNaN(lat) && !isNaN(lng) && !isNaN(zoom)) {
                return { lat, lng, zoom };
            }
        }

        // Try satellite mode format (@lat,lng,metersm)
        const metersMatch = url.match(/@([-\d.]+),([-\d.]+),(\d+\.?\d*)m/);
        if (metersMatch && metersMatch.length >= 4) {
            const lat = parseFloat(metersMatch[1]);
            const lng = parseFloat(metersMatch[2]);
            const metersVisible = parseFloat(metersMatch[3]);
            
            if (!isNaN(lat) && !isNaN(lng) && !isNaN(metersVisible)) {
                return { lat, lng, meters: metersVisible };
            }
        }

        return null;
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.URLParser = URLParser;
}