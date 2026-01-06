/**
 * INTERACT.JS
 * Handling UI State, DOM Rendering, and Local Interactions.
 */

// =================================================================================
// 1. CONFIGURATION & GLOBAL STATE
// =================================================================================
const TABS = { LOTSO: 'lotso', CONTENTS: 'contents', SETTINGS: 'settings' };
const MAX_QUESTIONS = 6;

const DEFAULT_SETTINGS = {
    // (Legacy) kept for compatibility, but UI no longer uses a global "Edit Names" toggle.
    isCustomNamesEnabled: false,
    f1a2: "3",
    f2a3: "2",
    f3a4: "2",
    f4a5: "2",
    f5a6: "2",
    af1: "5",
    af2: "3",
    af3: "3",
    af4: "3",
    af5: "3",
    minGap: "2",
    randSeed: "12345",
    replaceImage: true,
    preserveMarker: false,
    compMain: "GRID",
    compQa: "REPLACE Q&A",
    compGrid: "Grid",
    compAnswers: "ANSWERS",
    layerCtrl: "Controller",
    advLayerCtrl: "Advnc_Controller",
    // NOTE: CrosswordAutoPlacer.jsx builds the Q/A layer names as PREFIX + index.
    // In the standalone script, the default prefixes include a trailing space
    // (e.g., "QUESTION 1" and "ANSWER 1").
    // Keep the same defaults here so Q/A updates work out of the box.
    layerQ: "QUESTION ",
    layerA: "ANSWER ",
    layerTile: "Tile",
    layerParent: "PARENT", // REQUIREMENT: Default text "PARENT"
    fxNum: "Num",
    fxRow: "Row",
    fxCol: "Column",
    fxRot: "Rotation",
    fxLetter: "L"
};

let activeTab = TABS.CONTENTS;
let activeGrid = null;
let isAutoFrenzy = false;
let is60SecVid = false;
let savedSettings = { ...DEFAULT_SETTINGS };

// Load persisted settings (if any). Merge with defaults so new keys get defaults.
try {
    const raw = localStorage.getItem('nova_savedSettings');
    if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            savedSettings = { ...DEFAULT_SETTINGS, ...parsed };
        }
    }
} catch (e) {
    // ignore
}

const panelStates = Array(MAX_QUESTIONS + 1).fill(false);
window.globalFrenzyCache = {}; 

// =================================================================================
// 2. PROFESSIONAL NOTIFICATION SYSTEM
// =================================================================================

function showToast(msg, duration = 3000) {
    const toast = document.getElementById('toast-notification');
    const toastMsg = document.getElementById('toast-message');
    if (!toast || !toastMsg) return;

    toastMsg.textContent = msg;
    toast.classList.remove('hidden', 'opacity-0');
    toast.classList.add('opacity-100');

    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    window.toastTimeout = setTimeout(() => {
        toast.classList.remove('opacity-100');
        toast.classList.add('opacity-0');
        setTimeout(() => toast.classList.add('hidden'), 300);
    }, duration);
}

// =================================================================================
// 3. GLOBAL EVENT LISTENERS & FIXES
// =================================================================================

window.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('click', (e) => {
    const dropdown = document.getElementById('preset-dropdown-menu');
    const container = document.getElementById('preset-dropdown-container');
    if (dropdown && !dropdown.classList.contains('hidden')) {
        if (!container.contains(e.target)) {
            togglePresetDropdown();
        }
    }
});

// =================================================================================
// 4. UI UTILITIES
// =================================================================================

