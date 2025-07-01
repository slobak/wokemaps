// URL Parser Utility
// Shared utility for extracting map position and zoom from Google Maps URLs

class URLParser {
    /**
     * Extract map position (lat, lng, zoom) from Google Maps URL
     * @param {string} url - The URL to parse (defaults to current window location)
     * @returns {Object|null} - {lat, lng, zoom} or null if not found
     */
    static extractMapParameters(url = window.location.href) {
        const match = url.match(/@([-\d.]+),([-\d.]+),(\d+\.?\d*)z/);
        if (match && match.length >= 4) {
            const lat = parseFloat(match[1]);
            const lng = parseFloat(match[2]);
            const zoom = parseFloat(match[3]);
            
            if (!isNaN(lat) && !isNaN(lng) && !isNaN(zoom)) {
                return { lat, lng, zoom };
            }
        }
        return null;
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.URLParser = URLParser;
}