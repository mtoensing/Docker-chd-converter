// Main CHD Converter App
import { api, formatSize, getFileIcon } from './api.js';

const { html, render, useState, useEffect, useRef, useCallback } = window;

// ============ Help Component ============

function HelpPanel({ onClose }) {
    return html`
        <div class="help-panel">
            <div class="help-header">
                <h3>Quick Start Guide</h3>
                <button class="btn btn-sm btn-secondary" onClick=${onClose}>×</button>
            </div>
            <div class="help-content">
                <h4>How to use CHD Converter</h4>
                <ol>
                    <li><strong>Select a Volume</strong> - Choose a mounted directory from the left panel</li>
                    <li><strong>Browse Files</strong> - Navigate through folders to find your disc images</li>
                    <li><strong>Select Files</strong> - Click checkboxes next to files you want to convert</li>
                    <li><strong>Choose Mode</strong>:
                        <ul>
                            <li><em>CD Mode</em> - For Dreamcast (.gdi), PlayStation 1, Sega CD, etc.</li>
                            <li><em>DVD Mode</em> - For PSP (.iso), PlayStation 2, etc.</li>
                        </ul>
                    </li>
                    <li><strong>Convert</strong> - Click the Convert button to start</li>
                </ol>
                <h4>File Types</h4>
                <ul>
                    <li>💽 <strong>.gdi, .iso, .cue, .bin</strong> - Can be converted to CHD</li>
                    <li>💿 <strong>.chd</strong> - Click to view file information</li>
                    <li>📦 <strong>.zip, .7z, .rar</strong> - Archives (click to browse contents)</li>
                </ul>
                <h4>Tips</h4>
                <ul>
                    <li>Files showing "CHD exists" already have a converted version</li>
                    <li>Use "Search All" to find all convertible files recursively</li>
                    <li>Set a custom output directory or leave empty to save alongside source</li>
                </ul>
            </div>
        </div>
    `;
}

// ============ Components ============

function VolumeList({ volumes, selectedVolume, onSelect, loading, error }) {
    if (error) {
        return html`
            <div class="error-state">
                <p>Failed to load volumes</p>
                <p class="error-detail">${error}</p>
                <button class="btn btn-sm btn-primary" onClick=${() => location.reload()}>
                    Retry
                </button>
            </div>
        `;
    }

    if (loading) {
        return html`<div class="loading"><div class="spinner"></div>Loading volumes...</div>`;
    }

    if (volumes.length === 0) {
        return html`
            <div class="empty-state">
                <div class="icon">📂</div>
                <p>No volumes configured</p>
                <p class="help-text">Mount directories using CHD_VOLUMES environment variable</p>
            </div>
        `;
    }

    return html`
        <ul class="volume-list">
            ${volumes.map(vol => html`
                <li
                    key=${vol.path}
                    class="volume-item ${selectedVolume?.path === vol.path ? 'active' : ''}"
                    onClick=${() => onSelect(vol)}
                    title="Path: ${vol.path}"
                >
                    <span class="icon">💾</span>
                    <span>${vol.name}</span>
                </li>
            `)}
        </ul>
    `;
}

function Breadcrumb({ path, volume, onNavigate }) {
    if (!path || !volume) return null;

    const parts = path.replace(volume.path, '').split('/').filter(Boolean);

    const crumbs = [
        { name: volume.name, path: volume.path }
    ];

    let currentPath = volume.path;
    for (const part of parts) {
        currentPath = currentPath + '/' + part;
        crumbs.push({ name: part, path: currentPath });
    }

    return html`
        <div class="breadcrumb">
            ${crumbs.map((crumb, i) => html`
                <span key=${crumb.path}>
                    ${i > 0 && html`<span class="breadcrumb-separator">/</span>`}
                    <span
                        class="breadcrumb-item"
                        onClick=${() => onNavigate(crumb.path)}
                        title=${crumb.path}
                    >
                        ${crumb.name}
                    </span>
                </span>
            `)}
        </div>
    `;
}

