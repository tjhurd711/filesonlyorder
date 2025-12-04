// Memorial Video AI - Analytics Display
// Shows processing stats below photo count

const AnalyticsDisplay = {

    /**
     * Initialize analytics display after photos are loaded
     * @param {string} uid - Order UID
     * @param {Array} photoOrder - Array of S3 keys
     */
    async init(uid, photoOrder) {
        try {
            // Fetch processing stats from pre_merge_data.json
            const processingStats = await this.fetchProcessingStats(uid);
            
            // Fetch presentation settings for years calculation
            const settingsData = await this.fetchPresentationSettings(uid);
            
            // Combine all stats
            const stats = {
                photoCount: photoOrder.length,
                ...processingStats,
                ...settingsData
            };
            
            // Calculate years of memories if we have dates
            stats.yearsOfMemories = this.calculateYearsOfMemories(stats);
            
            // Render the display
            this.render(stats);
            
        } catch (error) {
            console.log('[ANALYTICS] Could not load analytics:', error);
            // Fail silently - analytics is optional
        }
    },

    /**
     * Fetch processing stats from pre_merge_data.json
     */
    async fetchProcessingStats(uid) {
        try {
            const url = `https://order-by-age-uploads.s3.amazonaws.com/face-intermediate/${uid}/pre_merge_data.json`;
            const response = await fetch(url);
            
            if (!response.ok) return {};
            
            const data = await response.json();
            const stats = data.enhanced_processing_stats || {};
            
            return {
                totalPhotos: stats.total_photos || null,
                successfullyProcessed: stats.successfully_processed || null,
                totalFacesIndexed: stats.total_faces_indexed || null,
                qualifyingClusters: stats.qualifying_clusters || null,
                stragglerClusters: stats.straggler_clusters || null,
                singletonClusters: stats.singleton_clusters || null,
                similarityCacheSize: stats.similarity_cache_size || null
            };
        } catch (e) {
            console.log('[ANALYTICS] Could not fetch processing stats:', e.message);
            return {};
        }
    },

    /**
     * Fetch presentation settings (birth/death dates)
     */
    async fetchPresentationSettings(uid) {
        try {
            const url = `https://order-by-age-uploads.s3.amazonaws.com/metadata/${uid}/presentation_settings.json`;
            const response = await fetch(url);
            
            if (!response.ok) return {};
            
            const data = await response.json();
            
            return {
                birthdate: data.birthdate || null,
                deathdate: data.deathdate || null,
                deceasedName: data.deceased_first_name || data.deceased_full_name || null
            };
        } catch (e) {
            console.log('[ANALYTICS] Could not fetch presentation settings');
            return {};
        }
    },

    /**
     * Calculate years of memories from birth/death dates
     */
    calculateYearsOfMemories(stats) {
        if (stats.birthdate && stats.deathdate) {
            try {
                const birth = new Date(stats.birthdate);
                const death = new Date(stats.deathdate);
                const years = death.getFullYear() - birth.getFullYear();
                if (years > 0) return years;
            } catch (e) {}
        }
        return null;
    },

    /**
     * Calculate estimated manual sorting time
     * Assumes ~30 seconds per photo for a human to look at, compare, and place
     */
    calculateManualTime(photoCount) {
        if (!photoCount) return null;
        
        const secondsPerPhoto = 30;
        const totalSeconds = photoCount * secondsPerPhoto;
        const totalMinutes = Math.round(totalSeconds / 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        
        if (hours >= 1) {
            if (minutes === 0) {
                return `${hours} hour${hours > 1 ? 's' : ''}`;
            }
            return `${hours}.${Math.round(minutes / 6)} hours`; // .5 = 30 min, etc.
        }
        return `${totalMinutes} minutes`;
    },

    /**
     * Format large numbers with commas
     */
    formatNumber(num) {
        if (!num) return '0';
        return num.toLocaleString();
    },

    /**
     * Render the analytics display
     */
    render(stats) {
        // Don't render if we don't have meaningful data
        if (!stats.totalFacesIndexed && !stats.yearsOfMemories) {
            console.log('[ANALYTICS] Not enough data to display');
            return;
        }
        
        // Calculate derived stats
        const manualTime = this.calculateManualTime(stats.photoCount);
        const totalPeopleFound = (stats.qualifyingClusters || 0) + 
                                  (stats.stragglerClusters || 0) + 
                                  (stats.singletonClusters || 0);
        
        // Build headline - years of memories if available
        let headlineHtml = '';
        if (stats.yearsOfMemories) {
            headlineHtml = `
                <div class="analytics-headline">
                    <span class="analytics-icon">📸</span>
                    <span class="analytics-years">${stats.yearsOfMemories} years</span> of memories
                </div>
            `;
        }
        
        // Build the stats grid
        let statsHtml = '<div class="analytics-stats-grid">';
        
        // Stat 1: Faces analyzed
        if (stats.totalFacesIndexed) {
            statsHtml += `
                <div class="analytics-stat-card">
                    <div class="stat-value">${this.formatNumber(stats.totalFacesIndexed)}</div>
                    <div class="stat-label">Faces Analyzed</div>
                </div>
            `;
        }
        
        // Stat 2: Face comparisons made
        if (stats.similarityCacheSize) {
            statsHtml += `
                <div class="analytics-stat-card">
                    <div class="stat-value">${this.formatNumber(stats.similarityCacheSize)}</div>
                    <div class="stat-label">Face Comparisons</div>
                </div>
            `;
        }
        
        // Stat 3: People identified
        if (totalPeopleFound > 0) {
            statsHtml += `
                <div class="analytics-stat-card">
                    <div class="stat-value">${totalPeopleFound}</div>
                    <div class="stat-label">People Identified</div>
                </div>
            `;
        }
        
        statsHtml += '</div>';
        
        // Build time saved section
        let timeSavedHtml = '';
        if (manualTime && stats.photoCount) {
            timeSavedHtml = `
                <div class="analytics-time-saved">
                    <div class="time-saved-icon">⏱️</div>
                    <div class="time-saved-text">
                        <span class="time-saved-label">Estimated manual sorting time:</span>
                        <span class="time-saved-value">${manualTime}</span>
                    </div>
                    <div class="time-saved-subtext">We did it in seconds.</div>
                </div>
            `;
        }
        
        // Build technical summary
        let technicalHtml = '';
        if (stats.totalFacesIndexed && stats.photoCount) {
            technicalHtml = `
                <div class="analytics-technical">
                    Using facial recognition and AI matching, we analyzed ${stats.photoCount} photos, 
                    detected ${this.formatNumber(stats.totalFacesIndexed)} faces, and made 
                    ${this.formatNumber(stats.similarityCacheSize || 0)} comparisons to build your chronological timeline.
                </div>
            `;
        }
        
        const html = `
            <div class="analytics-box">
                ${headlineHtml}
                ${statsHtml}
                ${timeSavedHtml}
                ${technicalHtml}
            </div>
        `;
        
        // Insert after photo count, before download section
        const photoCountEl = document.querySelector('.photo-count');
        if (photoCountEl) {
            photoCountEl.insertAdjacentHTML('afterend', html);
        }
        
        console.log('[ANALYTICS] Rendered successfully');
    }
};
