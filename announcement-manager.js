// Announcement Manager
// Handles displaying dismissible announcements at the top of Google Maps

class AnnouncementManager {
    constructor(announcements = []) {
        this.DISMISSAL_STORAGE_KEY = 'wokemaps_announcement_dismissals';
        this.announcementBar = null;
        this.announcements = announcements;
        this.currentAnnouncement = null;

        log.info('init', `Loaded ${this.announcements.length} announcements`);

        // Start the announcement process
        this.showActiveAnnouncement();
    }

    // Load dismissal state from Chrome storage
    async loadDismissalState() {
        try {
            const result = await chrome.storage.sync.get([this.DISMISSAL_STORAGE_KEY]);
            if (result[this.DISMISSAL_STORAGE_KEY]) {
                return result[this.DISMISSAL_STORAGE_KEY].latestDismissal || null;
            }
        } catch (e) {
            log.warn('init', "Failed to load dismissal state:", e);
        }
        return null;
    }

    // Save dismissal state to Chrome storage
    async saveDismissalState(timestamp) {
        try {
            const state = {
                latestDismissal: timestamp
            };
            await chrome.storage.sync.set({ [this.DISMISSAL_STORAGE_KEY]: state });
        } catch (e) {
            log.warn('init', "Failed to save dismissal state:", e);
        }
    }

    // Find the first non-dismissed announcement that should be shown
    async findActiveAnnouncement(announcements) {
        if (!announcements || !Array.isArray(announcements) || announcements.length === 0) {
            return null;
        }

        const now = new Date();
        const latestDismissal = await this.loadDismissalState();
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
                log.warn('init', "Invalid announcement data:", announcement, e);
                continue;
            }
        }

        return null;
    }

    // Create the announcement bar HTML
    createAnnouncementBar(announcement) {
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
    showAnnouncementBar(announcement) {
        if (this.announcementBar) {
            return; // Already showing
        }

        this.announcementBar = this.createAnnouncementBar(announcement);
        this.currentAnnouncement = announcement;

        // Add to DOM
        document.body.appendChild(this.announcementBar);

        // Add event listener for close button
        const closeButton = this.announcementBar.querySelector('.wokemaps-announcement-close');
        closeButton.addEventListener('click', () => this.dismissAnnouncement());

        // Trigger slide-down animation after a brief delay
        setTimeout(() => {
            this.announcementBar.classList.add('show');
        }, 100);

        log.info('ui', "Showing announcement:", announcement.contents);
    }

    // Dismiss the current announcement
    async dismissAnnouncement() {
        if (!this.announcementBar || !this.currentAnnouncement) {
            return;
        }

        // Save dismissal timestamp
        await this.saveDismissalState(new Date().toISOString());

        // Animate out
        this.announcementBar.classList.remove('show');

        // Remove from DOM after animation
        setTimeout(() => {
            if (this.announcementBar && this.announcementBar.parentNode) {
                this.announcementBar.parentNode.removeChild(this.announcementBar);
            }
            this.announcementBar = null;
            this.currentAnnouncement = null;
        }, 300);

        log.info('ui', "Announcement dismissed");
    }

    // Show active announcement if one exists
    async showActiveAnnouncement() {
        const activeAnnouncement = await this.findActiveAnnouncement(this.announcements);
        if (activeAnnouncement) {
            // Wait for page to be ready before showing
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    setTimeout(() => this.showAnnouncementBar(activeAnnouncement), 1000);
                });
            } else {
                setTimeout(() => this.showAnnouncementBar(activeAnnouncement), 1000);
            }
        } else {
            log.info('init', "No active announcements to show");
        }
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.AnnouncementManager = AnnouncementManager;
}