function FileList({ entries, selectedFiles, onNavigate, onToggleSelect, onShowInfo, onBrowseArchive, onRename, onDelete, onVerify, verifiedCHDs, error }) {
    const [verifyingPath, setVerifyingPath] = useState(null);
    const [expandedArchives, setExpandedArchives] = useState(new Set());
    const [loadingArchives, setLoadingArchives] = useState(new Set());
    const [archiveContents, setArchiveContents] = useState(new Map());

    // Auto-expand archives that have convertible contents on mount/update
    useEffect(() => {
        if (!entries) return;
        const archivesWithContent = entries
            .filter(e => e.type === 'archive' && e.has_convertible_contents)
            .map(e => e.path);

        // Auto-expand new archives with content
        archivesWithContent.forEach(path => {
            if (!expandedArchives.has(path) && !archiveContents.has(path) && !loadingArchives.has(path)) {
                loadArchiveContents(path);
            }
        });
    }, [entries]);

    const loadArchiveContents = async (archivePath) => {
        setLoadingArchives(prev => new Set([...prev, archivePath]));
        setExpandedArchives(prev => new Set([...prev, archivePath]));

        try {
            const data = await api.listArchive(archivePath);
            if (data && data.files) {
                const contents = data.files.map(file => ({
                    name: file.name,
                    path: `${archivePath}::${file.internal_path}`,
                    type: 'file',
                    size: file.size,
                    extension: file.extension,
                    convertible: file.convertible,
                    has_chd: file.has_chd || false,
                    is_archive_item: true,
                    archive_path: archivePath
                }));
                setArchiveContents(prev => new Map([...prev, [archivePath, contents]]));
            }
        } catch (err) {
            console.error('Failed to load archive contents:', err);
        } finally {
            setLoadingArchives(prev => {
                const next = new Set(prev);
                next.delete(archivePath);
                return next;
            });
        }
    };

    const toggleArchive = (archivePath, e) => {
        e.stopPropagation();
        if (expandedArchives.has(archivePath)) {
            setExpandedArchives(prev => {
                const next = new Set(prev);
                next.delete(archivePath);
                return next;
            });
        } else {
            if (!archiveContents.has(archivePath)) {
                loadArchiveContents(archivePath);
            } else {
                setExpandedArchives(prev => new Set([...prev, archivePath]));
            }
        }
    };

    if (error) {
        return html`
            <div class="error-state">
                <div class="icon">⚠️</div>
                <p>Failed to load files</p>
                <p class="error-detail">${error}</p>
            </div>
        `;
    }

    if (!entries || entries.length === 0) {
        return html`
            <div class="empty-state">
                <div class="icon">📂</div>
                <p>No files found</p>
                <p class="help-text">This folder is empty or contains no supported files</p>
            </div>
        `;
    }

    const handleClick = (entry, _e) => {
        if (entry.type === 'directory') {
            onNavigate(entry.path);
        } else if (entry.type === 'archive') {
            // Toggle archive expansion
            toggleArchive(entry.path, _e);
        } else if (entry.extension === '.chd') {
            onShowInfo(entry.path);
        } else if (entry.convertible) {
            onToggleSelect(entry);
        }
    };

    const handleVerifyClick = async (e, entry) => {
        e.stopPropagation();
        setVerifyingPath(entry.path);
        try {
            await onVerify(entry.path);
        } finally {
            setVerifyingPath(null);
        }
    };

    const getTooltip = (entry) => {
        if (entry.type === 'directory') return `Open folder: ${entry.name}`;
        if (entry.type === 'archive') {
            if (entry.has_convertible_contents) {
                return `Archive: ${entry.name} - ${entry.convertible_count} convertible file(s) - Click to expand/collapse`;
            }
            return `Archive: ${entry.name} - No convertible files`;
        }
        if (entry.extension === '.chd') return 'Click to view CHD info';
        if (entry.convertible) return entry.has_chd ? 'Already converted' : 'Click to select for conversion';
        return entry.name;
    };

    const isVerified = (entry) => entry.extension === '.chd' && verifiedCHDs && verifiedCHDs.has(entry.path);
    const isArchiveItem = (entry) => entry.is_archive_item;

    const renderNestedEntry = (entry) => html`
        <li
            key=${entry.path}
            class="file-item nested-item ${selectedFiles.has(entry.path) ? 'selected' : ''}"
            onClick=${(e) => { e.stopPropagation(); if (entry.convertible && !entry.has_chd) onToggleSelect(entry); }}
            title=${entry.has_chd ? 'CHD already exists' : 'Click to select for conversion'}
        >
            ${entry.convertible && !entry.has_chd && html`
                <input
                    type="checkbox"
                    class="checkbox"
                    checked=${selectedFiles.has(entry.path)}
                    onClick=${(e) => { e.stopPropagation(); onToggleSelect(entry); }}
                />
            `}
            <span class="icon">${getFileIcon(entry)}</span>
            <div class="info">
                <div class="name">${entry.name}</div>
                ${entry.size != null && html`
                    <div class="meta">${formatSize(entry.size)}</div>
                `}
            </div>
            ${entry.has_chd && html`
                <span class="status has-chd" title="A CHD file already exists for this source">CHD exists</span>
            `}
            ${entry.convertible && !entry.has_chd && html`
                <span class="status convertible" title="Can be converted to CHD">Convertible</span>
            `}
        </li>
    `;

    return html`
        <ul class="file-list">
            ${entries.map(entry => html`
                <li
                    key=${entry.path}
                    class="file-item ${selectedFiles.has(entry.path) ? 'selected' : ''} ${entry.type === 'archive' ? 'archive-item' : ''}"
                    onClick=${(e) => handleClick(entry, e)}
                    title=${getTooltip(entry)}
                >
                    ${entry.type === 'archive' && html`
                        <span class="archive-toggle" onClick=${(e) => toggleArchive(entry.path, e)}>
                            ${loadingArchives.has(entry.path) ? html`<span class="spinner-tiny"></span>` : expandedArchives.has(entry.path) ? '▼' : '▶'}
                        </span>
                    `}
                    ${entry.convertible && !entry.has_chd && entry.type !== 'archive' && html`
                        <input
                            type="checkbox"
                            class="checkbox"
                            checked=${selectedFiles.has(entry.path)}
                            onClick=${(e) => { e.stopPropagation(); onToggleSelect(entry); }}
                        />
                    `}
                    <span class="icon">${getFileIcon(entry)}</span>
                    <div class="info">
                        <div class="name">${entry.name}</div>
                        ${entry.size != null && entry.size !== undefined && html`
                            <div class="meta">${formatSize(entry.size)}</div>
                        `}
                    </div>
                    ${entry.type === 'archive' && entry.has_convertible_contents && html`
                        <span class="status archive-count" title="${entry.convertible_count} convertible file(s) inside">
                            ${entry.convertible_count} file${entry.convertible_count !== 1 ? 's' : ''}
                        </span>
                    `}
                    ${entry.type === 'archive' && !entry.has_convertible_contents && html`
                        <span class="status no-content" title="No convertible files in this archive">Empty</span>
                    `}
                    ${entry.has_chd && entry.type !== 'archive' && html`
                        <span class="status has-chd" title="A CHD file already exists for this source">CHD exists</span>
                    `}
                    ${entry.convertible && !entry.has_chd && entry.type !== 'archive' && html`
                        <span class="status convertible" title="Can be converted to CHD">Convertible</span>
                    `}
                    ${isVerified(entry) && html`
                        <span class="status verified" title="CHD integrity verified">✓ Verified</span>
                    `}
                    ${!isArchiveItem(entry) && entry.type !== 'archive' && html`
                        <div class="file-actions" onClick=${(e) => e.stopPropagation()}>
                            ${entry.extension === '.chd' && !isVerified(entry) && html`
                                <button
                                    class="btn-icon"
                                    onClick=${(e) => handleVerifyClick(e, entry)}
                                    title="Verify CHD integrity"
                                    disabled=${verifyingPath === entry.path}
                                >
                                    ${verifyingPath === entry.path ? '⏳' : '🔍'}
                                </button>
                            `}
                            <button
                                class="btn-icon"
                                onClick=${(e) => { e.stopPropagation(); onRename(entry); }}
                                title="Rename"
                            >
                                ✏️
                            </button>
                            <button
                                class="btn-icon btn-danger"
                                onClick=${(e) => { e.stopPropagation(); onDelete(entry); }}
                                title="Delete"
                            >
                                🗑️
                            </button>
                        </div>
                    `}
                </li>
                ${entry.type === 'archive' && expandedArchives.has(entry.path) && html`
                    ${loadingArchives.has(entry.path) && html`
                        <li class="archive-loading-item">
                            <span class="spinner-tiny"></span>
                            <span>Loading archive contents...</span>
                        </li>
                    `}
                    ${!loadingArchives.has(entry.path) && archiveContents.has(entry.path) &&
                        archiveContents.get(entry.path).map(nested => renderNestedEntry(nested))
                    }
                `}
            `)}
        </ul>
    `;
}

