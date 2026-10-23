const DELETE_LABEL = '🗑️ Delete';

// Read the server URL from the form: adds http:// when no protocol is given
// and strips trailing slashes. Returns '' when the field is empty.
function getServerUrl() {
    let url = document.getElementById('embyServerUrl').value.trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) {
        url = 'http://' + url;
    }
    return url.replace(/\/+$/, '');
}

async function findDuplicates() {
    const embyServerUrl = getServerUrl();
    const apiKey = document.getElementById('apiKey').value;
    const resultsDiv = document.getElementById('results');
    const loadingOverlay = document.getElementById('loading-overlay');

    if (!embyServerUrl) {
        resultsDiv.innerHTML = '<p>Error: Please enter an Emby Server URL first</p>';
        return;
    }

    resultsDiv.innerHTML = '';
    loadingOverlay.classList.remove('hidden');

    try {
        const libraries = await fetchLibraries(embyServerUrl, apiKey);
        const movieLibraries = libraries.filter(lib => lib.CollectionType === 'movies');
        const duplicateResults = [];

        for (const library of movieLibraries) {
            const movies = await fetchMoviesFromLibrary(embyServerUrl, apiKey, library.ItemId);
            const duplicates = findDuplicatesInLibrary(movies);
            if (Object.keys(duplicates).length > 0) {
                duplicateResults.push({
                    libraryName: library.Name,
                    duplicates: duplicates,
                    count: Object.keys(duplicates).length
                });
            }
        }

        displayResults(duplicateResults);
    } catch (error) {
        resultsDiv.innerHTML = `<p>Error: ${error.message}</p>`;
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}

async function fetchLibraries(embyServerUrl, apiKey) {
    const response = await fetch(`${embyServerUrl}/emby/Library/VirtualFolders`, {
        headers: { 'X-Emby-Token': apiKey }
    });
    if (!response.ok) throw new Error('Failed to fetch libraries');
    return await response.json();
}

async function fetchMoviesFromLibrary(embyServerUrl, apiKey, libraryId) {
    const response = await fetch(`${embyServerUrl}/emby/Items?Recursive=true&ParentId=${libraryId}&IncludeItemTypes=Movie&Fields=Path,ProductionYear,RunTimeTicks,MediaSources,MediaStreams`, {
        headers: { 'X-Emby-Token': apiKey }
    });
    if (!response.ok) throw new Error(`Failed to fetch movies from library ${libraryId}`);
    const data = await response.json();
    return data.Items || [];
}

async function refreshLibrary() {
    const embyServerUrl = getServerUrl();
    const apiKey = document.getElementById('apiKey').value;
    const loadingOverlay = document.getElementById('loading-overlay');
    const resultsDiv = document.getElementById('results');

    if (!embyServerUrl) {
        resultsDiv.innerHTML = '<p>Error: Please enter an Emby Server URL first</p>';
        return;
    }

    loadingOverlay.classList.remove('hidden');
    resultsDiv.innerHTML = '';

    try {
        const response = await fetch(`${embyServerUrl}/emby/Library/Refresh`, {
            method: 'POST',
            headers: {
                'X-Emby-Token': apiKey
            }
        });

        if (!response.ok) {
            throw new Error('Failed to refresh library');
        }

        resultsDiv.innerHTML = '<p>Library refresh triggered successfully!</p>';
    } catch (error) {
        resultsDiv.innerHTML = `<p>Error: ${error.message}</p>`;
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}

function findDuplicatesInLibrary(movies) {
    const duplicates = {};

    movies.forEach(movie => {
        const name = movie.Name;
        const year = movie.ProductionYear;
        const path = movie.Path;
        
        if (!name) return;

        // An item with several MediaSources holds versions merged by Emby:
        // each version is listed as its own entry so it can be compared
        const sources = (movie.MediaSources && movie.MediaSources.length > 0)
            ? movie.MediaSources
            : [{ Path: path, Size: 0, MediaStreams: movie.MediaStreams }];
        const mergedVersions = sources.length > 1 ? sources.length : 0;

        // Extract year from path if available (more reliable than metadata for remakes)
        let pathYear = null;
        if (path) {
            // Look for year in various formats in the path
            const pathYearMatch = path.match(/[\\/\(\[\s](\d{4})[\)\]\s\.\-_]/);
            if (pathYearMatch) {
                pathYear = parseInt(pathYearMatch[1]);
            }
        }

        // Use path year if it exists and differs from metadata year, otherwise use metadata year
        const effectiveYear = (pathYear && pathYear !== year && pathYear >= 1900 && pathYear <= new Date().getFullYear()) ? pathYear : year;

        // Create a more specific key using EXACT name match + year
        // This prevents different movies from being grouped together
        const exactKey = `${name.trim()}_${effectiveYear || 'unknown'}`;
        
        if (!duplicates[exactKey]) duplicates[exactKey] = [];
        sources.forEach(source => {
            // Get resolution from the version's MediaStreams (item level as fallback)
            let resolution = 'Unknown';
            let width = 0;
            let height = 0;
            const streams = (source.MediaStreams && source.MediaStreams.length > 0)
                ? source.MediaStreams
                : (!mergedVersions && movie.MediaStreams) || [];
            const videoStream = streams.find(stream => stream.Type === 'Video');
            if (videoStream && videoStream.Width && videoStream.Height) {
                width = videoStream.Width;
                height = videoStream.Height;
                resolution = `${width}x${height}`;
            }

            duplicates[exactKey].push({
                path: source.Path || path,
                year,
                size: source.Size || 0,
                resolution,
                width,
                height,
                originalName: name.trim(),
                itemId: movie.Id,
                mergedVersions,
                effectiveYear: effectiveYear,
                exactKey: exactKey
            });
        });
    });

    // Only return groups that have multiple movies with IDENTICAL names and years
    const finalDuplicates = {};
    for (const [key, movies] of Object.entries(duplicates)) {
        if (movies.length > 1) {
            // Additional validation: ensure these are truly identical
            const firstMovie = movies[0];
            const allIdentical = movies.every(movie => 
                movie.originalName === firstMovie.originalName && 
                movie.effectiveYear === firstMovie.effectiveYear
            );
            
            if (allIdentical) {
                finalDuplicates[key] = movies;
            }
        }
    }

    return finalDuplicates;
}

function displayResults(duplicateResults) {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '';

    if (duplicateResults.length === 0) {
        resultsDiv.innerHTML = `
            <div class="no-duplicates">
                <div class="icon">🎉</div>
                <h3>Great News!</h3>
                <p>No duplicate movies found in any of your libraries.</p>
                <p class="subtitle">Your media collection is perfectly organized!</p>
            </div>
        `;
        return;
    }

    duplicateResults.forEach((result, index) => {
        const libraryBox = document.createElement('div');
        libraryBox.className = 'library-box';
        libraryBox.style.animationDelay = `${index * 0.1}s`;

        const h3 = document.createElement('h3');
        h3.textContent = result.libraryName;

        const p = document.createElement('p');
        p.textContent = `Total duplicate movies: ${result.count}`;

        const viewBtn = document.createElement('button');
        viewBtn.textContent = 'View Details';
        viewBtn.onclick = () => showDuplicatesHTML(result.libraryName, result.duplicates);

        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = 'Download List';
        downloadBtn.onclick = () => downloadDuplicates(result.libraryName, result.duplicates);

        libraryBox.appendChild(h3);
        libraryBox.appendChild(p);
        libraryBox.appendChild(viewBtn);
        libraryBox.appendChild(downloadBtn);
        resultsDiv.appendChild(libraryBox);
    });
}

function downloadDuplicates(libraryName, duplicates) {
    let content = `Duplicates in library: ${libraryName}\n`;
    content += `${'='.repeat(100)}\n\n`;
    
    for (const [key, paths] of Object.entries(duplicates)) {
        content += `Duplicate Set: ${key}\n`;
        content += `${'-'.repeat(80)}\n`;
        
        // Create table header
        content += `${'Movie Title'.padEnd(50)} | ${'Year'.padEnd(6)} | ${'Size'.padEnd(10)} | ${'Resolution'.padEnd(12)} | Full Path\n`;
        content += `${'-'.repeat(50)} | ${'-'.repeat(6)} | ${'-'.repeat(10)} | ${'-'.repeat(12)} | ${'-'.repeat(80)}\n`;
        
        // Add each duplicate file
        paths.forEach(({ path, year, size, resolution, originalName, itemId, mergedVersions }) => {
            const formattedSize = formatFileSize(size);
            const movieTitle = originalName || 'Unknown';
            const displayTitle = movieTitle.length > 47 ? movieTitle.substring(0, 44) + '...' : movieTitle;
            const displayYear = year ? year.toString() : 'N/A';
            
            content += `${displayTitle.padEnd(50)} | ${displayYear.padEnd(6)} | ${formattedSize.padEnd(10)} | ${resolution.padEnd(12)} | ${path}${mergedVersions ? '  [merged version]' : ''}\n`;
        });
        
        content += '\n';
    }
    
    // Add summary
    const totalDuplicates = Object.keys(duplicates).length;
    const totalFiles = Object.values(duplicates).reduce((sum, paths) => sum + paths.length, 0);
    content += `${'='.repeat(100)}\n`;
    content += `Summary: ${totalDuplicates} duplicate sets found with ${totalFiles} total files\n`;
    content += `${'='.repeat(100)}\n`;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${libraryName}_duplicates.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Classify by width OR height so cropped widescreen (e.g. 3840x1600, 1920x800)
// and pillarboxed 4:3 (e.g. 1440x1080) encodes get the right label
function getQualityBadge(width, height) {
    if (!width || !height) return { label: '?', className: 'quality-unknown' };
    if (width >= 3200 || height >= 1800) return { label: '4K', className: 'quality-4k' };
    if (width >= 1800 || height >= 1000) return { label: '1080p', className: 'quality-1080p' };
    if (width >= 1200 || height >= 700) return { label: '720p', className: 'quality-720p' };
    return { label: 'SD', className: 'quality-sd' };
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function setDefaultValues() {
    const embyServerUrlInput = document.getElementById('embyServerUrl');
    const apiKeyInput = document.getElementById('apiKey');
    
    // Load from localStorage only
    const savedUrl = localStorage.getItem('embyServerUrl');
    const savedApiKey = localStorage.getItem('embyApiKey');
    
    if (embyServerUrlInput) {
        if (savedUrl) {
            embyServerUrlInput.value = savedUrl;
        }
        
        // Save to localStorage when value changes
        embyServerUrlInput.addEventListener('blur', () => {
            if (embyServerUrlInput.value.trim()) {
                localStorage.setItem('embyServerUrl', embyServerUrlInput.value.trim());
            }
        });
    }
    
    if (apiKeyInput) {
        if (savedApiKey) {
            apiKeyInput.value = savedApiKey;
        }
        
        // Save to localStorage when value changes
        apiKeyInput.addEventListener('blur', () => {
            if (apiKeyInput.value.trim()) {
                localStorage.setItem('embyApiKey', apiKeyInput.value.trim());
            }
        });
    }
}

// Set default values when the page loads
document.addEventListener('DOMContentLoaded', () => {
    setDefaultValues();
    // Add event listeners for buttons
    document.getElementById('find-duplicates-btn').addEventListener('click', findDuplicates);
    document.getElementById('open-emby-btn').addEventListener('click', openEmby);
    document.getElementById('refresh-library-btn').addEventListener('click', refreshLibrary);
});

function showDuplicatesHTML(libraryName, duplicates) {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';

    // Create close button
    const closeButton = document.createElement('button');
    closeButton.className = 'modal-close';
    closeButton.textContent = '✕';

    // Create header
    const header = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.className = 'modal-title';
    h2.textContent = `Duplicates in "${libraryName}"`;
    const countPara = document.createElement('p');
    countPara.id = 'duplicate-count';
    countPara.className = 'modal-count';
    countPara.textContent = `Found ${Object.keys(duplicates).length} duplicate sets with ${Object.values(duplicates).reduce((sum, paths) => sum + paths.length, 0)} total files`;
    header.appendChild(h2);
    header.appendChild(countPara);
    
    // Create duplicates container
    const duplicatesContainer = document.createElement('div');
    duplicatesContainer.id = 'duplicates-container';
    
    for (const [key, paths] of Object.entries(duplicates)) {
        // Create duplicate set container
        const duplicateSet = document.createElement('div');
        duplicateSet.className = 'duplicate-set';

        // Create set header
        const setHeader = document.createElement('div');
        setHeader.className = 'duplicate-set-header';
        setHeader.textContent = `Duplicate Set: ${key}`;

        // Create table
        const table = document.createElement('table');
        table.className = 'duplicate-table';

        // Create table header
        const tableHeader = document.createElement('thead');
        tableHeader.innerHTML = `
            <tr>
                <th class="col-title">Movie Title</th>
                <th class="col-year">Year</th>
                <th class="col-size">Size</th>
                <th class="col-resolution">Resolution</th>
                <th class="col-quality">Quality</th>
                <th class="col-path">File Path</th>
                <th class="col-action">Action</th>
            </tr>
        `;
        
        // Create table body
        const tableBody = document.createElement('tbody');
        
        // Sort paths by resolution (highest first), then by size (largest first)
        const sortedPaths = paths.sort((a, b) => {
            const aPixels = a.width * a.height;
            const bPixels = b.width * b.height;
            
            if (aPixels !== bPixels) return bPixels - aPixels;
            return b.size - a.size;
        });
        
        sortedPaths.forEach(item => {
            const { path, year, size, resolution, width, height, originalName, itemId, mergedVersions } = item;
            const formattedSize = formatFileSize(size);
            const movieTitle = originalName || 'Unknown';
            const displayYear = year ? year.toString() : 'N/A';

            const { label: qualityLabel, className: qualityClass } = getQualityBadge(width, height);

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="cell-title">${escapeHtml(movieTitle)}</td>
                <td>${displayYear}</td>
                <td class="cell-size">${formattedSize}</td>
                <td class="cell-resolution">${resolution}</td>
                <td><span class="badge ${qualityClass}">${qualityLabel}</span></td>
                <td class="cell-path" title="${escapeHtml(path)}">${escapeHtml(path)}</td>
                <td>
                    ${mergedVersions
                        ? `<span class="badge badge-merged" title="Emby merged ${mergedVersions} versions into one item. Deleting the item would remove all of them, so delete this version from Emby or from disk directly.">Merged version</span>`
                        : `<button class="btn-delete">${DELETE_LABEL}</button>`}
                </td>
            `;

            tableBody.appendChild(row);

            const deleteBtn = row.querySelector('.btn-delete');
            if (deleteBtn) {
                deleteBtn.onclick = (e) => {
                    e.stopPropagation();
                    deleteMovieFromEmby(itemId, movieTitle, row);
                };
            }
        });
        
        table.appendChild(tableHeader);
        table.appendChild(tableBody);
        
        duplicateSet.appendChild(setHeader);
        duplicateSet.appendChild(table);
        duplicatesContainer.appendChild(duplicateSet);
    }
    
    // Add download button
    const downloadButton = document.createElement('button');
    downloadButton.className = 'btn-download';
    downloadButton.textContent = 'Download as Text File';
    downloadButton.onclick = () => downloadDuplicates(libraryName, duplicates);
    
    // Assemble modal
    modalContent.appendChild(closeButton);
    modalContent.appendChild(header);
    modalContent.appendChild(duplicatesContainer);
    modalContent.appendChild(downloadButton);
    modal.appendChild(modalContent);
    
    // Add to page
    document.body.appendChild(modal);
    
    // Close via button, background click or Escape key
    const closeModal = () => {
        modal.remove();
        document.removeEventListener('keydown', handleEscape);
    };
    const handleEscape = (e) => {
        if (e.key === 'Escape') closeModal();
    };
    closeButton.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
    document.addEventListener('keydown', handleEscape);
}

function clearSavedData() {
    localStorage.removeItem('embyServerUrl');
    localStorage.removeItem('embyApiKey');
    
    // Clear the form fields
    const embyServerUrlInput = document.getElementById('embyServerUrl');
    const apiKeyInput = document.getElementById('apiKey');
    
    if (embyServerUrlInput) {
        embyServerUrlInput.value = '';
    }
    
    if (apiKeyInput) {
        apiKeyInput.value = '';
    }
    
    alert('Saved data cleared!');
}

function exportSettings() {
    const settings = {
        embyServerUrl: localStorage.getItem('embyServerUrl') || '',
        embyApiKey: localStorage.getItem('embyApiKey') || '',
        exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'emby-dupe-finder-settings.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const settings = JSON.parse(e.target.result);
                    
                    if (settings.embyServerUrl) {
                        localStorage.setItem('embyServerUrl', settings.embyServerUrl);
                        const urlInput = document.getElementById('embyServerUrl');
                        if (urlInput) urlInput.value = settings.embyServerUrl;
                    }
                    
                    if (settings.embyApiKey) {
                        localStorage.setItem('embyApiKey', settings.embyApiKey);
                        const keyInput = document.getElementById('apiKey');
                        if (keyInput) keyInput.value = settings.embyApiKey;
                    }
                    
                    alert('Settings imported successfully!');
                } catch (error) {
                    alert('Error importing settings: Invalid JSON file');
                }
            };
            reader.readAsText(file);
        }
    };
    
    input.click();
}

// Function to delete a movie from Emby library
async function deleteMovieFromEmby(itemId, movieTitle, rowElement) {
    const embyServerUrl = getServerUrl();
    const apiKey = document.getElementById('apiKey').value;
    
    if (!embyServerUrl || !apiKey) {
        alert('Emby server URL and API key are required for deletion');
        return;
    }
    
    // Confirm deletion
    if (!confirm(`Are you sure you want to delete "${movieTitle}" from your Emby library?\n\nWARNING: Emby also deletes the media file(s) from disk. This cannot be undone.`)) {
        return;
    }
    
    // Disable the delete button to prevent multiple clicks
    const deleteBtn = rowElement.querySelector('.btn-delete');
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';

    try {
        const response = await fetch(`${embyServerUrl}/emby/Items/${itemId}`, {
            method: 'DELETE',
            headers: {
                'X-Emby-Token': apiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        
        if (response.ok) {
            // Success - remove the row from the table
            rowElement.classList.add('removing');

            // Look up the containers before the row is detached from the DOM
            const table = rowElement.closest('table');
            const duplicateSet = rowElement.closest('.duplicate-set');
            
            setTimeout(() => {
                rowElement.remove();
                
                // Check if this was the last row in the duplicate set
                const remainingRows = table.querySelectorAll('tbody tr').length;
                
                if (remainingRows === 0) {
                    // Remove the entire duplicate set if no movies remain
                    duplicateSet.classList.add('removing');

                    setTimeout(() => {
                        duplicateSet.remove();
                        
                        // Update the header count
                        updateDuplicateCount();
                    }, 300);
                } else {
                    updateDuplicateCount();
                }
            }, 300);
            
            // Show success message
            showNotification(`"${movieTitle}" has been successfully deleted from Emby library`, 'success');
            
        } else if (response.status === 404) {
            showNotification(`Movie "${movieTitle}" was not found in Emby (may have already been deleted)`, 'warning');
            rowElement.remove();
            updateDuplicateCount();
        } else {
            // Get more details about the error
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            try {
                const errorBody = await response.text();
                if (errorBody) {
                    errorMessage += ` - ${errorBody}`;
                }
            } catch (e) {
                // Ignore if we can't read the error body
            }
            throw new Error(errorMessage);
        }
        
    } catch (error) {
        console.error('Error deleting movie:', error);
        showNotification(`Failed to delete "${movieTitle}": ${error.message}`, 'error');
        
        // Re-enable the button on error
        deleteBtn.disabled = false;
        deleteBtn.textContent = DELETE_LABEL;
    }
}

// Function to show notifications
function showNotification(message, type = 'info') {
    // type is 'success', 'error', 'warning' or 'info' (default colour)
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    const dismiss = () => {
        notification.classList.add('closing');
        setTimeout(() => notification.remove(), 300);
    };

    // Auto-remove after 5 seconds, or earlier on click
    setTimeout(dismiss, 5000);
    notification.onclick = dismiss;
}

// Function to update duplicate count in the modal header
function updateDuplicateCount() {
    const duplicatesContainer = document.getElementById('duplicates-container');
    if (!duplicatesContainer) return;

    const remainingSets = duplicatesContainer.querySelectorAll('.duplicate-set').length;
    const totalFiles = duplicatesContainer.querySelectorAll('tbody tr').length;

    const countPara = document.getElementById('duplicate-count');
    if (countPara) {
        countPara.textContent = `Found ${remainingSets} duplicate sets with ${totalFiles} total files`;
    }

    if (remainingSets === 0) {
        duplicatesContainer.innerHTML = `
            <div class="all-removed">
                <h3>🎉 All duplicates have been removed!</h3>
                <p>You can close this window now.</p>
            </div>
        `;
    }
}

function openEmby() {
    const embyServerUrl = getServerUrl();

    if (!embyServerUrl) {
        alert('Please enter an Emby Server URL first');
        return;
    }

    // Open Emby in a new tab
    window.open(embyServerUrl, '_blank');
}