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
            // Calculate what we can from filenames
            const filenameStats = this.parseFilenames(photoOrder);
            
            // Fetch additional data (birth/death dates, face count)
            const [settingsData, processingStats] = await Promise.all([
                this.fetchPresentationSettings(uid),
                this.fetchProcessingStats(uid)
            ]);
            
            // Combine all stats
            const stats = {
                photoCount: photoOrder.length,
                ...filenameStats,
                ...settingsData,
                ...processingStats
            };
            
            // Calculate years of memories
            stats.yearsOfMemories = this.calculateYearsOfMemories(stats);
            
            // Render the display
            this.render(stats);
            
        } catch (error) {
            console.log('[ANALYTICS] Could not load analytics:', error);
            // Fail silently - analytics is optional
        }
    },

    /**
     * Parse filenames to extract age range
     */
    parseFilenames(photoOrder) {
        const AGE_BUCKETS = {
            '01-05': { min: 0, max: 5, label: 'Early Childhood' },
            '06-10': { min: 6, max: 10, label: 'Childhood' },
            '11-15': { min: 11, max: 15, label: 'Preteen' },
            '16-20': { min: 16, max: 20, label: 'Teen Years' },
            '21-30': { min: 21, max: 30, label: 'Twenties' },
            '31-40': { min: 31, max: 40, label: 'Thirties' },
            '41-50': { min: 41, max: 50, label: 'Forties' },
            '51-60': { min: 51, max: 60, label: 'Fifties' },
            '61-70': { min: 61, max: 70, label: 'Sixties' },
            '71-80': { min: 71, max: 80, label: 'Seventies' },
            '81+': { min: 81, max: 100, label: 'Eighties+' }
        };
        
        const bucketOrder = Object.keys(AGE_BUCKETS);
        const foundBuckets = new Set();
        
        // Extract age buckets from filenames
        photoOrder.forEach(key => {
            const filename = key.split('/').pop();
            const match = filename.match(/^(\d{2}-\d{2}|\d{2}\+)/);
            if (match && AGE_BUCKETS[match[1]]) {
                foundBuckets.add(match[1]);
            }
        });
        
        if (foundBuckets.size === 0) {
            return { ageRangeLabel: null, youngestLabel: null, oldestLabel: null };
        }
        
        // Find youngest and oldest
        const sortedBuckets = Array.from(foundBuckets).sort((a, b) => {
            return bucketOrder.indexOf(a) - bucketOrder.indexOf(b);
        });
        
        const youngest = sortedBuckets[0];
        const oldest = sortedBuckets[sortedBuckets.length - 1];
        
        return {
            youngestBucket: youngest,
            oldestBucket: oldest,
            youngestLabel: AGE_BUCKETS[youngest].label,
            oldestLabel: AGE_BUCKETS[oldest].label,
            ageRangeLabel: `${AGE_BUCKETS[youngest].label} → ${AGE_BUCKETS[oldest].label}`
        };
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
     * Fetch processing stats (face detection count)
     */
    async fetchProcessingStats(uid) {
        try {
            // Try the intermediate data file
            const url = `https://order-by-age-uploads.s3.amazonaws.com/face-intermediate/${uid}/pre_merge_data.json`;
            const response = await fetch(url);
            
            if (!response.ok) return {};
            
            const data = await response.json();
            const stats = data.enhanced_processing_stats || {};
            
            return {
                totalFacesIndexed: stats.total_faces_indexed || null,
                totalPhotosProcessed: stats.total_photos || null
            };
        } catch (e) {
            console.log('[ANALYTICS] Could not fetch processing stats');
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
     * Render the analytics display
     */
    render(stats) {
        // Don't render if we don't have meaningful data
        if (!stats.yearsOfMemories && !stats.ageRangeLabel) {
            console.log('[ANALYTICS] Not enough data to display');
            return;
        }
        
        // Build the content
        let yearsLine = '';
        if (stats.yearsOfMemories) {
            yearsLine = `<div class="analytics-headline">
                <span class="analytics-icon">📸</span>
                <span class="analytics-years">${stats.yearsOfMemories} years</span> of memories
            </div>`;
        }
        
        let ageRangeLine = '';
        if (stats.ageRangeLabel) {
            ageRangeLine = `<div class="analytics-age-range">${stats.ageRangeLabel}</div>`;
        }
        
        // Build technical summary
        let technicalLine = '';
        const photoCount = stats.photoCount || stats.totalPhotosProcessed;
        const faceCount = stats.totalFacesIndexed;
        
        if (photoCount && faceCount) {
            technicalLine = `<div class="analytics-technical">
                Using facial recognition and age estimation, we processed ${photoCount} photos across ${faceCount.toLocaleString()} face detections to build this timeline.
            </div>`;
        } else if (photoCount) {
            technicalLine = `<div class="analytics-technical">
                Using facial recognition and age estimation, we analyzed ${photoCount} photos to build this timeline.
            </div>`;
        }
        
        const html = `
            <div class="analytics-box">
                ${yearsLine}
                ${ageRangeLine}
                ${technicalLine}
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