function JobList({ jobs, onCancel }) {
    if (jobs.length === 0) {
        return html`
            <div class="empty-state">
                <div class="icon">⏳</div>
                <p>No conversion jobs</p>
                <p class="help-text">Select files and click Convert to start</p>
            </div>
        `;
    }

    const getStatusText = (job) => {
        switch (job.status) {
            case 'creating': return 'Creating job...';
            case 'queued': return 'Waiting in queue';
            case 'processing': return `Converting: ${job.progress}%`;
            case 'completed': return 'Completed';
            case 'failed': return 'Failed';
            case 'cancelled': return 'Cancelled';
            default: return job.status;
        }
    };

    const getStatusIcon = (job) => {
        switch (job.status) {
            case 'creating': return '⏳';
            case 'queued': return '⏸️';
            case 'processing': return '⚙️';
            case 'completed': return '✅';
            case 'failed': return '❌';
            case 'cancelled': return '🚫';
            default: return '📄';
        }
    };

    const getOutputDir = (path) => {
        if (!path) return 'Unknown';
        const parts = path.split('/');
        parts.pop(); // Remove filename
        return parts.length > 0 ? parts.join('/') : '/';
    };

    const getOutputFilename = (path) => {
        if (!path) return 'Unknown';
        return path.split('/').pop();
    };

    return html`
        <ul class="job-list">
            ${jobs.map(job => html`
                <li key=${job.id} class="job-item">
                    <div class="job-header">
                        <span class="job-status-icon" title=${getStatusText(job)}>${getStatusIcon(job)}</span>
                        <span class="job-name" title=${job.file_path}>${job.filename}</span>
                        <span class="job-status ${job.status}">${job.status}</span>
                    </div>

                    ${job.output_path && html`
                        <div class="job-output-info" style="font-size: 0.75rem; color: var(--text-secondary); margin: 4px 0; padding-left: 24px;">
                            <span title="Output: ${job.output_path}">→ ${getOutputFilename(job.output_path)}</span>
                            <span style="opacity: 0.7;"> in ${getOutputDir(job.output_path)}</span>
                        </div>
                    `}

                    ${job.status === 'creating' && html`
                        <div class="progress-bar">
                            <div class="progress-fill creating" style="width: 100%; animation: pulse 1.5s infinite;"></div>
                        </div>
                        <div class="progress-text" style="color: var(--text-secondary);">
                            Setting up conversion job...
                        </div>
                    `}

                    ${job.status === 'queued' && html`
                        <div class="progress-text" style="color: var(--text-secondary);">
                            Waiting for other jobs to complete...
                        </div>
                    `}

                    ${job.status === 'processing' && html`
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${job.progress}%"></div>
                        </div>
                        <div class="progress-text">
                            ${job.progress}% - ${job.message || 'Converting...'}
                        </div>
                    `}

                    ${job.status === 'completed' && html`
                        <div class="job-success" style="color: var(--success); font-size: 0.8rem; padding-left: 24px;">
                            Conversion complete${job.output_size ? ` - ${formatSize(job.output_size)}` : ''}
                        </div>
                    `}

                    ${job.error_message && html`
                        <div class="job-error" style="padding-left: 24px;">${job.error_message}</div>
                    `}

                    <div class="job-actions">
                        ${['queued', 'processing'].includes(job.status) && html`
                            <button class="btn btn-sm btn-secondary" onClick=${() => onCancel(job.id)} title="Cancel this job">
                                Cancel
                            </button>
                        `}
                    </div>
                </li>
            `)}
        </ul>
    `;
}

function CHDInfoModal({ path, onClose }) {
    const [info, setInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (path) {
            setLoading(true);
            setError(null);
            api.getCHDInfo(path)
                .then(setInfo)
                .catch(e => setError(e.message))
                .finally(() => setLoading(false));
        }
    }, [path]);

    if (!path) return null;

    const filename = path.split('/').pop();

    return html`
        <div class="modal-overlay" onClick=${onClose}>
            <div class="modal" onClick=${(e) => e.stopPropagation()}>
                <div class="modal-header">
                    <h3>CHD Information: ${filename}</h3>
                    <button class="modal-close" onClick=${onClose} title="Close">×</button>
                </div>
                ${loading && html`<div class="loading"><div class="spinner"></div>Loading CHD info...</div>`}
                ${error && html`
                    <div class="error-state">
                        <p>Failed to read CHD file</p>
                        <p class="error-detail">${error}</p>
                    </div>
                `}
                ${info && html`
                    <div class="info-grid">
                        <span class="info-label">File</span>
                        <span class="info-value">${filename}</span>

                        ${info.file_version && html`
                            <span class="info-label">CHD Version</span>
                            <span class="info-value">${info.file_version}</span>
                        `}
                        ${info.logical_size && html`
                            <span class="info-label">Logical Size</span>
                            <span class="info-value">${info.logical_size}</span>
                        `}
                        ${info.chd_size && html`
                            <span class="info-label">Compressed Size</span>
                            <span class="info-value">${info.chd_size}</span>
                        `}
                        ${info.compression && html`
                            <span class="info-label">Compression</span>
                            <span class="info-value">${info.compression}</span>
                        `}
                        ${info.ratio && html`
                            <span class="info-label">Compression Ratio</span>
                            <span class="info-value">${info.ratio}</span>
                        `}
                        ${info.hunk_size && html`
                            <span class="info-label">Hunk Size</span>
                            <span class="info-value">${info.hunk_size}</span>
                        `}
                        ${info.total_hunks && html`
                            <span class="info-label">Total Hunks</span>
                            <span class="info-value">${info.total_hunks}</span>
                        `}
                        ${info.sha1 && html`
                            <span class="info-label">SHA1</span>
                            <span class="info-value" style="font-family: monospace; font-size: 0.75rem">${info.sha1}</span>
                        `}
                        ${info.data_sha1 && html`
                            <span class="info-label">Data SHA1</span>
                            <span class="info-value" style="font-family: monospace; font-size: 0.75rem">${info.data_sha1}</span>
                        `}
                    </div>
                    ${info.raw_data && html`
                        <details style="margin-top: 15px">
                            <summary style="cursor: pointer; color: var(--text-secondary)">Show Raw Output</summary>
                            <pre style="margin-top: 10px; font-size: 0.75rem; overflow-x: auto; padding: 10px; background: var(--bg-primary); border-radius: 4px; white-space: pre-wrap">${info.raw_data}</pre>
                        </details>
                    `}
                `}
            </div>
        </div>
    `;
}

