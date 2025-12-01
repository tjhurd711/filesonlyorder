// Memorial Video AI - Sorted Photos Gallery
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

// === DOWNLOAD ALL ===
async function downloadAll() {
    const downloadBtn = document.getElementById('downloadBtn');
    const originalText = downloadBtn.querySelector('.btn-text').textContent;

    // Disable button and show loading state
    downloadBtn.disabled = true;
    downloadBtn.querySelector('.btn-text').textContent = 'Preparing download...';

    try {
        // TODO: Call Lambda to generate zip
        // For now, show alert with the order
        console.log('[DOWNLOAD] Current photo order:', photoOrder);

        alert(`Download feature coming soon!\n\nYour ${photoOrder.length} photos will be downloaded as a zip file with names like 001.jpg, 003.jpg, 006.jpg, etc.\n\nThe order you've arranged will be preserved.`);

        /*
        // Future implementation:
        const response = await fetch('https://your-api-gateway/generate-zip', {
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
            throw new Error('Failed to generate zip');
        }

        const { download_url } = await response.json();
        window.location.href = download_url;
        */

    } catch (error) {
        console.error('[DOWNLOAD ERROR]', error);
        alert('Failed to prepare download. Please try again.');
    } finally {
        // Re-enable button
        downloadBtn.disabled = false;
        downloadBtn.querySelector('.btn-text').textContent = originalText;
    }
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
