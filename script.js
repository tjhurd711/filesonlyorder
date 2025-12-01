// Memorial Video AI - Sorted Photos Gallery
// https://filesonlyorder.memorialvideo.ai/
// Handles fetching photos, displaying gallery, drag-and-drop reordering, and download

// === CONFIGURATION ===
const S3_BUCKET = 'order-by-age-uploads';
const S3_BASE_URL = `https://${S3_BUCKET}.s3.amazonaws.com`;

// === STATE ===
let photoOrder = []; // Array of S3 keys in current order
let uid = null;

// === INITIALIZATION ===
window.addEventListener('DOMContentLoaded', async () => {
    // Get UID from URL
    const urlParams = new URLSearchParams(window.location.search);
    uid = urlParams.get('uid');

    if (!uid) {
        showError('No order ID provided. Please check your link.');
        return;
    }

    console.log(`[INIT] Loading photos for UID: ${uid}`);

    try {
        await loadPhotos();
    } catch (error) {
        console.error('[ERROR] Failed to load photos:', error);
        showError('Failed to load photos. Please try again or contact support.', error.message);
    }
});

// === LOAD PHOTOS ===
async function loadPhotos() {
    showLoading(true);

    // Fetch the manifest file
    const manifestUrl = `${S3_BASE_URL}/metadata/${uid}/final_filenames.json`;
    console.log(`[FETCH] Loading manifest from: ${manifestUrl}`);

    const response = await fetch(manifestUrl);

    if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
    }

    const manifest = await response.json();
    console.log(`[MANIFEST] Loaded ${manifest.length} entries`);

    // Extract the final keys (renamed photos) and sort by filename
    // Files are named like: 01-05(003)_|EX|_x_photo.jpg
    // We want to sort by the age bucket and rank
    const photoEntries = manifest
        .filter(entry => entry.final_key && !entry.final_key.endsWith('.ready'))
        .map(entry => ({
            s3Key: entry.final_key,
            filename: entry.final_key.split('/').pop(),
            originalFilename: extractOriginalFilename(entry.final_key)
        }))
        .sort((a, b) => a.filename.localeCompare(b.filename));

    console.log(`[PHOTOS] Sorted ${photoEntries.length} photos`);

    // Store the initial order
    photoOrder = photoEntries.map(entry => entry.s3Key);

    // Render the gallery
    renderGallery(photoEntries);

    // Initialize drag-and-drop
    initializeSortable();

    // Update photo count
    document.getElementById('photoCount').textContent = photoEntries.length;

    // Show bottom download button if many photos
    if (photoEntries.length > 20) {
        document.getElementById('bottomDownload').style.display = 'block';
    }

    showLoading(false);
}

// === EXTRACT ORIGINAL FILENAME ===
function extractOriginalFilename(s3Key) {
    // s3Key looks like: enhanced/uid/renamed/01-05(003)_|EX|_x_originalname.jpg
    // We want to extract just "originalname.jpg"
    
    const filename = s3Key.split('/').pop();
    
    // Pattern: age-bucket(rank)_|method|_suffix_originalname.ext
    // We need to strip everything before the actual original filename
    
    // Find the last underscore-separated part that's the original name
    // The format is: 01-05(003)_|EX|_x_originalname.jpg or 01-05(003)_|EX|_originalname.jpg
    
    // Split by underscore and find where the original filename starts
    const parts = filename.split('_');
    
    // The original filename is everything after the method marker |XX|
    // Find the index after the |...| pattern
    let startIndex = 0;
    for (let i = 0; i < parts.length; i++) {
        if (parts[i].startsWith('|') && parts[i].endsWith('|')) {
            startIndex = i + 1;
            break;
        }
    }
    
    // Check if there's an 'x' suffix (EXIF override marker)
    if (parts[startIndex] === 'x') {
        startIndex++;
    }
    
    // Join remaining parts as the original filename
    return parts.slice(startIndex).join('_');
}

// === RENDER GALLERY ===
function renderGallery(photoEntries) {
    const gallery = document.getElementById('photoGallery');
    gallery.innerHTML = '';

    photoEntries.forEach((entry, index) => {
        const photoItem = document.createElement('div');
        photoItem.className = 'photo-item loading';
        photoItem.dataset.s3Key = entry.s3Key;
        photoItem.dataset.index = index;

        // Calculate display number (incrementing by 3)
        const displayNumber = (index + 1) * 3 - 2; // 1, 4, 7, 10... wait, should be 001, 003, 006
        // Actually: position 0 = 001, position 1 = 003, position 2 = 006, etc.
        // So: (index * 3) + 1 but padded... wait let me recalculate
        // We want: 001, 003, 006, 009... which is (index * 3) + 1 for 1-indexed but showing 001, 004, 007
        // Hmm, actually for 001, 003, 006: that's 1, 3, 6 = not linear
        // Let me just do simple: 001, 002, 003 for display, actual filename will be 001, 003, 006
        const displayNum = String(index + 1).padStart(3, '0');

        photoItem.innerHTML = `
            <div class="photo-number">${displayNum}</div>
            <img src="${S3_BASE_URL}/${entry.s3Key}" 
                 alt="Photo ${index + 1}" 
                 loading="lazy"
                 onload="this.parentElement.classList.remove('loading')"
                 onerror="handleImageError(this)">
        `;

        gallery.appendChild(photoItem);
    });
}