function slugify(s) { return (s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
function newId() { return Math.floor(Date.now() + Math.random()*1e6).toString(36); }
function nowISO() { return new Date().toISOString(); }
function parseLines(str){ return (str||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean); }

function toDisplayPath(path){ 
    if (!path) return '/DTC_Presets';
    const cleanPath = path.replace(/\\/g, '/');
    const parts = cleanPath.split('/').filter(Boolean);
    return parts.length > 0 ? '/' + parts[parts.length - 1] : '/DTC_Presets'; 
}

// =================================================================================
// 5. TAB LOGIC
// =================================================================================

function setActiveTab(tabId) {
    activeTab = tabId;
    document.querySelectorAll('.tab-button').forEach(btn => {
        if(btn.id === `tab-${tabId}`) {
            btn.classList.add('bg-white', 'text-gray-900', 'shadow-lg');
            btn.classList.remove('text-gray-400');
        } else {
            btn.classList.remove('bg-white', 'text-gray-900', 'shadow-lg');
            btn.classList.add('text-gray-400');
        }
    });
    document.querySelectorAll('.tab-page').forEach(page => {
        page.classList.toggle('hidden', page.id !== `page-${tabId}`);
    });
}

// =================================================================================
// 6. CONTENT MODE & PANEL RENDERING
// =================================================================================

function updateContentMode(force) {
    const afCheckbox = document.getElementById('checkbox-auto-frenzy');
    const vidCheckbox = document.getElementById('checkbox-60-sec-vid');
    
    isAutoFrenzy = afCheckbox ? afCheckbox.checked : false;
    is60SecVid = vidCheckbox ? vidCheckbox.checked : false;

    if(force) renderQuestionPanels();
    updatePanelVisibilityAndInputs();
}

function handleCheckboxChange(is60Sec) {
    updateContentMode(false); 
}

function renderQuestionPanels() {
    const container = document.getElementById('question-panels');
    if(!container) return;
    container.innerHTML = '';
    for(let i=1; i<=MAX_QUESTIONS; i++) {
        container.innerHTML += generateQuestionPanel(i);
    }
    // EXTRA IMAGES PANEL (CC)
    container.innerHTML += generateCCExtraImagesPanel();
    // Bind CC events (in addition to inline onclick) to ensure CEP reliably opens file picker
    try { if (typeof bindCCExtraEvents === 'function') bindCCExtraEvents(); } catch(e) {}
    // Ensure CC UI renders correct initial state
    try { if (typeof renderCCExtraImages === 'function') renderCCExtraImages(); } catch(e) {}
}

function generateCCExtraImagesPanel() {
    const collapsedClass = panelStates[0] ? 'collapsed' : '';
    return `
    <div id="wrapper-cc-extra" class="question-panel-wrapper">
        <div id="cc-extra-panel" class="question-panel card-bg p-1 rounded-xl shadow-2xl transition duration-300 w-full max-w-3xl min-panel-width ${collapsedClass}">
            <input type="file" id="cc-extra-image-input" accept="image/*" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;" multiple onchange="handleCCExtraImageSelection(event)">
            <div class="flex items-center justify-between cursor-pointer" onclick="toggleQuestion('cc-extra-panel', 0)">
                <div class="flex items-center space-x-3">
                    <button class="toggle-icon text-gray-400 hover:text-white focus:outline-none p-0.5 rounded-full bg-slate-900">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M6 9l6 6 6-6"/></svg>
                    </button>
                    <h2 class="text-sm font-semibold text-gray-100 uppercase tracking-wide">Select extra images for CC :</h2>
                </div>
                <div class="w-3 h-3 rounded-full border-2 border-gray-500 bg-transparent"></div>
            </div>
            <div class="content-area pt-1">
                <div id="cc-extra-images-strip" class="cc-extra-strip flex flex-wrap items-center gap-2 p-2 rounded-lg bg-slate-900 border border-gray-700">
                    <div id="cc-extra-images-list" class="flex flex-wrap items-center gap-2"></div>
                    <button id="cc-extra-add-btn" class="cc-extra-add-btn flex items-center justify-center rounded-md border border-gray-600 hover:border-gray-400 hover:bg-slate-800 transition" onclick="openCCExtraImagePicker(event)" title="Add image">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-gray-200"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                    </button>
                </div>
            </div>
        </div>
    </div>
    `;
}

// =============================================================================================
// CC EXTRA IMAGES (CONTENTS TAB)
// - + button opens an image picker
// - thumbnails show inside the panel
// - each thumbnail has a small delete button
// NOTE: Implemented as additive code only. No existing logic removed.
// =============================================================================================

// Keep a shared global array (used by preset save/load + payload build in Uifn.js)
// If another file already defines it, we reuse it.
try {
    if (typeof window !== 'undefined') {
        if (!window.ccExtraImages) window.ccExtraImages = [];
    }
} catch (e) {}

// Local alias (kept in sync with window.ccExtraImages)
var ccExtraImages = (typeof window !== 'undefined' && window.ccExtraImages) ? window.ccExtraImages : [];

// Track removed preset asset relPaths so Save Changes can delete them from disk.
// (Additive; does not change existing data model used elsewhere.)
try {
    if (typeof window !== 'undefined') {
        if (!window.deletedPresetAssetRelPaths) window.deletedPresetAssetRelPaths = [];
    }
} catch (e) {}

function bindCCExtraEvents() {
    try {
        const addBtn = document.getElementById('cc-extra-add-btn');
        const input = document.getElementById('cc-extra-image-input');
        // Keep a stable reference so the + button never "disappears" if the list is re-rendered.
        // (When the button is appended inside the list, list.innerHTML='' would remove it from the DOM
        // and subsequent getElementById() calls would return null.)
        try { if (typeof window !== 'undefined' && addBtn) window._ccExtraAddBtnRef = addBtn; } catch (x) {}
        if (addBtn) {
            addBtn.onclick = function (ev) { openCCExtraImagePicker(ev); };
        }
        if (input) {
            input.onchange = function (ev) { handleCCExtraImageSelection(ev); };
        }
    } catch (e) {
        console.error(e);
    }
}

function openCCExtraImagePicker(e) {
    try {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const input = document.getElementById('cc-extra-image-input');
        if (input) input.click();
    } catch (err) {
        console.error(err);
    }
}

function handleCCExtraImageSelection(e) {
    try {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        const input = e && e.target ? e.target : document.getElementById('cc-extra-image-input');
        if (!input || !input.files || !input.files.length) {
            // User cancelled: keep UI as-is.
            return;
        }

        const files = Array.prototype.slice.call(input.files);
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (!f) continue;
            // Create a preview URL; path is filled by preset save pipeline when needed.
            const url = URL.createObjectURL(f);
            const id = (typeof newId === 'function') ? newId() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
            // In CEP, File objects usually expose an absolute path via `path`.
            // We store it (if present) so preset save/copy can work.
            ccExtraImages.push({ id, name: f.name || ('image_' + id), file: f, path: f.path || "", relPath: "", dataUrl: "", fileUrl: url });
        }

        // Reset input so the same file can be picked again later
        try { input.value = ""; } catch (x) {}

        // Sync global
        try { if (typeof window !== 'undefined') window.ccExtraImages = ccExtraImages; } catch (x) {}

        renderCCExtraImages();
    } catch (err) {
        console.error(err);
    }
}

function removeCCExtraImage(id, e) {
    try {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        if (!id) return;

        // Confirm delete using the same modal used in SETTINGS grid deletes (more professional than browser confirm)
        // Additive only.
        if (typeof openDeleteConfirmModal === 'function') {
            openDeleteConfirmModal(
                'Delete Image?',
                'Do you want to delete this image?',
                function onConfirm(){
                    const next = [];
                    for (let i = 0; i < (ccExtraImages || []).length; i++) {
                        const it = ccExtraImages[i];
                        if (!it || it.id === id) {
                            // Track asset file for deletion on Save Changes (if it came from preset assets)
                            try {
                                if (it && it.relPath) {
                                    if (!window.deletedPresetAssetRelPaths) window.deletedPresetAssetRelPaths = [];
                                    window.deletedPresetAssetRelPaths.push(it.relPath);
                                }
                            } catch(z) {}
                            // Revoke object URL to avoid leaks
                            try { if (it && it.fileUrl) URL.revokeObjectURL(it.fileUrl); } catch (x) {}
                            continue;
                        }
                        next.push(it);
                    }
                    ccExtraImages = next;
                    try { if (typeof window !== 'undefined') window.ccExtraImages = ccExtraImages; } catch (x) {}
                    renderCCExtraImages();
                    try { if (typeof showToast === 'function') showToast('Image deleted'); } catch(t) {}
                }
            );
        } else {
            // Fallback
            try { if (!confirm('Delete this image?')) return; } catch(x) { return; }
        }
    } catch (err) {
        console.error(err);
    }
}

function renderCCExtraImages() {
    try {
        const list = document.getElementById('cc-extra-images-list');
        if (!list) return;
        // Preserve the + button if it lives inside the list.
        // We detach it before clearing, then append it back as the last item.
        let addBtn = document.getElementById('cc-extra-add-btn');
        if (!addBtn) {
            try { addBtn = (typeof window !== 'undefined' && window._ccExtraAddBtnRef) ? window._ccExtraAddBtnRef : null; } catch (x) {}
        }
        if (addBtn && addBtn.parentNode === list) {
            try { list.removeChild(addBtn); } catch (x) {}
        }
        list.innerHTML = '';

        const items = (typeof window !== 'undefined' && window.ccExtraImages) ? window.ccExtraImages : ccExtraImages;
        ccExtraImages = items || [];

        for (let i = 0; i < ccExtraImages.length; i++) {
            const it = ccExtraImages[i];
            if (!it) continue;
            const src = it.fileUrl || it.dataUrl || (it.path ? (it.path.startsWith('file://') ? it.path : ('file://' + it.path)) : '');
            if (!src) continue;
            const wrap = document.createElement('div');
            wrap.className = 'cc-thumb-wrap relative';
            wrap.setAttribute('data-cc-id', it.id);

            const inner = document.createElement('div');
            inner.className = 'cc-thumb-inner';

            const img = document.createElement('img');
            img.className = 'cc-thumb-img';
            img.src = src;
            img.alt = it.name || 'CC image';

            const name = document.createElement('div');
            name.className = 'cc-thumb-name';
            name.textContent = (it.name || '').toString();

            const del = document.createElement('div');
            del.className = 'cc-thumb-del';
            del.title = 'Remove';
            del.innerHTML = '&times;';
            del.onclick = function(ev){ removeCCExtraImage(it.id, ev); };

            inner.appendChild(img);
            // Keep delete button INSIDE the rounded thumbnail box (so it never goes outside)
            inner.appendChild(del);
            wrap.appendChild(inner);
            wrap.appendChild(name);
            list.appendChild(wrap);
        }

        // Keep the + button as the LAST item in the same flex flow as thumbnails.
        // This ensures it always sits to the right of the last image and wraps naturally
        // when the row is full (instead of dropping awkwardly below).
        try {
            if (!addBtn) addBtn = document.getElementById('cc-extra-add-btn');
            if (addBtn) {
                // Ensure it's the LAST item so it sits to the right of the last thumbnail
                // and wraps naturally to the next line when needed.
                list.appendChild(addBtn);
            }
        } catch (x) {}
    } catch (err) {
        console.error(err);
    }
}

function generateQuestionPanel(index) {
    const collapsedClass = panelStates[index] ? 'collapsed' : '';
    
    return `
    <div id="wrapper-${index}" class="question-panel-wrapper">
        <div id="question-${index}" class="question-panel card-bg p-1 rounded-xl shadow-2xl transition duration-300 w-full max-w-3xl min-panel-width ${collapsedClass}">
            <input type="file" id="image-file-input-${index}" accept="image/*" class="hidden" onchange="handleImageSelection(event, ${index})">
            <div class="flex items-center justify-between cursor-pointer" onclick="toggleQuestion('question-${index}', ${index})">
                <div class="flex items-center space-x-3">
                    <button class="toggle-icon text-gray-400 hover:text-white focus:outline-none p-0.5 rounded-full bg-slate-900">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M6 9l6 6 6-6"/></svg>
                    </button>
                    <h2 class="text-sm font-semibold text-gray-100 uppercase tracking-wide">Question ${index} :</h2>
                </div>
                <div class="w-3 h-3 rounded-full border-2 border-gray-500 bg-transparent"></div>
            </div>
            <div class="content-area pt-1">
                <div class="flex flex-row gap-2">
                    <div class="flex-grow">
                        <textarea id="question-textarea-${index}" rows="4" placeholder="Enter your question" class="w-full p-2 rounded-lg bg-slate-900 border border-gray-700 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-gray-500 resize-none"></textarea>
                    </div>
                    <div class="w-1/4 flex-shrink-0">
                        <div id="image-box-${index}" class="question-image-box relative aspect-square w-full rounded-lg border-2 border-gray-700 bg-slate-900 overflow-hidden group cursor-pointer" onclick="document.getElementById('image-file-input-${index}').click(); event.stopPropagation();">
                            <img id="image-preview-${index}" src="" alt="Selected image" class="absolute inset-0 w-full h-full object-cover hidden">
                            <div id="image-del-${index}" class="q-thumb-del" title="Delete" onclick="deleteQuestionImage(${index}, event)">&times;</div>
                            <div id="image-overlay-${index}" class="absolute inset-0 flex flex-col items-center justify-center text-center p-2 z-10 bg-slate-900/70 text-gray-400 group-hover:bg-slate-900/90 transition duration-150">
                                <span class="text-xs font-semibold">Choose Image</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="input-grid-${index}" class="grid gap-2 mt-1 grid-cols-3">
                    <div>
                        <label for="answer-${index}" class="block text-[10px] font-medium mb-0.5 text-gray-500 uppercase">Answer</label>
                        <input type="text" id="answer-${index}" placeholder="Enter answer" class="w-full p-2 rounded-lg bg-slate-900 border border-gray-700 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-gray-500">
                    </div>
                    
                    <div id="middle-slot-container-${index}" class="flex flex-col justify-end">
                        <!-- Frenzy Input / Solve A3 injected here -->
                    </div>

                    <div>
                        <label for="grid-num-${index}" class="block text-[10px] font-medium mb-0.5 text-gray-500 uppercase">Grid Num</label>
                        <input type="text" id="grid-num-${index}" placeholder="Ex : 10a" class="w-full p-2 rounded-lg bg-slate-900 border border-gray-700 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-gray-500">
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;
}

function updatePanelVisibilityAndInputs() {
    const totalQuestions = is60SecVid ? MAX_QUESTIONS : 3; 

    for (let i = 1; i <= MAX_QUESTIONS; i++) {
        const wrapper = document.getElementById(`wrapper-${i}`);
        if (!wrapper) continue;
        
        const isVisible = i <= totalQuestions;
        const isLastVisible = i === totalQuestions;
        const showFrenzies = !isLastVisible;

        if (isVisible) {
            wrapper.classList.remove('hidden-panel');
            wrapper.style.marginBottom = '1.5rem';
        } else {
            wrapper.classList.add('hidden-panel');
            wrapper.style.marginBottom = '0';
        }

        const middleSlot = document.getElementById(`middle-slot-container-${i}`);
        if (middleSlot) {
            if (!is60SecVid && i === 3) {
                middleSlot.innerHTML = `
                    <div class="flex items-center h-full pt-4">
                        <label class="custom-checkbox text-xs text-gray-400">
                            <input type="checkbox" id="solve-a3-checkbox">
                            <span class="box"></span>
                            Solve A3
                        </label>
                    </div>
                `;
            } else if (isVisible && showFrenzies) {
                middleSlot.innerHTML = `
                    <label for="frenzies-${i}" class="block text-[10px] font-medium mb-0.5 text-gray-500 uppercase">Frenzies</label>
                    <input type="text" id="frenzies-${i}" 
                        oninput="window.globalFrenzyCache[${i}]=this.value" 
                        placeholder="Enter frenzies" 
                        class="frenzy-input w-full p-2 rounded-lg bg-slate-900 border border-gray-700 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-gray-500">
                `;
                
                const frenzyInput = document.getElementById(`frenzies-${i}`);
                if (frenzyInput) {
                    if (window.globalFrenzyCache[i] !== undefined) {
                        frenzyInput.value = window.globalFrenzyCache[i];
                    }
                    frenzyInput.disabled = isAutoFrenzy;
                    frenzyInput.style.opacity = isAutoFrenzy ? '0.5' : '1';
                }
            } else {
                middleSlot.innerHTML = `<div class="w-full p-2 h-[2.25rem]"></div>`;
            }
        }
    }
}

function toggleQuestion(panelId, index) {
    const panel = document.getElementById(panelId);
    panel.classList.toggle('collapsed');
    if (typeof index !== 'undefined') {
        panelStates[index] = panel.classList.contains('collapsed');
    }
}

// =================================================================================
// 7. GRID & PRESET MANAGEMENT
// =================================================================================

function generateGridButtons() {
    const buttonsContainer = document.getElementById('grid-buttons');
    if (!buttonsContainer) return;
    let buttonsHtml = '';
    const grids = (typeof availableGrids !== 'undefined') ? availableGrids : [];
    grids.forEach(grid => {
        const id = grid.id;
        const isActive = (id === activeGrid);
        const colorClass = isActive ? 'bg-blue-600' : 'bg-blue-500';
        buttonsHtml += `<button id="grid-btn-${id}" class="${colorClass} text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-blue-600 transition">${id}</button>`;
    });
    // Add button for saving a new grid snapshot
    buttonsHtml += `<button id="grid-btn-add" class="text-blue-500 font-bold py-2 px-4 text-xl rounded-lg hover:text-blue-400 transition">+</button>`;
    buttonsContainer.innerHTML = buttonsHtml;

    // Bind events via addEventListener (no inline onclick)
    grids.forEach(grid => {
        const id = grid.id;
        const btn = document.getElementById(`grid-btn-${id}`);
        if (btn) btn.addEventListener('click', () => drawGrid(id));
    });
    const addBtn = document.getElementById('grid-btn-add');
    if (addBtn) addBtn.addEventListener('click', openModal);
}

function openModal() { document.getElementById('save-grid-modal').classList.remove('hidden'); }
function closeModal() { document.getElementById('save-grid-modal').classList.add('hidden'); }

function togglePresetDropdown() {
    const d = document.getElementById('preset-dropdown-menu');
    if(!d) return;
    const isHidden = d.classList.contains('hidden');
    if (isHidden) {
        d.classList.remove('hidden');
        setTimeout(() => { d.classList.remove('opacity-0', 'translate-y-2'); }, 10);
    } else {
        d.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => { d.classList.add('hidden'); }, 200);
    }
}

function openNewPresetModal() {
    if(typeof baseDirPath !== 'undefined' && !baseDirPath) {
        return showToast("Select Folder First");
    }
    togglePresetDropdown();
    const modal = document.getElementById('new-preset-modal');
    if(modal) {
        modal.classList.remove('hidden');
        const input = document.getElementById('new-preset-input');
        if(input) { input.value = ''; input.focus(); }
    }
}

function closeNewPresetModal() { document.getElementById('new-preset-modal').classList.add('hidden'); }

// =================================================================================
// 8. SETTINGS MODAL LOGIC
// =================================================================================

function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    const fields = [
        ['set-f1-a2', 'f1a2'], ['set-f2-a3', 'f2a3'], ['set-f3-a4', 'f3a4'], ['set-f4-a5', 'f4a5'], ['set-f5-a6', 'f5a6'],
        ['set-af1', 'af1'], ['set-af2', 'af2'], ['set-af3', 'af3'], ['set-af4', 'af4'], ['set-af5', 'af5'],
        ['set-min-gap', 'minGap'], ['set-rand-seed', 'randSeed'],
        ['set-chk-replace', 'replaceImage'], ['set-chk-preserve', 'preserveMarker'],
        ['set-comp-main', 'compMain'], ['set-comp-qa', 'compQa'], ['set-comp-grid', 'compGrid'], ['set-comp-answers', 'compAnswers'],
        ['set-layer-ctrl', 'layerCtrl'], ['set-layer-adv-ctrl', 'advLayerCtrl'], ['set-layer-q', 'layerQ'], ['set-layer-a', 'layerA'], ['set-layer-tile', 'layerTile'], ['set-layer-parent', 'layerParent'],
        ['set-fx-num', 'fxNum'], ['set-fx-row', 'fxRow'], ['set-fx-col', 'fxCol'], ['set-fx-rot', 'fxRot'], ['set-fx-letter', 'fxLetter']
    ];
    fields.forEach(([elId, key]) => {
        const el = document.getElementById(elId);
        if (el) {
            if(el.type === 'checkbox') el.checked = savedSettings[key];
            else el.value = savedSettings[key];
        }
    });
    // Prevent background from scrolling while the modal is open.
    document.body.classList.add('modal-open');
    modal.classList.remove('hidden');
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('modal-open');
}

// Reset only one section (header reset icon).
function resetSettingsSection(section) {
    try {
        const setText = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = (val ?? "").toString();
        };
        const setChk = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.checked = !!val;
        };

        if (section === 'frenzy') {
            setText('set-f1-a2', DEFAULT_SETTINGS.f1a2);
            setText('set-f2-a3', DEFAULT_SETTINGS.f2a3);
            setText('set-f3-a4', DEFAULT_SETTINGS.f3a4);
            setText('set-f4-a5', DEFAULT_SETTINGS.f4a5);
            setText('set-f5-a6', DEFAULT_SETTINGS.f5a6);
            setText('set-af1', DEFAULT_SETTINGS.af1);
            setText('set-af2', DEFAULT_SETTINGS.af2);
            setText('set-af3', DEFAULT_SETTINGS.af3);
            setText('set-af4', DEFAULT_SETTINGS.af4);
            setText('set-af5', DEFAULT_SETTINGS.af5);
            setText('set-min-gap', DEFAULT_SETTINGS.minGap);
            setText('set-rand-seed', DEFAULT_SETTINGS.randSeed);
        } else if (section === 'answer' || section === 'answerMarker') {
            setChk('set-chk-replace', DEFAULT_SETTINGS.replaceImage);
            setChk('set-chk-preserve', DEFAULT_SETTINGS.preserveMarker);
        } else if (section === 'compNames') {
            setText('set-comp-main', DEFAULT_SETTINGS.compMain);
            setText('set-comp-qa', DEFAULT_SETTINGS.compQa);
            setText('set-comp-grid', DEFAULT_SETTINGS.compGrid);
            setText('set-comp-answers', DEFAULT_SETTINGS.compAnswers);
        } else if (section === 'layerNames') {
            setText('set-layer-ctrl', DEFAULT_SETTINGS.layerCtrl);
            setText('set-layer-adv-ctrl', DEFAULT_SETTINGS.advLayerCtrl);
            setText('set-layer-q', DEFAULT_SETTINGS.layerQ);
            setText('set-layer-a', DEFAULT_SETTINGS.layerA);
            setText('set-layer-tile', DEFAULT_SETTINGS.layerTile);
            setText('set-layer-parent', DEFAULT_SETTINGS.layerParent);
        } else if (section === 'effectNames') {
            setText('set-fx-num', DEFAULT_SETTINGS.fxNum);
            setText('set-fx-row', DEFAULT_SETTINGS.fxRow);
            setText('set-fx-col', DEFAULT_SETTINGS.fxCol);
            setText('set-fx-rot', DEFAULT_SETTINGS.fxRot);
            setText('set-fx-letter', DEFAULT_SETTINGS.fxLetter);
        }

        if (typeof showToast === 'function') showToast('Reset to default.');
    } catch (e) {
        console.error(e);
    }
}