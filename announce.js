// Woke Maps Announcement System
// Handles displaying dismissible announcements at the top of Google Maps

(function() {
    console.log("wokemaps: announcement system initializing");

    let announcementBar = null;
    let announcements = [];
    let currentAnnouncement = null;

    const DISMISSAL_STORAGE_KEY = 'wokemaps_announcement_dismissals';

    // Load dismissal state from localStorage
    function loadDismissalState() {
        try {
            const stored = localStorage.getItem(DISMISSAL_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                return parsed.latestDismissal || null;
            }
        } catch (e) {
            console.warn("wokemaps: Failed to load dismissal state:", e);
        }
        return null;
    }

    // Save dismissal state to localStorage
    function saveDismissalState(timestamp) {
        try {
            const state = {
                latestDismissal: timestamp
            };
            localStorage.setItem(DISMISSAL_STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn("wokemaps: Failed to save dismissal state:", e);
        }
    }

    // Find the first non-dismissed announcement that should be shown
    function findActiveAnnouncement(announcements) {
        if (!announcements || !Array.isArray(announcements) || announcements.length === 0) {
            return null;
        }

        const now = new Date();
        const latestDismissal = loadDismissalState();
        const latestDismissalDate = latestDismissal ? new Date(latestDismissal) : null;

        for (const announcement of announcements) {
            try {
                const showAfterDate = new Date(announcement['show-after']);

                // Check if announcement should be shown based on time
                if (showAfterDate > now) {
                    continue; // Too early to show
                }

                // Check if announcement has been dismissed
                if (latestDismissalDate && latestDismissalDate >= showAfterDate) {
                    continue; // Has been dismissed
                }

                // This announcement should be shown
                return announcement;
            } catch (e) {
                console.warn("wokemaps: Invalid announcement data:", announcement, e);
                continue;
            }
        }

        return null;
    }

    // Create the announcement bar HTML
    function createAnnouncementBar(announcement) {
        const bar = document.createElement('div');
        bar.id = 'wokemaps-announcement-bar';
        bar.innerHTML = `
      <div class="wokemaps-announcement-content">
        <div class="wokemaps-announcement-icon">
          <img src="${chrome.runtime.getURL('images/icon16.png')}" alt="Wokemaps" />
        </div>
        <div class="wokemaps-announcement-text">${announcement.contents}</div>
        <button class="wokemaps-announcement-close" aria-label="Dismiss announcement">&times;</button>
      </div>
    `;

        return bar;
    }

    // Show the announcement bar with animation
    function showAnnouncementBar(announcement) {
        if (announcementBar) {
            return; // Already showing
        }

        announcementBar = createAnnouncementBar(announcement);
        currentAnnouncement = announcement;

        // Add to DOM
        document.body.appendChild(announcementBar);

        // Add event listener for close button
        const closeButton = announcementBar.querySelector('.wokemaps-announcement-close');
        closeButton.addEventListener('click', dismissAnnouncement);

        // Trigger slide-down animation after a brief delay
        setTimeout(() => {
            announcementBar.classList.add('show');
        }, 100);

        console.log("wokemaps: Showing announcement:", announcement.contents);
    }

    // Dismiss the current announcement
    function dismissAnnouncement() {
        if (!announcementBar || !currentAnnouncement) {
            return;
        }

        // Save dismissal timestamp
        saveDismissalState(new Date().toISOString());

        // Animate out
        announcementBar.classList.remove('show');

        // Remove from DOM after animation
        setTimeout(() => {
            if (announcementBar && announcementBar.parentNode) {
                announcementBar.parentNode.removeChild(announcementBar);
            }
            announcementBar = null;
            currentAnnouncement = null;
        }, 300);

        console.log("wokemaps: Announcement dismissed");
    }

    // Initialize announcements from loaded data
    function initializeAnnouncements(announcementsList) {
        announcements = announcementsList;
        console.log(`wokemaps: Loaded ${announcements.length} announcements`);

        // Find and show active announcement
        const activeAnnouncement = findActiveAnnouncement(announcements);
        if (activeAnnouncement) {
            // Wait for page to be ready before showing
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    setTimeout(() => showAnnouncementBar(activeAnnouncement), 1000);
                });
            } else {
                setTimeout(() => showAnnouncementBar(activeAnnouncement), 1000);
            }
        } else {
            console.log("wokemaps: No active announcements to show");
        }
    }

    // Export the initialization function for use by main content script
    window.wokemapsAnnouncements = {
        initialize: initializeAnnouncements
    };

})();