// === HANDLE IMAGE ERROR ===
function handleImageError(img) {
    console.error('[IMAGE ERROR] Failed to load:', img.src);
    img.parentElement.classList.remove('loading');
    img.src = 'data:image/svg+xml,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">
            <rect fill="#f0f0f0" width="150" height="150"/>
            <text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#999" font-family="sans-serif" font-size="14">
                Failed to load
            </text>
        </svg>
    `);
}

// === INITIALIZE SORTABLE (DRAG AND DROP) ===
function initializeSortable() {
    const gallery = document.getElementById('photoGallery');

    new Sortable(gallery, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        
        onEnd: function(evt) {
            const oldIndex = evt.oldIndex;
            const newIndex = evt.newIndex;

            if (oldIndex !== newIndex) {
                // Update the photoOrder array
                const [movedItem] = photoOrder.splice(oldIndex, 1);
                photoOrder.splice(newIndex, 0, movedItem);

                // Update display numbers
                updateDisplayNumbers();

                console.log(`[REORDER] Moved photo from position ${oldIndex + 1} to ${newIndex + 1}`);
            }
        }
    });

    console.log('[SORTABLE] Drag-and-drop initialized');
}

// === UPDATE DISPLAY NUMBERS AFTER REORDER ===
function updateDisplayNumbers() {
    const photoItems = document.querySelectorAll('.photo-item');
    
    photoItems.forEach((item, index) => {
        const numberBadge = item.querySelector('.photo-number');
        if (numberBadge) {
            numberBadge.textContent = String(index + 1).padStart(3, '0');
        }
        item.dataset.index = index;
    });
}

// === CONFIGURATION - ZIP LAMBDA ===
const ZIP_LAMBDA_URL = 'https://cstueckloguxc24v6kshrxfn3y0oifhc.lambda-url.us-east-2.on.aws/';

// === DOWNLOAD ALL ===
async function downloadAll() {
    const downloadBtn = document.getElementById('downloadBtn');
    const originalText = downloadBtn.querySelector('.btn-text').textContent;

    // Disable all download buttons and show loading state
    const allDownloadBtns = document.querySelectorAll('.download-btn');
    allDownloadBtns.forEach(btn => {
        btn.disabled = true;
        const btnText = btn.querySelector('.btn-text');
        if (btnText) btnText.textContent = 'Preparing download...';
    });

    try {
        console.log('[DOWNLOAD] Starting zip generation for', photoOrder.length, 'photos');
        console.log('[DOWNLOAD] Photo order:', photoOrder);

        const response = await fetch(ZIP_LAMBDA_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uid: uid,
                photo_order: photoOrder
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        const result = await response.json();
        console.log('[DOWNLOAD] Lambda response:', result);

        if (result.success && result.download_url) {
            // Show success message
            showDownloadSuccess(result.photo_count, result.email_sent);
            
            // Trigger download
            console.log('[DOWNLOAD] Starting download from:', result.download_url);
            window.location.href = result.download_url;
        } else {
            throw new Error(result.error || 'Failed to generate download link');
        }

    } catch (error) {
        console.error('[DOWNLOAD ERROR]', error);
        showDownloadError(error.message);
    } finally {
        // Re-enable all download buttons
        allDownloadBtns.forEach(btn => {
            btn.disabled = false;
            const btnText = btn.querySelector('.btn-text');
            if (btnText) btnText.textContent = originalText;
        });
    }
}

// === DOWNLOAD SUCCESS MESSAGE ===
function showDownloadSuccess(photoCount, emailSent) {
    // Create full-screen thank you overlay
    const overlay = document.createElement('div');
    overlay.className = 'thank-you-overlay';
    overlay.innerHTML = `
        <div class="thank-you-content">
            <div class="thank-you-icon">✅</div>
            <h2>Download Started!</h2>
            <p class="thank-you-main">${photoCount} photos are being downloaded as a zip file.</p>
            ${emailSent ? '<p class="thank-you-email">A backup download link has also been emailed to you.</p>' : ''}
            
            <div class="thank-you-info">
                <p><strong>Your files are named:</strong></p>
                <p class="file-naming">001.jpg, 004.jpg, 007.jpg, 010.jpg...</p>
                <p class="file-note">This numbering allows you to easily insert additional photos between existing ones in your slideshow software.</p>
            </div>
            
            <div class="thank-you-actions">
                <button class="btn-close-overlay" onclick="closeThankYou()">Close</button>
                <button class="btn-redownload" onclick="downloadAll()">Download Again</button>
            </div>
            
            <p class="thank-you-support">Questions? Contact us at <a href="mailto:team@memorialvideo.ai">team@memorialvideo.ai</a></p>
        </div>
    `;
    
    // Add styles if not already present
    if (!document.getElementById('thank-you-styles')) {
        const styles = document.createElement('style');
        styles.id = 'thank-you-styles';
        styles.textContent = `
            .thank-you-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.85);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 2000;
                animation: fadeIn 0.3s ease-out;
            }
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            .thank-you-content {
                background: white;
                border-radius: 16px;
                padding: 40px 50px;
                max-width: 500px;
                text-align: center;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                animation: slideUp 0.3s ease-out;
            }
            @keyframes slideUp {
                from { transform: translateY(30px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            .thank-you-icon {
                font-size: 60px;
                margin-bottom: 20px;
            }
            .thank-you-content h2 {
                color: #1e3c72;
                font-size: 28px;
                margin: 0 0 15px 0;
            }
            .thank-you-main {
                font-size: 18px;
                color: #333;
                margin: 0 0 10px 0;
            }
            .thank-you-email {
                font-size: 14px;
                color: #666;
                margin: 0 0 25px 0;
            }
            .thank-you-info {
                background: #f8f9fa;
                border-radius: 10px;
                padding: 20px;
                margin: 20px 0;
            }
            .thank-you-info p {
                margin: 5px 0;
                color: #555;
            }
            .file-naming {
                font-family: monospace;
                font-size: 16px;
                color: #1e3c72 !important;
                font-weight: bold;
            }
            .file-note {
                font-size: 13px;
                color: #777 !important;
                margin-top: 10px !important;
            }
            .thank-you-actions {
                display: flex;
                gap: 15px;
                justify-content: center;
                margin: 25px 0;
            }
            .btn-close-overlay {
                padding: 12px 30px;
                background: #1e3c72;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
            }
            .btn-close-overlay:hover {
                background: #2a5298;
                transform: translateY(-2px);
            }
            .btn-redownload {
                padding: 12px 30px;
                background: white;
                color: #1e3c72;
                border: 2px solid #1e3c72;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
            }
            .btn-redownload:hover {
                background: #f0f4f8;
                transform: translateY(-2px);
            }
            .thank-you-support {
                font-size: 13px;
                color: #888;
                margin: 0;
            }
            .thank-you-support a {
                color: #1e3c72;
                text-decoration: none;
            }
            .thank-you-support a:hover {
                text-decoration: underline;
            }
        `;
        document.head.appendChild(styles);
    }
    
    document.body.appendChild(overlay);
    
    // Store reference for closing
    window.currentThankYouOverlay = overlay;
}

// === CLOSE THANK YOU SCREEN ===
function closeThankYou() {
    if (window.currentThankYouOverlay) {
        window.currentThankYouOverlay.remove();
        window.currentThankYouOverlay = null;
    }
}

// === DOWNLOAD ERROR MESSAGE ===
function showDownloadError(message) {
    const banner = document.createElement('div');
    banner.className = 'success-banner error-banner';
    banner.innerHTML = `
        <div class="success-content">
            <span class="success-icon">❌</span>
            <div class="success-text">
                <strong>Download failed</strong>
                <p>${message || 'Please try again or contact support.'}</p>
            </div>
            <button class="success-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    
    document.body.appendChild(banner);
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
        if (banner.parentElement) {
            banner.remove();
        }
    }, 10000);
}

// === UI HELPERS ===
function showLoading(show) {
    const loadingState = document.getElementById('loadingState');
    const galleryContainer = document.querySelector('.gallery-container');
    const downloadSection = document.querySelector('.download-section');

    if (show) {
        loadingState.style.display = 'block';
        galleryContainer.style.display = 'none';
        downloadSection.style.display = 'none';
    } else {
        loadingState.style.display = 'none';
        galleryContainer.style.display = 'block';
        downloadSection.style.display = 'block';
    }
}

function showError(message, detail = '') {
    const loadingState = document.getElementById('loadingState');
    const errorState = document.getElementById('errorState');
    const errorDetail = document.getElementById('errorDetail');
    const galleryContainer = document.querySelector('.gallery-container');
    const downloadSection = document.querySelector('.download-section');

    loadingState.style.display = 'none';
    galleryContainer.style.display = 'none';
    downloadSection.style.display = 'none';

    errorState.style.display = 'block';
    if (detail) {
        errorDetail.textContent = detail;
    }
}