function DuplicateModal({ duplicates, onAction, onClose }) {
    if (!duplicates || duplicates.length === 0) return null;

    const existingCount = duplicates.filter(d => d.exists).length;

    return html`
        <div class="modal-overlay" onClick=${onClose}>
            <div class="modal" onClick=${(e) => e.stopPropagation()}>
                <div class="modal-header">
                    <h3>Duplicate Output Files Found</h3>
                    <button class="modal-close" onClick=${onClose} title="Close">×</button>
                </div>
                <div class="modal-body" style="padding: 15px;">
                    <p style="margin-bottom: 15px;">
                        <strong>${existingCount}</strong> of ${duplicates.length} selected file(s) already have CHD output files.
                    </p>
                    <div style="max-height: 200px; overflow-y: auto; margin-bottom: 15px; padding: 10px; background: var(--bg-primary); border-radius: 4px;">
                        ${duplicates.filter(d => d.exists).map(d => html`
                            <div key=${d.file_path} style="margin-bottom: 8px; font-size: 0.85rem;">
                                <div style="color: var(--text-primary);">${d.file_path.split('/').pop()}</div>
                                <div style="color: var(--text-secondary); font-size: 0.75rem;">→ ${d.output_path.split('/').pop()}</div>
                            </div>
                        `)}
                    </div>
                    <p style="margin-bottom: 15px; color: var(--text-secondary);">How would you like to handle these duplicates?</p>
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <button class="btn btn-primary" onClick=${() => onAction('rename')} style="width: 100%;">
                            Rename (create game_1.chd, game_2.chd, etc.)
                        </button>
                        <button class="btn btn-secondary" onClick=${() => onAction('overwrite')} style="width: 100%;">
                            Overwrite existing files
                        </button>
                        <button class="btn btn-secondary" onClick=${() => onAction('skip')} style="width: 100%;">
                            Skip duplicates (convert only new files)
                        </button>
                        <button class="btn btn-secondary" onClick=${onClose} style="width: 100%;">
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function RenameModal({ entry, onRename, onClose }) {
    const [newName, setNewName] = useState(entry?.name || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    if (!entry) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!newName.trim() || newName === entry.name) return;

        setLoading(true);
        setError(null);
        try {
            await onRename(entry.path, newName.trim());
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return html`
        <div class="modal-overlay" onClick=${onClose}>
            <div class="modal" onClick=${(e) => e.stopPropagation()}>
                <div class="modal-header">
                    <h3>Rename</h3>
                    <button class="modal-close" onClick=${onClose} title="Close">×</button>
                </div>
                <form onSubmit=${handleSubmit} class="modal-body" style="padding: 15px;">
                    <p style="margin-bottom: 10px; color: var(--text-secondary);">
                        Current name: <strong>${entry.name}</strong>
                    </p>
                    <input
                        type="text"
                        value=${newName}
                        onInput=${(e) => setNewName(e.target.value)}
                        placeholder="Enter new name"
                        style="width: 100%; padding: 10px; margin-bottom: 15px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-primary); color: var(--text-primary);"
                        autoFocus
                    />
                    ${error && html`
                        <p style="color: var(--error); margin-bottom: 15px; font-size: 0.85rem;">${error}</p>
                    `}
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button type="button" class="btn btn-secondary" onClick=${onClose} disabled=${loading}>
                            Cancel
                        </button>
                        <button
                            type="submit"
                            class="btn btn-primary"
                            disabled=${loading || !newName.trim() || newName === entry.name}
                        >
                            ${loading ? 'Renaming...' : 'Rename'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function DeleteModal({ entry, hasCHD, verifiedCHDs, onDelete, onVerify, onClose }) {
    const [step, setStep] = useState(1); // 1 = initial, 2 = verification/confirm, 3 = final confirm
    const [verifying, setVerifying] = useState(false);
    const [verificationResult, setVerificationResult] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState(null);

    if (!entry) return null;

    const isSourceFile = ['.iso', '.gdi', '.cue', '.bin'].includes(entry.extension?.toLowerCase());
    const chdPath = isSourceFile && hasCHD ? entry.path.replace(/\.[^.]+$/, '.chd') : null;
    const isAlreadyVerified = chdPath && verifiedCHDs.has(chdPath);

    const handleVerify = async () => {
        if (!chdPath) return;
        setVerifying(true);
        setError(null);
        try {
            const result = await onVerify(chdPath);
            setVerificationResult(result);
            if (result.valid) {
                setStep(3);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setVerifying(false);
        }
    };

    const handleDelete = async () => {
        setDeleting(true);
        setError(null);
        try {
            await onDelete(entry.path);
            onClose();
        } catch (err) {
            setError(err.message);
            setDeleting(false);
        }
    };

    return html`
        <div class="modal-overlay" onClick=${onClose}>
            <div class="modal" onClick=${(e) => e.stopPropagation()}>
                <div class="modal-header">
                    <h3 style="color: var(--error);">⚠️ Delete File</h3>
                    <button class="modal-close" onClick=${onClose} title="Close">×</button>
                </div>
                <div class="modal-body" style="padding: 15px;">
                    <p style="margin-bottom: 15px;">
                        Are you sure you want to delete: <br/>
                        <strong style="word-break: break-all;">${entry.name}</strong>
                    </p>

                    ${step === 1 && html`
                        ${isSourceFile && hasCHD && html`
                            <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 4px; margin-bottom: 15px;">
                                <p style="color: var(--success); margin-bottom: 8px;">✓ A CHD file exists for this source</p>
                                ${isAlreadyVerified ? html`
                                    <p style="color: var(--success);">✓ CHD has been verified</p>
                                ` : html`
                                    <p style="color: var(--warning);">
                                        ⚠️ CHD has not been verified. We recommend verifying before deleting the source.
                                    </p>
                                `}
                            </div>
                        `}
                        ${isSourceFile && !hasCHD && html`
                            <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 4px; margin-bottom: 15px; border: 1px solid var(--error);">
                                <p style="color: var(--error);">
                                    ⚠️ <strong>WARNING:</strong> No CHD file exists for this source file. Deleting it will result in data loss!
                                </p>
                            </div>
                        `}
                        <p style="color: var(--text-secondary); margin-bottom: 15px;">This action cannot be undone.</p>
                        ${error && html`
                            <p style="color: var(--error); margin-bottom: 15px; font-size: 0.85rem;">${error}</p>
                        `}
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            ${isSourceFile && hasCHD && !isAlreadyVerified && html`
                                <button class="btn btn-primary" onClick=${handleVerify} disabled=${verifying}>
                                    ${verifying ? 'Verifying CHD...' : '🔍 Verify CHD First'}
                                </button>
                            `}
                            <button
                                class="btn btn-secondary"
                                onClick=${() => setStep(isSourceFile && hasCHD && isAlreadyVerified ? 3 : 2)}
                            >
                                ${isAlreadyVerified ? 'Continue to Delete' : 'Skip Verification'}
                            </button>
                            <button class="btn btn-secondary" onClick=${onClose}>Cancel</button>
                        </div>
                    `}

                    ${step === 2 && html`
                        <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 4px; margin-bottom: 15px; border: 1px solid var(--warning);">
                            <p style="color: var(--warning);">
                                ⚠️ You're about to delete a file without CHD verification.
                            </p>
                        </div>
                        ${verificationResult && !verificationResult.valid && html`
                            <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 4px; margin-bottom: 15px; border: 1px solid var(--error);">
                                <p style="color: var(--error);">
                                    ❌ CHD verification failed: ${verificationResult.message}
                                </p>
                            </div>
                        `}
                        <p style="color: var(--text-secondary); margin-bottom: 15px;">
                            Are you <strong>absolutely sure</strong> you want to proceed?
                        </p>
                        ${error && html`
                            <p style="color: var(--error); margin-bottom: 15px; font-size: 0.85rem;">${error}</p>
                        `}
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <button class="btn btn-secondary" style="background: var(--error);" onClick=${handleDelete} disabled=${deleting}>
                                ${deleting ? 'Deleting...' : 'Yes, Delete Anyway'}
                            </button>
                            <button class="btn btn-secondary" onClick=${onClose}>Cancel</button>
                        </div>
                    `}

                    ${step === 3 && html`
                        ${verificationResult && verificationResult.valid && html`
                            <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 4px; margin-bottom: 15px; border: 1px solid var(--success);">
                                <p style="color: var(--success);">
                                    ✓ CHD verified successfully! Safe to delete source file.
                                </p>
                            </div>
                        `}
                        ${isAlreadyVerified && !verificationResult && html`
                            <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 4px; margin-bottom: 15px; border: 1px solid var(--success);">
                                <p style="color: var(--success);">
                                    ✓ CHD was previously verified. Safe to delete source file.
                                </p>
                            </div>
                        `}
                        <p style="color: var(--text-secondary); margin-bottom: 15px;">
                            Confirm deletion of the source file?
                        </p>
                        ${error && html`
                            <p style="color: var(--error); margin-bottom: 15px; font-size: 0.85rem;">${error}</p>
                        `}
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <button class="btn btn-primary" onClick=${handleDelete} disabled=${deleting}>
                                ${deleting ? 'Deleting...' : 'Delete Source File'}
                            </button>
                            <button class="btn btn-secondary" onClick=${onClose}>Cancel</button>
                        </div>
                    `}
                </div>
            </div>
        </div>
    `;
}

// ============ Main App ============

function App() {
    // State
    const [volumes, setVolumes] = useState([]);
    const [volumesLoading, setVolumesLoading] = useState(true);
    const [volumesError, setVolumesError] = useState(null);
    const [selectedVolume, setSelectedVolume] = useState(null);
    const [currentPath, setCurrentPath] = useState(null);
    const [entries, setEntries] = useState([]);
    const [entriesError, setEntriesError] = useState(null);
    const [selectedFiles, setSelectedFiles] = useState(new Map());
    const [jobs, setJobs] = useState([]);
    const [creatingJobs, setCreatingJobs] = useState([]);
    const [, setHiddenJobIds] = useState(new Set());
    const [loading, setLoading] = useState(false);
    const [conversionMode, setConversionMode] = useState('createcd');
    const [outputDir, setOutputDir] = useState('');
    const [showCHDInfo, setShowCHDInfo] = useState(null);
    const [searchMode, setSearchMode] = useState(false);
    const [searchResults, setSearchResults] = useState(null);
    const [showHelp, setShowHelp] = useState(false);
    const [notification, setNotification] = useState(null);
    const [converting, setConverting] = useState(false);
    const [duplicateCheck, setDuplicateCheck] = useState(null); // { duplicates: [], paths: [] }
    const [autoRefresh, setAutoRefresh] = useState(true); // Auto-refresh file list
    const [currentArchivePath, setCurrentArchivePath] = useState(null); // Track current archive being viewed
    const [renameTarget, setRenameTarget] = useState(null); // Entry to rename
    const [deleteTarget, setDeleteTarget] = useState(null); // Entry to delete
    const [verifiedCHDs, setVerifiedCHDs] = useState(new Set()); // Set of verified CHD paths

    // Ref to track current path for use in callbacks
    const currentPathRef = useRef(null);
    currentPathRef.current = currentPath;

    // Ref to track current archive path for use in callbacks
    const currentArchivePathRef = useRef(null);
    currentArchivePathRef.current = currentArchivePath;

    // Show notification
    const notify = (message, type = 'info') => {
        setNotification({ message, type });
        setTimeout(() => setNotification(null), 4000);
    };

    // Refresh file list for current directory or archive (transparent merge to avoid flicker)
    const refreshFileList = useCallback((showSpinner = false) => {
        const path = currentPathRef.current;
        const archivePath = currentArchivePathRef.current;

        if (searchMode) return;

        // If we're viewing an archive, refresh the archive contents
        if (archivePath) {
            if (showSpinner) setLoading(true);
            api.listArchive(archivePath)
                .then(archiveData => {
                    if (!archiveData || !archiveData.files) return;

                    const newArchiveEntries = archiveData.files.map(file => ({
                        name: file.name,
                        path: `${archivePath}::${file.internal_path}`,
                        type: 'file',
                        size: file.size,
                        extension: file.extension,
                        convertible: file.convertible,
                        has_chd: file.has_chd || false,
                        is_archive_item: true,
                        archive_path: archivePath
                    }));

                    // Merge entries transparently to preserve UI stability
                    setEntries(prevEntries => {
                        if (prevEntries.length === newArchiveEntries.length) {
                            const hasChanges = newArchiveEntries.some((newEntry, i) => {
                                const oldEntry = prevEntries[i];
                                return oldEntry.name !== newEntry.name ||
                                       oldEntry.path !== newEntry.path ||
                                       oldEntry.size !== newEntry.size ||
                                       oldEntry.convertible !== newEntry.convertible ||
                                       oldEntry.has_chd !== newEntry.has_chd;
                            });
                            if (!hasChanges) return prevEntries;
                        }
                        return newArchiveEntries;
                    });
                })
                .catch(err => {
                    console.error('Failed to refresh archive contents:', err);
                })
                .finally(() => {
                    if (showSpinner) setLoading(false);
                });
            return;
        }

        // Otherwise refresh the directory contents
        if (path) {
            if (showSpinner) setLoading(true);
            api.listFiles(path)
                .then(data => {
                    // Merge entries transparently to preserve UI stability
                    setEntries(prevEntries => {
                        const newEntries = data.entries;
                        // If the lists are identical in length and names, check for actual changes
                        if (prevEntries.length === newEntries.length) {
                            const hasChanges = newEntries.some((newEntry, i) => {
                                const oldEntry = prevEntries[i];
                                return oldEntry.name !== newEntry.name ||
                                       oldEntry.path !== newEntry.path ||
                                       oldEntry.size !== newEntry.size ||
                                       oldEntry.type !== newEntry.type ||
                                       oldEntry.convertible !== newEntry.convertible ||
                                       oldEntry.has_chd !== newEntry.has_chd;
                            });
                            // Only update if there are actual changes
                            if (!hasChanges) return prevEntries;
                        }
                        return newEntries;
                    });
                })
                .catch(err => {
                    console.error('Failed to refresh file list:', err);
                })
                .finally(() => {
                    if (showSpinner) setLoading(false);
                });
        }
    }, [searchMode]);

    // Load volumes on mount
    useEffect(() => {
        setVolumesLoading(true);
        api.getVolumes()
            .then(vols => {
                setVolumes(vols);
                setVolumesError(null);
                if (vols.length > 0) {
                    setSelectedVolume(vols[0]);
                    setCurrentPath(vols[0].path);
                }
                // Show help on first visit if no volumes
                if (vols.length === 0) {
                    setShowHelp(true);
                }
            })
            .catch(err => {
                setVolumesError(err.message);
                console.error('Failed to load volumes:', err);
            })
            .finally(() => setVolumesLoading(false));
    }, []);

    // Load files when path changes
    useEffect(() => {
        if (currentPath) {
            setLoading(true);
            setEntriesError(null);
            api.listFiles(currentPath)
                .then(data => {
                    setEntries(data.entries);
                    setSearchMode(false);
                    setSearchResults(null);
                })
                .catch(err => {
                    setEntriesError(err.message);
                    console.error('Failed to list files:', err);
                })
                .finally(() => setLoading(false));
        }
    }, [currentPath]);

    // Subscribe to job updates
    useEffect(() => {
        // Helper to merge server jobs with local state, respecting hidden jobs
        const mergeJobs = (serverJobs, currentJobs, currentHiddenIds) => {
            // Filter out hidden jobs from server response
            const visibleServerJobs = serverJobs.filter(j => !currentHiddenIds.has(j.id));

            // Merge: prefer server state but keep local jobs that aren't on server yet
            const mergedJobs = [];
            const seenIds = new Set();

            // Add all visible server jobs (they have the authoritative state)
            for (const serverJob of visibleServerJobs) {
                mergedJobs.push(serverJob);
                seenIds.add(serverJob.id);
            }

            // Add any local jobs that aren't from the server yet (e.g., optimistic updates)
            for (const localJob of currentJobs) {
                if (!seenIds.has(localJob.id) && !currentHiddenIds.has(localJob.id)) {
                    // Keep local job if it's not yet on server (might be in-flight)
                    // But only if it's a temporary/creating job
                    if (localJob.id.startsWith('pending-')) {
                        mergedJobs.push(localJob);
                    }
                }
            }

            return mergedJobs;
        };

        // Fetch initial jobs list
        api.getJobs()
            .then(serverJobs => {
                setHiddenJobIds(currentHidden => {
                    setJobs(prev => mergeJobs(serverJobs, prev, currentHidden));
                    return currentHidden;
                });
            })
            .catch(() => {});

        const unsubscribe = api.subscribeToJobs((update) => {
            const jobId = update?.data?.job_id;
            if (!jobId) return;

            // Update existing job or fetch if new
            setJobs(prevJobs => {
                const idx = prevJobs.findIndex(j => j.id === jobId);

                if (idx === -1) {
                    // Job not in our list - fetch it from server
                    api.getJob(jobId)
                        .then(job => {
                            setHiddenJobIds(currentHidden => {
                                if (currentHidden.has(job.id)) return currentHidden;
                                setJobs(prev => prev.some(j => j.id === job.id) ? prev : [job, ...prev]);
                                return currentHidden;
                            });
                        })
                        .catch(() => {});
                    return prevJobs;
                }

                const newJobs = [...prevJobs];
                newJobs[idx] = {
                    ...newJobs[idx],
                    progress: update.data.progress ?? newJobs[idx].progress,
                    message: update.data.message ?? newJobs[idx].message,
                    status: update.type === 'complete' ? 'completed' :
                            update.type === 'error' ? 'failed' :
                            update.data.status ?? newJobs[idx].status,
                    error_message: update.data.error,
                    output_size: update.data.output_size
                };

                if (update.type === 'complete') {
                    notify(`Completed: ${newJobs[idx].filename}`, 'success');
                    // Refresh file list to show the new CHD file
                    refreshFileList();
                } else if (update.type === 'error') {
                    notify(`Failed: ${newJobs[idx].filename}`, 'error');
                }

                return newJobs;
            });
        });

        // Poll jobs periodically - merge instead of replace
        const interval = setInterval(() => {
            api.getJobs()
                .then(serverJobs => {
                    setHiddenJobIds(currentHidden => {
                        setJobs(prev => mergeJobs(serverJobs, prev, currentHidden));
                        return currentHidden;
                    });
                })
                .catch(() => {});
        }, 4000);

        return () => {
            unsubscribe();
            clearInterval(interval);
        };
    }, [refreshFileList]);

    // Auto-refresh file list when enabled
    useEffect(() => {
        if (!autoRefresh || !currentPath || searchMode) return;

        const interval = setInterval(() => {
            refreshFileList(false); // Silent refresh, no spinner
        }, 3000); // Refresh every 3 seconds

        return () => clearInterval(interval);
    }, [autoRefresh, currentPath, searchMode, refreshFileList]);

    // Handlers
    const handleVolumeSelect = (vol) => {
        setSelectedVolume(vol);
        setCurrentPath(vol.path);
        setSelectedFiles(new Map());
        setCurrentArchivePath(null); // Exit archive view when changing volumes
    };

    const handleNavigate = (path) => {
        setCurrentPath(path);
        setSelectedFiles(new Map());
        setCurrentArchivePath(null); // Exit archive view when navigating directories
    };

    const handleBrowseArchive = async (archivePath) => {
        setLoading(true);
        setEntriesError(null);
        const archiveName = archivePath.split('/').pop();
        notify(`📦 Loading archive: ${archiveName}...`, 'info');

        try {
            const archiveData = await api.listArchive(archivePath);

            if (!archiveData || !archiveData.files || archiveData.files.length === 0) {
                notify(`ℹ No convertible files found in ${archiveName}`, 'info');
                setEntries([]);
                setCurrentArchivePath(null);
                return;
            }

            const archiveEntries = archiveData.files.map(file => ({
                name: file.name,
                path: `${archivePath}::${file.internal_path}`,
                type: 'file',
                size: file.size,
                extension: file.extension,
                convertible: file.convertible,
                has_chd: file.has_chd || false,
                is_archive_item: true,
                archive_path: archivePath
            }));

            setCurrentArchivePath(archivePath); // Track that we're in archive view
            setEntries(archiveEntries);
            setSearchMode(false);
            setSearchResults(null);
            notify(`✓ Loaded ${archiveEntries.length} file(s) from ${archiveName}`, 'success');
        } catch (err) {
            setEntriesError(err.message);
            console.error('Failed to browse archive:', err);
            notify(`✗ Failed to browse archive: ${err.message}`, 'error');
            setCurrentArchivePath(null);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleSelect = (entry) => {
        setSelectedFiles(prev => {
            const next = new Map(prev);
            if (next.has(entry.path)) {
                next.delete(entry.path);
            } else {
                next.set(entry.path, entry);
            }
            return next;
        });
    };

    const handleSelectAll = () => {
        const convertible = entries.filter(e => e.convertible && !e.has_chd);
        if (selectedFiles.size === convertible.length) {
            setSelectedFiles(new Map());
        } else {
            const newMap = new Map();
            convertible.forEach(e => newMap.set(e.path, e));
            setSelectedFiles(newMap);
        }
    };

    // File operations handlers
    const handleRename = async (path, newName) => {
        await api.renameFile(path, newName);
        notify(`✓ Renamed to ${newName}`, 'success');
        refreshFileList(true);
    };

    const handleDelete = async (path) => {
        await api.deleteFile(path);
        notify('✓ File deleted', 'success');
        refreshFileList(true);
    };

    const handleVerify = async (chdPath) => {
        const result = await api.verifyCHD(chdPath);
        if (result.valid) {
            setVerifiedCHDs(prev => new Set([...prev, chdPath]));
            notify('✓ CHD verified successfully', 'success');
        } else {
            notify(`✗ CHD verification failed: ${result.message}`, 'error');
        }
        return result;
    };

    // Helper to calculate expected output path
    const getExpectedOutputPath = (filePath) => {
        // Get the filename (handle archive paths like "archive.zip::game.iso")
        const filename = (filePath.includes('::') ? filePath.split('::').pop() : filePath).split('/').pop();
        // Replace extension with .chd
        const chdFilename = filename.replace(/\.[^.]+$/, '.chd');

        // Determine output directory
        let outDir;
        if (outputDir) {
            outDir = outputDir;
        } else if (filePath.includes('::')) {
            // For archive files, output goes next to the archive
            outDir = filePath.split('::')[0].split('/').slice(0, -1).join('/');
        } else {
            // For regular files, output goes next to the source
            outDir = filePath.split('/').slice(0, -1).join('/');
        }

        return `${outDir}/${chdFilename}`;
    };

    // Execute conversion with specified duplicate action
    const executeConversion = async (paths, duplicateAction = 'skip') => {
        // Build optimistic placeholder jobs so the user sees immediate feedback
        const placeholders = paths.map((p, i) => ({
            id: `pending-${Date.now()}-${i}`,
            file_path: p,
            filename: (p.includes('::') ? p.split('::').pop() : p).split('/').pop(),
            mode: conversionMode,
            status: 'creating',
            progress: 0,
            message: 'Setting up conversion...',
            output_path: getExpectedOutputPath(p)
        }));
        setCreatingJobs(placeholders);

        setConverting(true);
        try {
            notify(`⏳ Creating ${paths.length} conversion job(s)...`, 'info');

            const newJobs = await api.createBatchJobs(
                paths,
                conversionMode,
                outputDir || null,
                duplicateAction
            );

            // Clear placeholders and prepend real jobs
            setCreatingJobs([]);
            setJobs(prev => [...newJobs, ...prev]);
            setSelectedFiles(new Map());

            if (newJobs.length > 0) {
                notify(`✓ Started ${newJobs.length} conversion job(s)`, 'success');
            } else {
                notify('ℹ No jobs created (all files were skipped)', 'info');
            }
        } catch (err) {
            const errorMsg = err.message || 'Unknown error occurred';
            // Mark placeholders as failed so user sees what went wrong
            setCreatingJobs(prev => prev.map(j => ({...j, status: 'failed', error_message: errorMsg, message: `Failed to create: ${errorMsg}`})));
            notify(`✗ Failed to create jobs: ${errorMsg}`, 'error');
            console.error('Failed to create jobs:', err);
        } finally {
            // Remove failed placeholders after a short delay
            setTimeout(() => setCreatingJobs(prev => prev.filter(j => j.status !== 'failed')), 2500);
            setConverting(false);
        }
    };

    const handleConvert = async () => {
        const paths = Array.from(selectedFiles.keys());
        if (paths.length === 0) {
            notify('⚠ Please select at least one file to convert', 'error');
            return;
        }

        // Show loading state immediately to prevent UI appearing frozen
        setConverting(true);

        // Check for duplicates
        try {
            const duplicates = await api.checkDuplicates(paths, outputDir || null);
            const hasDuplicates = duplicates.some(d => d.exists);

            if (hasDuplicates) {
                // Show duplicate handling modal (pause converting state while modal is shown)
                setConverting(false);
                setDuplicateCheck({ duplicates, paths });
                return;
            }

            // No duplicates, proceed directly (executeConversion will manage converting state)
            setConverting(false);
            await executeConversion(paths, 'skip');
        } catch (err) {
            setConverting(false);
            notify(`✗ Failed to check for duplicates: ${err.message}`, 'error');
            console.error('Duplicate check failed:', err);
        }
    };

    const handleDuplicateAction = async (action) => {
        if (!duplicateCheck) return;

        const { paths } = duplicateCheck;
        setDuplicateCheck(null); // Close modal

        await executeConversion(paths, action);
    };

    const handleSearch = async () => {
        if (!currentPath) {
            notify('⚠ No path selected', 'error');
            return;
        }
        
        setLoading(true);
        setEntriesError(null);
        notify('🔍 Searching for convertible files...', 'info');
        
        try {
            const results = await api.searchFiles(currentPath, true, true);
            setSearchResults(results);
            setSearchMode(true);

            const combined = [
                ...results.files.map(f => ({
                    ...f,
                    type: 'file',
                    convertible: true
                })),
                ...results.archives.map(a => ({
                    ...a,
                    name: `${a.name} (in ${a.archive_path.split('/').pop()})`,
                    type: 'file',
                    convertible: true
                }))
            ];
            setEntries(combined);

            if (combined.length === 0) {
                notify('ℹ No convertible files found', 'info');
            } else {
                notify(`✓ Found ${combined.length} convertible file(s)`, 'success');
            }
        } catch (err) {
            setEntriesError(err.message);
            notify(`✗ Search failed: ${err.message}`, 'error');
            console.error('Search failed:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleCancelJob = async (jobId) => {
        try {
            await api.cancelJob(jobId);
            setJobs(prev => prev.map(j =>
                j.id === jobId ? { ...j, status: 'cancelled' } : j
            ));
            notify('Job cancelled', 'info');
        } catch (err) {
            notify(`Failed to cancel: ${err.message}`, 'error');
            console.error('Failed to cancel job:', err);
        }
    };

    const handleClearCompleted = async () => {
        // Find all completed/failed/cancelled jobs
        const completedJobs = jobs.filter(j => ['completed', 'failed', 'cancelled'].includes(j.status));

        if (completedJobs.length === 0) return;

        // Immediately hide these jobs from the UI
        const idsToHide = completedJobs.map(j => j.id);
        setHiddenJobIds(prev => {
            const next = new Set(prev);
            idsToHide.forEach(id => next.add(id));
            return next;
        });
        setJobs(prev => prev.filter(j => !['completed', 'failed', 'cancelled'].includes(j.status)));

        // Delete all completed jobs from the server in one request
        try {
            await api.deleteCompletedJobs();
            // Successfully deleted - clean up hidden set
            setHiddenJobIds(prev => {
                const next = new Set(prev);
                idsToHide.forEach(id => next.delete(id));
                return next;
            });
        } catch (err) {
            // If deletion fails, jobs will reappear on next poll
            // Remove from hidden set so they become visible again
            console.error('Failed to delete completed jobs:', err);
            setHiddenJobIds(prev => {
                const next = new Set(prev);
                idsToHide.forEach(id => next.delete(id));
                return next;
            });
        }
    };

    const convertibleCount = entries.filter(e => e.convertible && !e.has_chd).length;
    const hasCompletedJobs = jobs.some(j => ['completed', 'failed', 'cancelled'].includes(j.status));

    return html`
        <div class="container">
            ${notification && html`
                <div class="notification ${notification.type}">
                    ${notification.message}
                </div>
            `}

            <header>
                <div>
                    <h1><span>CHD</span> Converter</h1>
                    <span class="subtitle">Convert game disc images to CHD format</span>
                </div>
                <button
                    class="btn btn-secondary help-btn"
                    onClick=${() => setShowHelp(!showHelp)}
                    title="Show help"
                >
                    ${showHelp ? 'Hide Help' : '? Help'}
                </button>
            </header>

            ${showHelp && html`<${HelpPanel} onClose=${() => setShowHelp(false)} />`}

            <div class="main-layout">
                <!-- Volumes Panel -->
                <div class="panel">
                    <div class="panel-header">
                        <h2>Volumes</h2>
                    </div>
                    <div class="panel-content">
                        <${VolumeList}
                            volumes=${volumes}
                            selectedVolume=${selectedVolume}
                            onSelect=${handleVolumeSelect}
                            loading=${volumesLoading}
                            error=${volumesError}
                        />
                    </div>
                </div>

                <!-- Files Panel -->
                <div class="panel">
                    <div class="panel-header">
                        <h2>Files</h2>
                        <div class="header-actions">
                            ${searchMode && html`
                                <button
                                    class="btn btn-sm btn-secondary"
                                    onClick=${() => handleNavigate(currentPath)}
                                    title="Clear search and show folder contents"
                                >
                                    ← Back
                                </button>
                            `}
                            ${!searchMode && html`
                                <button
                                    class="btn btn-sm btn-secondary"
                                    onClick=${() => refreshFileList(true)}
                                    disabled=${loading || !currentPath}
                                    title="Refresh file list"
                                >
                                    ↻
                                </button>
                                <label class="auto-refresh-toggle" title="Auto-refresh file list every 3 seconds">
                                    <input
                                        type="checkbox"
                                        checked=${autoRefresh}
                                        onChange=${(e) => setAutoRefresh(e.target.checked)}
                                    />
                                    <span class="auto-refresh-label">Live${autoRefresh ? ' ●' : ''}</span>
                                </label>
                            `}
                            <button
                                class="btn btn-sm btn-secondary"
                                onClick=${handleSearch}
                                disabled=${loading || !currentPath}
                                title="Search recursively for all convertible files"
                            >
                                🔍 Search All
                            </button>
                        </div>
                    </div>

                    <${Breadcrumb}
                        path=${currentPath}
                        volume=${selectedVolume}
                        onNavigate=${handleNavigate}
                    />

                    ${currentArchivePath && html`
                        <div class="archive-indicator">
                            <button
                                class="btn btn-sm btn-secondary"
                                onClick=${() => {
                                    setCurrentArchivePath(null);
                                    refreshFileList(true);
                                }}
                                title="Return to folder view"
                            >
                                ← Back
                            </button>
                            <span class="archive-name" title=${currentArchivePath}>
                                📦 Viewing: ${currentArchivePath.split('/').pop()}
                            </span>
                        </div>
                    `}

                    ${searchMode && searchResults && html`
                        <div class="search-results">
                            <h3>Found ${searchResults.total_files} file(s), ${searchResults.total_in_archives} in archives</h3>
                        </div>
                    `}

                    <div class="toolbar">
                        <select
                            value=${conversionMode}
                            onChange=${(e) => setConversionMode(e.target.value)}
                            title="Select conversion mode based on your disc type"
                        >
                            <option value="createcd">CD Mode (Dreamcast, PS1, Sega CD)</option>
                            <option value="createdvd">DVD Mode (PSP, PS2)</option>
                        </select>
                        ${convertibleCount > 0 && html`
                            <button
                                class="btn btn-sm btn-secondary"
                                onClick=${handleSelectAll}
                                title=${selectedFiles.size === convertibleCount ? 'Deselect all files' : 'Select all convertible files'}
                            >
                                ${selectedFiles.size === convertibleCount ? 'Deselect All' : `Select All (${convertibleCount})`}
                            </button>
                        `}
                        <button
                            class="btn btn-primary"
                            disabled=${selectedFiles.size === 0 || converting}
                            onClick=${handleConvert}
                            title=${converting ? 'Converting...' : selectedFiles.size > 0 ? `Convert ${selectedFiles.size} selected file(s) to CHD` : 'Select files to convert'}
                        >
                            ${converting 
                                ? html`<span class="spinner" style="display: inline-block; width: 12px; height: 12px; margin-right: 8px; border-width: 2px;"></span>Converting...`
                                : `Convert ${selectedFiles.size > 0 ? `(${selectedFiles.size})` : ''}`
                            }
                        </button>
                    </div>

                    <div class="output-dir-selector">
                        <label title="Leave empty to save CHD files next to source files">Output directory:</label>
                        <input
                            type="text"
                            placeholder="Same as source (leave empty)"
                            value=${outputDir}
                            onInput=${(e) => setOutputDir(e.target.value)}
                            title="Optional: Specify a custom directory for output CHD files"
                        />
                    </div>

                    ${selectedFiles.size > 0 && html`
                        <div class="output-dir-display">
                            <span class="icon">📁</span>
                            <span class="path" title=${outputDir || currentPath || 'Source file location'}>
                                <strong>Output:</strong> ${outputDir || currentPath || 'Same folder as source files'}
                            </span>
                            <span style="opacity: 0.7;">(${selectedFiles.size} file${selectedFiles.size > 1 ? 's' : ''} selected)</span>
                        </div>
                    `}

                    <div class="panel-content">
                        ${loading
                            ? html`<div class="loading"><div class="spinner"></div>Loading...</div>`
                            : html`<${FileList}
                                entries=${entries}
                                selectedFiles=${selectedFiles}
                                onNavigate=${handleNavigate}
                                onToggleSelect=${handleToggleSelect}
                                onShowInfo=${setShowCHDInfo}
                                onBrowseArchive=${handleBrowseArchive}
                                onRename=${setRenameTarget}
                                onDelete=${setDeleteTarget}
                                onVerify=${handleVerify}
                                verifiedCHDs=${verifiedCHDs}
                                error=${entriesError}
                            />`
                        }
                    </div>
                </div>

                <!-- Jobs Panel -->
                <div class="panel jobs-panel">
                    <div class="panel-header">
                        <h2>Jobs ${jobs.length > 0 ? `(${jobs.length})` : ''}</h2>
                        <div class="header-actions">
                            ${hasCompletedJobs && html`
                                <button
                                    class="btn btn-sm btn-secondary"
                                    onClick=${handleClearCompleted}
                                    title="Remove completed, failed, and cancelled jobs from the list"
                                >
                                    Clear Done
                                </button>
                            `}
                            <button
                                class="btn btn-sm btn-secondary"
                                onClick=${() => api.getJobs().then(setJobs)}
                                title="Refresh job list"
                            >
                                ↻
                            </button>
                        </div>
                    </div>
                    <div class="panel-content">
                        <${JobList}
                            jobs=${creatingJobs.length ? [...creatingJobs, ...jobs] : jobs}
                            onCancel=${handleCancelJob}
                        />
                    </div>
                </div>
            </div>

            ${showCHDInfo && html`
                <${CHDInfoModal}
                    path=${showCHDInfo}
                    onClose=${() => setShowCHDInfo(null)}
                />
            `}

            ${duplicateCheck && html`
                <${DuplicateModal}
                    duplicates=${duplicateCheck.duplicates}
                    onAction=${handleDuplicateAction}
                    onClose=${() => setDuplicateCheck(null)}
                />
            `}

            ${renameTarget && html`
                <${RenameModal}
                    entry=${renameTarget}
                    onRename=${handleRename}
                    onClose=${() => setRenameTarget(null)}
                />
            `}

            ${deleteTarget && html`
                <${DeleteModal}
                    entry=${deleteTarget}
                    hasCHD=${deleteTarget.has_chd}
                    verifiedCHDs=${verifiedCHDs}
                    onDelete=${handleDelete}
                    onVerify=${handleVerify}
                    onClose=${() => setDeleteTarget(null)}
                />
            `}
        </div>
    `;
}

// Render app
render(html`<${App} />`, document.getElementById('app'));
