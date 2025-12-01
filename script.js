// Memorial Video AI - Sorted Photos Gallery
// https://filesonlyorder.memorialvideo.ai/
// Handles fetching photos, displaying gallery, drag-and-drop reordering, and download

// === CONFIGURATION ===
const S3_BUCKET = 'order-by-age-uploads';
const S3_BASE_URL = `https://${S3_BUCKET}.s3.amazonaws.com`;

// === CONFIGURATION - LAMBDAS ===
const ZIP_LAMBDA_URL = 'https://cstueckloguxc24v6kshrxfn3y0oifhc.lambda-url.us-east-2.on.aws/';
const DELETE_LAMBDA_URL = 'https://d3fcunfwhpv4dhopus6lylkiam0dyabo.lambda-url.us-east-2.on.aws/';

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

    // First, check if there's a QA-reviewed custom order
    const customOrder = await loadCustomOrder();
    
    let photoEntries;
    
    if (customOrder) {
        // Use QA-reviewed order (no sorting - use exact array order)
        console.log(`[CUSTOM ORDER] Using QA-reviewed order with ${customOrder.length} photos`);
        
        photoEntries = customOrder.map(s3Key => ({
            s3Key: s3Key,
            filename: s3Key.split('/').pop(),
            originalFilename: extractOriginalFilename(s3Key)
        }));
    } else {
        // Fall back to manifest + alphabetical filename sort
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
        photoEntries = manifest
            .filter(entry => entry.final_key && !entry.final_key.endsWith('.ready'))
            .map(entry => ({
                s3Key: entry.final_key,
                filename: entry.final_key.split('/').pop(),
                originalFilename: extractOriginalFilename(entry.final_key)
            }))
            .sort((a, b) => a.filename.localeCompare(b.filename));

        console.log(`[PHOTOS] Sorted ${photoEntries.length} photos (no custom order found)`);
    }

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

// === LOAD CUSTOM ORDER (QA-REVIEWED) ===
async function loadCustomOrder() {
    try {
        const customOrderUrl = `${S3_BASE_URL}/metadata/${uid}/custom_order.json`;
        console.log(`[FETCH] Checking for custom order: ${customOrderUrl}`);
        
        const response = await fetch(customOrderUrl);
        
        if (response.ok) {
            const data = await response.json();
            console.log(`[CUSTOM ORDER] Found QA-reviewed order from ${data.updated_at}`);
            return data.order;
        } else {
            console.log(`[CUSTOM ORDER] No custom order found (${response.status})`);
        }
    } catch (e) {
        console.log(`[CUSTOM ORDER] Error loading custom order:`, e.message);
    }
    return null;
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

        const displayNum = String(index + 1).padStart(3, '0');

        photoItem.innerHTML = `
            <div class="photo-number">${displayNum}</div>
            <button class="delete-btn" onclick="deletePhoto('${entry.s3Key}', this)" title="Delete photo">×</button>
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

// === DELETE PHOTO ===
async function deletePhoto(s3Key, buttonElement) {
    // Confirm deletion
    if (!confirm('Are you sure you want to delete this photo? This cannot be undone.')) {
        return;
    }

    const photoItem = buttonElement.closest('.photo-item');
    
    // Show deleting state
    photoItem.classList.add('deleting');
    buttonElement.disabled = true;
    buttonElement.textContent = '...';

    try {
        console.log('[DELETE] Deleting photo:', s3Key);

        const response = await fetch(DELETE_LAMBDA_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uid: uid,
                s3_key: s3Key
            })
        });

        // Try to parse response, but don't fail if CORS blocks it
        let result = { success: true };
        try {
            result = await response.json();
        } catch (e) {
            // CORS might block reading response, but request likely succeeded
            console.log('[DELETE] Could not parse response (CORS), assuming success');
        }

        console.log('[DELETE] Result:', result);

        // Remove from photoOrder array
        const index = photoOrder.indexOf(s3Key);
        if (index > -1) {
            photoOrder.splice(index, 1);
        }

        // Remove from DOM with animation
        photoItem.style.transform = 'scale(0)';
        photoItem.style.opacity = '0';
        
        setTimeout(() => {
            photoItem.remove();
            // Update display numbers
            updateDisplayNumbers();
            // Update photo count
            document.getElementById('photoCount').textContent = photoOrder.length;
        }, 300);

    } catch (error) {
        console.error('[DELETE ERROR]', error);
        
        // Check if it's a CORS error - the delete might have still worked
        if (error.message.includes('CORS') || error.message.includes('NetworkError')) {
            console.log('[DELETE] CORS error, but delete may have succeeded. Removing from UI.');
            
            // Remove from photoOrder array
            const index = photoOrder.indexOf(s3Key);
            if (index > -1) {
                photoOrder.splice(index, 1);
            }

            // Remove from DOM
            photoItem.style.transform = 'scale(0)';
            photoItem.style.opacity = '0';
            
            setTimeout(() => {
                photoItem.remove();
                updateDisplayNumbers();
                document.getElementById('photoCount').textContent = photoOrder.length;
            }, 300);
        } else {
            alert(`Failed to delete photo: ${error.message}`);
            
            // Reset button
            photoItem.classList.remove('deleting');
            buttonElement.disabled = false;
            buttonElement.textContent = '×';
        }
    }
}
