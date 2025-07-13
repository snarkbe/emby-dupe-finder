async function findDuplicates() {
    let embyServerUrl = document.getElementById('embyServerUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value;
    const resultsDiv = document.getElementById('results');
    const loadingOverlay = document.getElementById('loading-overlay');

    resultsDiv.innerHTML = '';
    loadingOverlay.classList.remove('hidden');

    if (!/^https?:\/\//i.test(embyServerUrl)) {
        embyServerUrl = 'http://' + embyServerUrl;
    }

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
    const response = await fetch(`${embyServerUrl}/emby/Library/VirtualFolders?api_key=${apiKey}`);
    if (!response.ok) throw new Error('Failed to fetch libraries');
    return await response.json();
}

async function fetchMoviesFromLibrary(embyServerUrl, apiKey, libraryId) {
    const response = await fetch(`${embyServerUrl}/emby/Items?Recursive=true&ParentId=${libraryId}&IncludeItemTypes=Movie&Fields=Path,ProductionYear,RunTimeTicks,MediaSources,MediaStreams&api_key=${apiKey}`);
    if (!response.ok) throw new Error(`Failed to fetch movies from library ${libraryId}`);
    const data = await response.json();
    return data.Items || [];
}

function findDuplicatesInLibrary(movies) {
    const duplicates = {};
    const duplicatesByName = {};

    movies.forEach(movie => {
        const name = movie.Name;
        const year = movie.ProductionYear;
        const path = movie.Path;
        
        // Get file size from MediaSources
        let fileSize = 0;
        if (movie.MediaSources && movie.MediaSources.length > 0) {
            fileSize = movie.MediaSources[0].Size || 0;
        }

        // Get resolution from MediaStreams
        let resolution = 'Unknown';
        if (movie.MediaStreams && movie.MediaStreams.length > 0) {
            const videoStream = movie.MediaStreams.find(stream => stream.Type === 'Video');
            if (videoStream && videoStream.Width && videoStream.Height) {
                resolution = `${videoStream.Width}x${videoStream.Height}`;
            }
        }

        if (!name) return;

        const key = year ? `${name.trim()}_${year}` : name.trim();
        if (!duplicates[key]) duplicates[key] = [];
        duplicates[key].push({ path, year, size: fileSize, resolution });

        if (!duplicatesByName[name.trim()]) duplicatesByName[name.trim()] = [];
        duplicatesByName[name.trim()].push({ path, year, size: fileSize, resolution });
    });

    const finalDuplicates = {};
    for (const [key, paths] of Object.entries(duplicates)) {
        if (paths.length > 1) finalDuplicates[key] = paths;
    }

    for (const [name, paths] of Object.entries(duplicatesByName)) {
        if (paths.length > 1 && new Set(paths.map(p => p.year)).size > 1) {
            finalDuplicates[name] = paths;
        }
    }

    return finalDuplicates;
}

function displayResults(duplicateResults) {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '';

    if (duplicateResults.length === 0) {
        resultsDiv.innerHTML = '<p>No duplicates found in any library.</p>';
        return;
    }

    duplicateResults.forEach((result, index) => {
        const libraryBox = document.createElement('div');
        libraryBox.className = 'library-box';
        libraryBox.style.animationDelay = `${index * 0.1}s`;
        libraryBox.innerHTML = `
            <h3>${result.libraryName}</h3>
            <p>Total duplicate movies: ${result.count}</p>
            <button onclick="showDuplicatesHTML('${result.libraryName}', ${JSON.stringify(result.duplicates).replace(/"/g, '&quot;')})">View Details</button>
            <button onclick="downloadDuplicates('${result.libraryName}', ${JSON.stringify(result.duplicates).replace(/"/g, '&quot;')})">Download List</button>
        `;
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
        content += `${'Path'.padEnd(70)} | ${'Year'.padEnd(6)} | ${'Size'.padEnd(10)} | ${'Resolution'.padEnd(12)}\n`;
        content += `${'-'.repeat(70)} | ${'-'.repeat(6)} | ${'-'.repeat(10)} | ${'-'.repeat(12)}\n`;
        
        // Add each duplicate file
        paths.forEach(({ path, year, size, resolution }) => {
            const formattedSize = formatFileSize(size);
            const fileName = path.split('\\').pop() || path.split('/').pop() || path;
            const displayPath = fileName.length > 67 ? fileName.substring(0, 64) + '...' : fileName;
            const displayYear = year ? year.toString() : 'N/A';
            
            content += `${displayPath.padEnd(70)} | ${displayYear.padEnd(6)} | ${formattedSize.padEnd(10)} | ${resolution.padEnd(12)}\n`;
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
document.addEventListener('DOMContentLoaded', setDefaultValues);

function showDuplicatesHTML(libraryName, duplicates) {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.8);
        z-index: 1000;
        overflow-y: auto;
        padding: 20px;
        box-sizing: border-box;
    `;
    
    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: white;
        border-radius: 10px;
        padding: 30px;
        max-width: 1200px;
        margin: 0 auto;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        position: relative;
    `;
    
    // Create close button
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '✕';
    closeButton.style.cssText = `
        position: absolute;
        top: 15px;
        right: 20px;
        background: #ff4757;
        color: white;
        border: none;
        border-radius: 50%;
        width: 30px;
        height: 30px;
        font-size: 16px;
        cursor: pointer;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
    `;
    closeButton.onclick = () => document.body.removeChild(modal);
    
    // Create header
    const header = document.createElement('div');
    header.innerHTML = `
        <h2 style="margin: 0 0 20px 0; color: #2c3e50;">Duplicates in "${libraryName}"</h2>
        <p style="margin: 0 0 30px 0; color: #7f8c8d;">Found ${Object.keys(duplicates).length} duplicate sets with ${Object.values(duplicates).reduce((sum, paths) => sum + paths.length, 0)} total files</p>
    `;
    
    // Create duplicates container
    const duplicatesContainer = document.createElement('div');
    
    for (const [key, paths] of Object.entries(duplicates)) {
        // Create duplicate set container
        const duplicateSet = document.createElement('div');
        duplicateSet.style.cssText = `
            margin-bottom: 30px;
            border: 1px solid #e1e8ed;
            border-radius: 8px;
            overflow: hidden;
            background: #f8f9fa;
        `;
        
        // Create set header
        const setHeader = document.createElement('div');
        setHeader.style.cssText = `
            background: #3498db;
            color: white;
            padding: 15px 20px;
            font-weight: bold;
            font-size: 16px;
        `;
        setHeader.textContent = `Duplicate Set: ${key}`;
        
        // Create table
        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            background: white;
        `;
        
        // Create table header
        const tableHeader = document.createElement('thead');
        tableHeader.innerHTML = `
            <tr style="background: #f1f2f6;">
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd; font-weight: 600; color: #2c3e50;">Filename</th>
                <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd; font-weight: 600; width: 80px; color: #2c3e50;">Year</th>
                <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd; font-weight: 600; width: 100px; color: #2c3e50;">Size</th>
                <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd; font-weight: 600; width: 120px; color: #2c3e50;">Resolution</th>
                <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd; font-weight: 600; width: 80px; color: #2c3e50;">Quality</th>
            </tr>
        `;
        
        // Create table body
        const tableBody = document.createElement('tbody');
        
        // Sort paths by resolution (highest first), then by size (largest first)
        const sortedPaths = paths.sort((a, b) => {
            const aPixels = a.resolution !== 'Unknown' ? 
                parseInt(a.resolution.split('x')[0]) * parseInt(a.resolution.split('x')[1]) : 0;
            const bPixels = b.resolution !== 'Unknown' ? 
                parseInt(b.resolution.split('x')[0]) * parseInt(b.resolution.split('x')[1]) : 0;
            
            if (aPixels !== bPixels) return bPixels - aPixels;
            return b.size - a.size;
        });
        
        sortedPaths.forEach((item, index) => {
            const { path, year, size, resolution } = item;
            const formattedSize = formatFileSize(size);
            const fileName = path.split('\\').pop() || path.split('/').pop() || path;
            const displayYear = year ? year.toString() : 'N/A';
            
            // Determine quality badge
            let qualityBadge = '';
            let qualityColor = '#95a5a6';
            
            if (resolution.includes('3840x2160')) {
                qualityBadge = '4K';
                qualityColor = '#e74c3c';
            } else if (resolution.includes('1920x1080')) {
                qualityBadge = '1080p';
                qualityColor = '#27ae60';
            } else if (resolution.includes('1280x720')) {
                qualityBadge = '720p';
                qualityColor = '#f39c12';
            } else if (resolution !== 'Unknown') {
                qualityBadge = 'SD';
                qualityColor = '#95a5a6';
            } else {
                qualityBadge = '?';
            }
            
            const row = document.createElement('tr');
            row.style.cssText = `
                ${index === 0 ? 'background: #e8f5e8;' : ''}
                ${index % 2 === 1 ? 'background: #f8f9fa;' : ''}
            `;
            
            row.innerHTML = `
                <td style="padding: 12px; border-bottom: 1px solid #eee; font-family: monospace; font-size: 13px; color: #2c3e50;" title="${path}">${fileName}</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid #eee; color: #2c3e50;">${displayYear}</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid #eee; font-weight: 500; color: #2c3e50;">${formattedSize}</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid #eee; font-family: monospace; color: #2c3e50;">${resolution}</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid #eee;">
                    <span style="background: ${qualityColor}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold;">${qualityBadge}</span>
                </td>
            `;
            
            tableBody.appendChild(row);
        });
        
        table.appendChild(tableHeader);
        table.appendChild(tableBody);
        
        duplicateSet.appendChild(setHeader);
        duplicateSet.appendChild(table);
        duplicatesContainer.appendChild(duplicateSet);
    }
    
    // Add download button
    const downloadButton = document.createElement('button');
    downloadButton.textContent = 'Download as Text File';
    downloadButton.style.cssText = `
        background: #2ecc71;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 6px;
        font-size: 14px;
        cursor: pointer;
        margin-top: 20px;
        font-weight: 500;
    `;
    downloadButton.onclick = () => downloadDuplicates(libraryName, duplicates);
    
    // Assemble modal
    modalContent.appendChild(closeButton);
    modalContent.appendChild(header);
    modalContent.appendChild(duplicatesContainer);
    modalContent.appendChild(downloadButton);
    modal.appendChild(modalContent);
    
    // Add to page
    document.body.appendChild(modal);
    
    // Close on background click
    modal.onclick = (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    };
    
    // Close on Escape key
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            document.body.removeChild(modal);
            document.removeEventListener('keydown', handleEscape);
        }
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