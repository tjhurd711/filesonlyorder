// Memorial Video AI - Analytics Display
// Shows processing stats below photo count

const AnalyticsDisplay = {
    
    // Age bucket definitions
    AGE_BUCKETS: {
        '01-05': { label: '0-5', shortLabel: '0-5' },
        '06-10': { label: '6-10', shortLabel: '6-10' },
        '11-15': { label: '11-15', shortLabel: '11-15' },
        '16-20': { label: '16-20', shortLabel: '16-20' },
        '21-30': { label: '21-30', shortLabel: '21-30' },
        '31-40': { label: '31-40', shortLabel: '31-40' },
        '41-50': { label: '41-50', shortLabel: '41-50' },
        '51-60': { label: '51-60', shortLabel: '51-60' },
        '61-70': { label: '61-70', shortLabel: '61-70' },
        '71-80': { label: '71-80', shortLabel: '71-80' },
        '81+': { label: '81+', shortLabel: '81+' }
    },

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
     * Parse filenames to extract age range and distribution
     */
    parseFilenames(photoOrder) {
        const bucketOrder = Object.keys(this.AGE_BUCKETS);
        const bucketCounts = {};
        
        // Initialize counts
        bucketOrder.forEach(bucket => {
            bucketCounts[bucket] = 0;
        });
        
        // Count photos per bucket
        photoOrder.forEach(key => {
            const filename = key.split('/').pop();
            const match = filename.match(/^(\d{2}-\d{2}|\d{2}\+)/);
            if (match && this.AGE_BUCKETS[match[1]]) {
                bucketCounts[match[1]]++;
            }
        });
        
        // Find buckets with photos
        const bucketsWithPhotos = bucketOrder.filter(b => bucketCounts[b] > 0);
        
        if (bucketsWithPhotos.length === 0) {
            return { ageRangeLabel: null, bucketCounts: null };
        }
        
        const youngest = bucketsWithPhotos[0];
        const oldest = bucketsWithPhotos[bucketsWithPhotos.length - 1];
        
        return {
            bucketCounts: bucketCounts,
            youngestBucket: youngest,
            oldestBucket: oldest,
            ageRangeLabel: `${this.AGE_BUCKETS[youngest].label} → ${this.AGE_BUCKETS[oldest].label}`
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
        
        // Build the mini bar chart
        let chartHtml = '';
        if (stats.bucketCounts) {
            chartHtml = this.renderBarChart(stats.bucketCounts);
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
                ${chartHtml}
                ${technicalLine}
            </div>
        `;
        
        // Insert after photo count, before download section
        const photoCountEl = document.querySelector('.photo-count');
        if (photoCountEl) {
            photoCountEl.insertAdjacentHTML('afterend', html);
        }
        
        console.log('[ANALYTICS] Rendered successfully');
    },

    /**
     * Render the mini bar chart
     */
    renderBarChart(bucketCounts) {
        const bucketOrder = Object.keys(this.AGE_BUCKETS);
        
        // Only include buckets that have photos
        const activeBuckets = bucketOrder.filter(b => bucketCounts[b] > 0);
        
        if (activeBuckets.length === 0) return '';
        
        const maxCount = Math.max(...activeBuckets.map(b => bucketCounts[b]));
        
        const barsHtml = activeBuckets.map(bucket => {
            const count = bucketCounts[bucket];
            const percentage = Math.max(8, (count / maxCount) * 100); // Min 8% for visibility
            const label = this.AGE_BUCKETS[bucket].shortLabel;
            
            return `
                <div class="analytics-bar-item">
                    <div class="analytics-bar-label">${label}</div>
                    <div class="analytics-bar-track">
                        <div class="analytics-bar-fill" style="width: ${percentage}%">
                            <span class="analytics-bar-count">${count}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        return `
            <div class="analytics-chart">
                <div class="analytics-chart-title">Photos by Age</div>
                <div class="analytics-bars">
                    ${barsHtml}
                </div>
            </div>
        `;
    }
};
