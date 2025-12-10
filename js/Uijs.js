// Fallback for local testing outside of After Effects
if (typeof CSInterface === 'undefined') {
    console.warn("Using Mock CSInterface");
    window.CSInterface = function() {
        this.evalScript = function(script, cb) {
            // console.log("Mock Eval:", script);
            setTimeout(() => {
                if(script.includes("pickBaseFolder")) cb("/MOCK/DTC_Presets");
                else if(script.includes("copyFile")) cb("SUCCESS");
                else if(script.includes("readBase64File")) cb("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=");
                else if(script.includes("readTextFile") && script.includes("presets_index.json")) cb("[]");
                else if(script.includes("readTextFile")) cb('{"id":"mock","name":"Mock","placeholders":{"data":{},"images":[]}}');
                else cb("[]");
            }, 100);
        }
    };
}

const csInterface = new CSInterface();


// --- Global State ---
const TABS = { LOTSO: 'lotso', CONTENTS: 'contents', SETTINGS: 'settings' };
const MAX_QUESTIONS = 6;
let activeTab = TABS.CONTENTS;
let activeGrid = 1;
let fileSelection = 'new';
const panelStates = Array(MAX_QUESTIONS + 1).fill(false); // Index 1 through 6
let isAutoFrenzy = false;
let is60SecVid = false;
let selectedGridImageBase64 = null; 


// --- File System & Preset State (UPDATED) ---
let baseDirPath = null;
let presetsIndex = [];
let loadedPreset = null;
let questionImages = {}; // Map<index, File> - Stores actual file objects for saving


// --- UTILS ---
function slugify(s) { return (s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
function newId() { return Math.floor(Date.now() + Math.random()*1e6).toString(36); }
function nowISO() { return new Date().toISOString(); }
function parseLines(str){ return (str||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean); }
function toDisplayPath(path){ 
    if (!path) return '— Folder not selected —';
    const parts = path.split(/[\/\\]/).filter(Boolean);
    return parts[parts.length - 1]; 
}

// CRITICAL FIX: Escapes newlines and quotes so evalScript doesn't break
function escapeForJSX(str) { 
    if (!str) return "";
    return str.replace(/\\/g, '\\\\')
              .replace(/"/g, '\\"')
              .replace(/'/g, "\\'")
              .replace(/\n/g, '\\n') 
              .replace(/\r/g, '\\r');
}

// Promise wrapper for CSInterface
function evalScriptPromise(script) {
    return new Promise((resolve, reject) => {
        csInterface.evalScript(script, res => {
            if(res && res.startsWith("ERROR:")) reject(res);
            else resolve(res);
        });
    });
}


// --- INIT ---
window.onload = async () => {
    // 1. Initial Render of UI Components
    renderQuestionPanels();
    updateContentMode(true);
    generateGridButtons();
    setActiveTab(TABS.CONTENTS);
    drawGrid(activeGrid);

    // 2. Try to restore stored path
    try {
        const path = await evalScriptPromise("$._ext.getStoredBasePath()");
        if(path && path !== "" && !path.startsWith("ERROR")) {
            await setBaseHandleAndInit(path);
        }
    } catch(e) { console.log("No base path stored"); }

    // 3. Bind Listener for Picking Folder
    const pickBtn = document.getElementById('pickBaseBtn');
    if(pickBtn) {
        pickBtn.addEventListener('click', async () => {
            try {
                const path = await evalScriptPromise("$._ext.pickBaseFolder()");
                if(path && path !== "ERROR:CANCELED") {
                    await setBaseHandleAndInit(path);
                }
            } catch(e) { alert(e); }
        });
    }

    // 4. Grid File Upload Listener
    const gridUpload = document.getElementById('grid-file-upload');
    if (gridUpload) {
        gridUpload.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => selectedGridImageBase64 = e.target.result.split(',')[1];
                reader.readAsDataURL(file);
            }
        });
    }
};

async function setBaseHandleAndInit(path) {
    baseDirPath = path;
    const label = document.getElementById('basePathLabel');
    if(label) {
        label.textContent = toDisplayPath(path);
        label.title = path;
    }
    await loadIndex();
}


// --- PRESET LOGIC (UPDATED) ---

async function loadIndex() {
    try {
        const txt = await evalScriptPromise('$._ext.readTextFile("presets_index.json")');
        presetsIndex = (txt === "ERROR:INDEX_NOT_FOUND") ? [] : JSON.parse(txt);
    } catch(e) { presetsIndex = []; }
    renderPresetDropdownItems();
}

function renderPresetDropdownItems() {
    const list = document.getElementById('preset-list');
    if(!list) return;

    // Sort by updated date
    const sortedPresets = presetsIndex.sort((a,b)=> (b.updatedAt||'').localeCompare(a.updatedAt||''));
    
    let itemsHtml = sortedPresets.map(p => `
        <button onclick="selectPreset('${p.id}')" class="block w-full text-left px-4 py-2 text-sm rounded-lg ${loadedPreset && p.id === loadedPreset.id ? 'bg-blue-600 text-white' : 'text-gray-200 hover:bg-slate-700'}">
            ${p.name}
        </button>
    `).join('');

    const loadedPresetName = loadedPreset ? loadedPreset.name : '...';

    // Add Create and Save Actions
    itemsHtml += `
        <div class="border-t border-gray-700 my-1"></div>
        <button onclick="openNewPresetModal()" class="block w-full text-left px-4 py-2 text-sm text-green-400 hover:bg-slate-700 rounded-lg">
            <span class="font-bold text-lg leading-none align-bottom">+</span> Create New Preset
        </button>
        <button onclick="saveChangesConfirmation()" ${loadedPreset ? '' : 'disabled'} class="block w-full text-left px-4 py-2 text-sm text-yellow-400 hover:bg-slate-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
            Save Changes to '${loadedPresetName}'
        </button>
    `;
    
    list.innerHTML = itemsHtml;
    
    const nameDisplay = document.getElementById('selected-preset-name');
    if (nameDisplay) nameDisplay.textContent = loadedPreset ? loadedPreset.name : '-- Select Preset --';
}

function togglePresetDropdown() {
    const d = document.getElementById('preset-dropdown-menu');
    d.classList.toggle('hidden');
    d.classList.toggle('opacity-0');
    d.classList.toggle('translate-y-2');
    
    // Hide other modals
    document.getElementById('new-preset-modal').classList.add('hidden');
    document.getElementById('save-confirm-modal').classList.add('hidden');
}


// --- SAVE PRESET (NEW ROBUST LOGIC) ---

function openNewPresetModal() {
    if(!baseDirPath) return alert("Select Folder First");
    // Close dropdown first
    const d = document.getElementById('preset-dropdown-menu');
    if(!d.classList.contains('hidden')) togglePresetDropdown();

    document.getElementById('new-preset-modal').classList.remove('hidden');
    document.getElementById('new-preset-input').value = ''; 
    document.getElementById('new-preset-input').focus();
}

function closeNewPresetModal() {
    document.getElementById('new-preset-modal').classList.add('hidden');
}

async function saveNewPreset() {
    const name = document.getElementById('new-preset-input').value.trim();
    if(!name) return alert("Enter name");
    
    const id = newId();
    const folderName = `${id}_${slugify(name)}`;
    
    // 1. Gather Data from Form
    const formState = getCurrentFormData();
    
    // 2. Copy Images (Physical Copy)
    const imagesMeta = [];
    const imageFiles = Object.keys(questionImages).map(k => ({ slot: parseInt(k), file: questionImages[k] })).filter(i => i.file);

    for (const { slot, file } of imageFiles) {
        if(file.path) {
            const sourcePath = escapeForJSX(file.path);
            const destRelPath = escapeForJSX(`${folderName}/assets/${file.name}`);
            
            try {
                const res = await evalScriptPromise(`$._ext.copyFile("${sourcePath}", "${destRelPath}")`);
                if(res === "SUCCESS") {
                    imagesMeta.push({ slot, fileName: file.name, relPath: `assets/${file.name}` });
                } else {
                    console.error(`Copy failed for slot ${slot}: ${res}`);
                }
            } catch(e) { console.error("Copy error: " + e); }
        }
    }

    // 3. Prepare JSON Structure
    const presetData = {
        id, name,
        createdAt: nowISO(),
        updatedAt: nowISO(),
        placeholders: {
            data: formState,
            images: imagesMeta
        }
    };

    // 4. Save JSON File
    const jsonStr = escapeForJSX(JSON.stringify(presetData));
    const jsonPath = escapeForJSX(`${folderName}/preset.json`);
    
    try {
        await evalScriptPromise(`$._ext.writeTextFile("${jsonPath}", '${jsonStr}')`);
        
        // 5. Update Index
        presetsIndex.push({ id, name, folder: folderName, updatedAt: presetData.updatedAt });
        const idxStr = escapeForJSX(JSON.stringify(presetsIndex));
        await evalScriptPromise(`$._ext.writeTextFile("presets_index.json", '${idxStr}')`);
        
        // 6. Finish
        loadedPreset = { ...presetData, folder: folderName };
        closeNewPresetModal();
        renderPresetDropdownItems();
        alert(`Saved preset '${name}'!`);
    } catch(e) { 
        alert("Save failed: " + e); 
        console.error(e);
    }
}


// --- SAVE CHANGES (NEW ROBUST LOGIC) ---

function saveChangesConfirmation() {
    if (!loadedPreset) return;
    // Close dropdown
    const d = document.getElementById('preset-dropdown-menu');
    if(!d.classList.contains('hidden')) togglePresetDropdown();

    document.getElementById('save-confirm-modal').classList.remove('hidden');
    document.getElementById('save-confirm-message').textContent = `Are you sure you want to save changes to '${loadedPreset.name}'?`;
}

function closeSaveConfirmModal() {
    document.getElementById('save-confirm-modal').classList.add('hidden');
}

async function saveChangesToPreset() {
    if (!baseDirPath || !loadedPreset) return;
    
    const entry = presetsIndex.find(p => p.id === loadedPreset.id);
    if (!entry) return alert("Error: Preset not found in index.");

    const folderName = entry.folder;
    const formState = getCurrentFormData();
    
    // Logic: Keep existing images unless replaced, Add new ones.
    let currentImages = loadedPreset.placeholders?.images || [];
    
    // Process currently selected images in UI
    const imageFiles = Object.keys(questionImages).map(k => ({ slot: parseInt(k), file: questionImages[k] })).filter(i => i.file);

    for (const { slot, file } of imageFiles) {
        if(file.path) {
            const sourcePath = escapeForJSX(file.path);
            const destRelPath = escapeForJSX(`${folderName}/assets/${file.name}`);
            
            try {
                const res = await evalScriptPromise(`$._ext.copyFile("${sourcePath}", "${destRelPath}")`);
                if(res === "SUCCESS") {
                    // Remove old entry for this slot if exists
                    currentImages = currentImages.filter(img => img.slot !== slot);
                    // Add new entry
                    currentImages.push({ slot, fileName: file.name, relPath: `assets/${file.name}` });
                }
            } catch(e) { console.error("Copy error: " + e); }
        }
    }

    const updatedData = {
        ...loadedPreset,
        updatedAt: nowISO(),
        placeholders: {
            data: formState,
            images: currentImages
        }
    };
    // Ensure we don't write the 'folder' property into the JSON file
    delete updatedData.folder; 

    // Save JSON
    const jsonStr = escapeForJSX(JSON.stringify(updatedData));
    const jsonPath = escapeForJSX(`${folderName}/preset.json`);
    
    try {
        await evalScriptPromise(`$._ext.writeTextFile("${jsonPath}", '${jsonStr}')`);
        
        // Update Index Timestamp
        entry.updatedAt = updatedData.updatedAt;
        const idxStr = escapeForJSX(JSON.stringify(presetsIndex));
        await evalScriptPromise(`$._ext.writeTextFile("presets_index.json", '${idxStr}')`);
        
        loadedPreset = { ...updatedData, folder: folderName };
        closeSaveConfirmModal();
        alert("Changes saved successfully!");
    } catch(e) { alert("Save failed: " + e); }
}


// --- SELECT PRESET & LOADING (UPDATED) ---

async function selectPreset(id) {
    // Close dropdown
    const d = document.getElementById('preset-dropdown-menu');
    if(!d.classList.contains('hidden')) togglePresetDropdown();

    const entry = presetsIndex.find(p => p.id === id);
    if(!entry) return;

    try {
        const jsonPath = escapeForJSX(`${entry.folder}/preset.json`);
        const txt = await evalScriptPromise(`$._ext.readTextFile("${jsonPath}")`);
        
        if(txt.startsWith("ERROR:")) return alert("Error reading preset: " + txt);

        const json = JSON.parse(txt);
        loadedPreset = { ...json, folder: entry.folder }; 
        
        // Load Data into UI
        loadDataIntoForm(json.placeholders?.data, json.placeholders?.images || [], entry.folder);
        renderPresetDropdownItems(); // Re-render to show selection highlight

    } catch(e) { alert("Load failed: " + e); }
}

async function loadDataIntoForm(data, imagePlaceholders = [], folderName) {
    // Reset Image State
    questionImages = {};
    
    // Clear all fields first (optional, but good for cleanliness)
    for (let i = 1; i <= MAX_QUESTIONS; i++) {
        handleImageLoad(null, i); 
    }

    if (!data) return;

    const questions = parseLines(data.questions);
    const answers = parseLines(data.answers);
    const numbers = data.numbers ? data.numbers.split(/[,\s]+/).map(s=>s.trim()).filter(Boolean) : [];
    const frenzies = data.frenzy || {};
    
    for (let i = 1; i <= MAX_QUESTIONS; i++) {
        const q = document.getElementById(`question-textarea-${i}`);
        const a = document.getElementById(`answer-${i}`);
        const g = document.getElementById(`grid-num-${i}`);
        const f = document.getElementById(`frenzies-${i}`);
        
        if (q) q.value = questions[i-1] || '';
        if (a) a.value = answers[i-1] || '';
        if (g) g.value = numbers[i-1] || '';
        if (f) f.value = frenzies[i] || '';

        // --- IMAGE LOADING (FAST FILE:// URL LOGIC) ---
        const savedImg = imagePlaceholders.find(p => p.slot === i);
        const preview = document.getElementById(`image-preview-${i}`);
        const overlay = document.getElementById(`image-overlay-${i}`);

        if (savedImg && savedImg.fileName && baseDirPath) {
            // Construct file:// URL
            // Ensure slashes are forward slashes for URL compatibility
            const root = baseDirPath.replace(/\\/g, '/');
            const relative = `${folderName}/${savedImg.relPath || ('assets/' + savedImg.fileName)}`;
            
            // Ensure root starts with / if on Mac/Unix, or handle drive letters for Windows
            const cleanRoot = root.startsWith('/') ? root : '/' + root;
            const fullPath = `file://${cleanRoot}/${relative}`;
            
            preview.src = fullPath;
            preview.classList.remove('hidden');
            
            if(overlay) {
                overlay.classList.add('bg-slate-900/50');
                overlay.classList.remove('bg-slate-900/70');
                overlay.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 mb-1 text-green-400">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                    <span class="text-xs text-green-400 font-semibold truncate max-w-full">${savedImg.fileName}</span>
                `;
            }
            
            preview.onerror = () => {
                preview.classList.add('hidden');
                if(overlay) overlay.innerHTML = `<span class="text-xs text-red-400">Image Missing</span>`;
            };
        } else {
            // No image for this slot
            if(preview) {
                preview.src = "";
                preview.classList.add('hidden');
            }
            if(overlay) {
                overlay.classList.remove('bg-slate-900/50');
                overlay.classList.add('bg-slate-900/70');
                overlay.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 mb-1">
                        <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                        <circle cx="9" cy="9" r="2"/>
                        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                    </svg>
                    <span class="text-xs font-semibold">Choose Image</span>
                `;
            }
        }
    }
}

function getCurrentFormData() {
    const questions = [];
    const answers = [];
    const numbers = [];
    const frenzy = {};
    
    for (let i = 1; i <= MAX_QUESTIONS; i++) {
        const q = document.getElementById(`question-textarea-${i}`);
        const a = document.getElementById(`answer-${i}`);
        const g = document.getElementById(`grid-num-${i}`);
        const f = document.getElementById(`frenzies-${i}`);

        // Even empty strings are pushed to maintain index alignment for lines
        if (q) questions.push(q.value.trim());
        if (a) answers.push(a.value.trim());
        if (g && g.value.trim()) numbers.push(g.value.trim()); // Only push if exists for grids
        if (f && f.value.trim()) frenzy[i] = f.value.trim();
    }
    
    return {
        questions: questions.join('\n'),
        answers: answers.join('\n'),
        numbers: numbers.join(', '),
        frenzy: frenzy
    };
}


// --- UI HANDLERS (ORIGINAL + NEW IMAGE HANDLING) ---

function handleImageSelection(event, index) {
    const file = event.target.files[0];
    if(!file) return;
    
    // Store file for saving later
    questionImages[index] = file;

    const preview = document.getElementById(`image-preview-${index}`);
    const overlay = document.getElementById(`image-overlay-${index}`);
    
    // Local preview (immediate feedback)
    const reader = new FileReader();
    reader.onload = (e) => {
        preview.src = e.target.result;
        preview.classList.remove('hidden');
        if(overlay) {
            overlay.classList.add('bg-slate-900/50');
            overlay.innerHTML = `<span class="text-xs text-green-400 truncate max-w-full">Selected: ${file.name}</span>`;
        }
    };
    reader.readAsDataURL(file);
    event.target.value = null; // allow re-select
}

function handleImageLoad(file, index) {
    // Helper to clear images visually when needed
    const previewElement = document.getElementById(`image-preview-${index}`);
    const overlayElement = document.getElementById(`image-overlay-${index}`);
    
    if(!file) {
        if(previewElement) {
            previewElement.src = "";
            previewElement.classList.add('hidden');
        }
        if(overlayElement) {
            overlayElement.classList.remove('bg-slate-900/50');
            overlayElement.classList.add('bg-slate-900/70');
            overlayElement.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 mb-1">
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                    <circle cx="9" cy="9" r="2"/>
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                </svg>
                <span class="text-xs font-semibold">Choose Image</span>
            `;
        }
    }
}


// --- TAB & CONTENT LOGIC (RESTORED FROM ORIGINAL) ---

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

function updateContentMode(force) {
    const afCheckbox = document.getElementById('checkbox-auto-frenzy');
    const vidCheckbox = document.getElementById('checkbox-60-sec-vid');
    
    isAutoFrenzy = afCheckbox ? afCheckbox.checked : false;
    is60SecVid = vidCheckbox ? vidCheckbox.checked : false;

    if(force) renderQuestionPanels();
    updatePanelVisibilityAndInputs();
}

function handleCheckboxChange(is60Sec) {
    const afCheckbox = document.getElementById('checkbox-auto-frenzy');
    const vidCheckbox = document.getElementById('checkbox-60-sec-vid');

    if (is60Sec) {
        if(vidCheckbox.checked) {
            if(afCheckbox) afCheckbox.checked = false;
        }
    } else {
        if(afCheckbox.checked) {
            if(vidCheckbox) vidCheckbox.checked = false;
        }
    }
    updateContentMode(false);
}

function renderQuestionPanels() {
    const container = document.getElementById('question-panels');
    if(!container) return;
    container.innerHTML = '';
    for(let i=1; i<=MAX_QUESTIONS; i++) {
        container.innerHTML += generateQuestionPanel(i);
    }
}

function generateQuestionPanel(index) {
    // Determine collapsed state
    const collapsedClass = panelStates[index] ? 'collapsed' : '';
    
    // Frenzy HTML
    const frenzyInputHTML = `
        <div id="frenzy-wrapper-${index}">
            <div class="frenzy-content">
                <label for="frenzies-${index}" class="block text-xs font-medium mb-1 text-gray-400">Frenzies</label>
                <input type="text" id="frenzies-${index}" placeholder="Enter frenzies" class="frenzy-input w-full p-2 rounded-lg bg-slate-900 border border-gray-700 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-gray-500">
            </div>
            <div class="frenzy-placeholder hidden">
                <label class="block text-xs font-medium mb-1 text-gray-400 opacity-0 select-none">Frenzies</label>
                <div class="w-full p-2 h-[2.25rem] opacity-0"></div>
            </div>
        </div>
    `;

    return `
    <div id="wrapper-${index}" class="question-panel-wrapper">
        <div id="question-${index}" class="question-panel card-bg p-1 rounded-xl shadow-2xl transition duration-300 w-full max-w-3xl min-panel-width ${collapsedClass}">
            <input type="file" id="image-file-input-${index}" accept="image/*" class="hidden" onchange="handleImageSelection(event, ${index})">

            <div class="flex items-center justify-between cursor-pointer" onclick="toggleQuestion('question-${index}', ${index})">
                <div class="flex items-center space-x-3">
                    <button class="toggle-icon text-gray-400 hover:text-white focus:outline-none p-0.5 rounded-full bg-slate-900">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4">
                            <path d="M6 9l6 6 6-6"/>
                        </svg>
                    </button>
                    <h2 class="text-sm font-semibold text-gray-100">Question ${index} :</h2>
                </div>
                <div class="w-3 h-3 rounded-full border-2 border-gray-500 bg-transparent"></div>
            </div>
            <div class="content-area pt-1">
                <div class="flex flex-row gap-2">
                    <div class="flex-grow">
                        <textarea id="question-textarea-${index}" rows="4" placeholder="Enter your question" class="w-full p-2 rounded-lg bg-slate-900 border border-gray-700 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-gray-500 resize-none"></textarea>
                    </div>
                    <div class="w-1/4 flex-shrink-0">
                        <div id="image-box-${index}" class="relative aspect-square w-full rounded-lg border-2 border-gray-700 bg-slate-900 overflow-hidden group cursor-pointer"
                             onclick="document.getElementById('image-file-input-${index}').click(); event.stopPropagation();">

                            <img id="image-preview-${index}" src="" alt="Selected image thumbnail" class="absolute inset-0 w-full h-full object-cover hidden">

                            <div id="image-overlay-${index}" class="absolute inset-0 flex flex-col items-center justify-center text-center p-2 z-10
                                 bg-slate-900/70 text-gray-400 group-hover:bg-slate-900/90 transition duration-150">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 mb-1">
                                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                                    <circle cx="9" cy="9" r="2"/>
                                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                                </svg>
                                <span class="text-xs font-semibold">Choose Image</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="input-grid-${index}" class="grid gap-2 mt-1 grid-cols-3">
                    <div>
                        <label for="answer-${index}" class="block text-xs font-medium mb-1 text-gray-400">Answer</label>
                        <input type="text" id="answer-${index}" placeholder="Enter correct answer" class="w-full p-2 rounded-lg bg-slate-900 border border-gray-700 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-gray-500">
                    </div>
                    ${frenzyInputHTML}
                    <div>
                        <label for="grid-num-${index}" class="block text-xs font-medium mb-1 text-gray-400">Grid Num</label>
                        <input type="text" id="grid-num-${index}" placeholder="Ex : 10a or 10d" class="w-full p-2 rounded-lg bg-slate-900 border border-gray-700 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-gray-500">
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;
}

function updatePanelVisibilityAndInputs() {
    const totalQuestions = is60SecVid ? MAX_QUESTIONS : 4;

    for (let i = 1; i <= MAX_QUESTIONS; i++) {
        const wrapper = document.getElementById(`wrapper-${i}`);
        if (!wrapper) continue;

        const isVisible = i <= totalQuestions;
        const isLastVisible = i === totalQuestions;
        const showFrenzies = !isLastVisible;

        // Visibility
        if (isVisible) {
            wrapper.classList.remove('hidden-panel');
            wrapper.style.marginBottom = '1.5rem';
        } else {
            wrapper.classList.add('hidden-panel');
            wrapper.style.marginBottom = '0';
        }

        // Frenzy Visibility
        const frenzyWrapper = document.getElementById(`frenzy-wrapper-${i}`);
        if (frenzyWrapper) {
            const content = frenzyWrapper.querySelector('.frenzy-content');
            const placeholder = frenzyWrapper.querySelector('.frenzy-placeholder');
            if (isVisible && showFrenzies) {
                content.classList.remove('hidden');
                placeholder.classList.add('hidden');
            } else {
                content.classList.add('hidden');
                // show placeholder only if panel is visible but frenzy shouldn't be
                // actually in this design we might just hide the input
                placeholder.classList.add('hidden'); 
            }
        }

        // Frenzy Disabled State (Auto Frenzy)
        const frenzyInput = document.getElementById(`frenzies-${i}`);
        if (frenzyInput) {
            frenzyInput.disabled = isAutoFrenzy;
            if (isAutoFrenzy) {
                frenzyInput.classList.add('opacity-50', 'bg-gray-800');
                frenzyInput.classList.remove('bg-slate-900');
            } else {
                frenzyInput.classList.remove('opacity-50', 'bg-gray-800');
                frenzyInput.classList.add('bg-slate-900');
            }
        }
    }
}

function toggleQuestion(panelId, index) {
    const panel = document.getElementById(panelId);
    panel.classList.toggle('collapsed');
    // Update State
    if (typeof index !== 'undefined') {
        panelStates[index] = panel.classList.contains('collapsed');
    }
}


// --- GRID LOGIC (RESTORED FROM ORIGINAL) ---

const gridTemplates = {
    1: { name: 'Grid 1', data: [0,0,0,0,0,0,0,0,0,0,0,0,0,0, 0,1,1,1,0,1,1,1,0,1,1,1,0,1, 0,1,1,1,0,1,1,1,0,1,1,1,0,1, 0,0,0,0,0,0,0,0,0,0,0,0,0,0, 0,1,1,1,0,1,1,1,0,1,1,1,0,1, 0,1,1,1,0,1,1,1,0,1,1,1,0,1, 0,0,0,0,0,0,0,0,0,0,0,0,0,0, 0,1,1,1,0,1,1,1,0,1,1,1,0,1, 0,1,1,1,0,1,1,1,0,1,1,1,0,1, 0,0,0,0,0,0,0,0,0,0,0,0,0,0, 0,1,1,1,0,1,1,1,0,1,1,1,0,1, 0,1,1,1,0,1,1,1,0,1,1,1,0,1, 0,0,0,0,0,0,0,0,0,0,0,0,0,0, 0,1,0,1,0,1,0,1,0,1,0,1,0,1, ], numbers: { 0: '1', 1: '2', 4: '3', 7: '4', 11: '5', 14: '6', 15: '7', 18: '8', 21: '9', 25: '10', 30: '11', 35: '12', 39: '13', 42: '14', 46: '15', 51: '16', 55: '17', 60: '18', 64: '19', 68: '20' }, imageUrl: null },
    2: { name: 'Grid 2', data: [0,0,0,1,0,0,0,1,0,0,0,1,0,0, 0,1,0,1,0,1,0,1,0,1,0,1,0,1, 0,0,0,1,0,0,0,1,0,0,0,1,0,0, 0,1,0,1,0,1,0,1,0,1,0,1,0,1, 0,0,0,1,0,0,0,1,0,0,0,1,0,0, 0,1,0,1,0,1,0,1,0,1,0,1,0,1, 0,0,0,1,0,0,0,1,0,0,0,1,0,0, 0,1,0,1,0,1,0,1,0,1,0,1,0,1, 0,0,0,1,0,0,0,1,0,0,0,1,0,0, 0,1,0,1,0,1,0,1,0,1,0,1,0,1, 0,0,0,1,0,0,0,1,0,0,0,1,0,0, 0,1,0,1,0,1,0,1,0,1,0,1,0,1, 0,0,0,1,0,0,0,1,0,0,0,1,0,0, 0,1,0,1,0,1,0,1,0,1,0,1,0,1,], numbers: { 0: '1', 3: '2', 6: '3', 9: '4', 12: '5', 14: '6', 16: '7', 18: '8', 21: '9', 24: '10' }, imageUrl: null },
    3: { name: 'Grid 3', data: Array(14 * 14).fill(0), numbers: {}, imageUrl: null }
};

function drawGrid(gridId) {
    const gridContainer = document.getElementById('current-grid');
    const template = gridTemplates[gridId];
    activeGrid = gridId;

    if (!gridContainer || !template) return;

    // 1. Check for Image URL
    if (template.imageUrl) {
        gridContainer.innerHTML = `<img src="${template.imageUrl}" alt="Custom Grid Image" class="absolute inset-0 w-full h-full object-contain">`;
        gridContainer.classList.remove('crossword-grid', 'grid');
    } else {
        // 2. Fallback to grid
        gridContainer.classList.add('crossword-grid', 'grid');
        let gridHtml = '';
        const dataLength = Array.isArray(template.data) ? template.data.length : 0;

        for(let i = 0; i < dataLength; i++) {
            const isDark = template.data[i] === 1;
            const number = template.numbers[i] || '';

            gridHtml += `
                <div class="grid-cell relative ${isDark ? 'dark-cell' : 'bg-white'}">
                    ${number ? `<span class="cell-num">${number}</span>` : ''}
                </div>
            `;
        }
        gridContainer.innerHTML = gridHtml;
    }

    // 3. Update Button Styles
    document.querySelectorAll('#grid-buttons button').forEach(button => {
        const buttonText = button.innerText.trim();
        if (!isNaN(parseInt(buttonText))) {
            button.classList.remove('bg-blue-600');
            button.classList.add('bg-blue-500');
            if (parseInt(buttonText) == gridId) {
                button.classList.remove('bg-blue-500');
                button.classList.add('bg-blue-600'); 
            }
        }
    });
}

function generateGridButtons() {
    const buttonsContainer = document.getElementById('grid-buttons');
    if (!buttonsContainer) return;

    let buttonsHtml = '';
    const sortedIds = Object.keys(gridTemplates).map(Number).sort((a, b) => a - b);

    for (const id of sortedIds) {
        buttonsHtml += `<button id="grid-btn-${id}" onclick="drawGrid(${id})" class="bg-blue-500 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-blue-600 transition">${id}</button>`;
    }
    buttonsHtml += `<button onclick="openModal()" class="text-blue-500 font-bold py-2 px-4 text-xl rounded-lg hover:text-blue-400 transition">+</button>`;
    buttonsContainer.innerHTML = buttonsHtml;
}

function openModal() {
    selectedGridImageBase64 = null;
    const fileUpload = document.getElementById('grid-file-upload');
    if (fileUpload) fileUpload.value = '';
    document.getElementById('save-grid-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('save-grid-modal').classList.add('hidden');
}

function saveGridAndCreateNew() {
    const gridIds = Object.keys(gridTemplates).map(Number);
    const newGridId = gridIds.length > 0 ? Math.max(...gridIds) + 1 : 1;

    if (selectedGridImageBase64) {
        gridTemplates[activeGrid].imageUrl = 'data:image/png;base64,' + selectedGridImageBase64;
    }

    gridTemplates[newGridId] = {
        name: `Grid ${newGridId}`,
        data: Array(14 * 14).fill(0),
        numbers: {},
        imageUrl: null
    };

    closeModal();
    generateGridButtons();
    drawGrid(newGridId);
}

function updateFileSelection(value) {
    fileSelection = value;
    // console.log('File selection mode set to:', fileSelection);
}


// --- AFTER EFFECTS COMMUNICATION (RESTORED) ---

function collectAndApplyContent() {
    const dataArray = [];
    const totalQuestions = is60SecVid ? MAX_QUESTIONS : 4;
    let isValid = true;

    for (let i = 1; i <= MAX_QUESTIONS; i++) {
        const questionElement = document.getElementById(`question-textarea-${i}`);
        const answerElement = document.getElementById(`answer-${i}`);
        const gridNumElement = document.getElementById(`grid-num-${i}`);

        if (i <= totalQuestions) {
            const question = questionElement ? questionElement.value.trim() : '';
            const answer = answerElement ? answerElement.value.trim() : '';
            const gridNum = gridNumElement ? gridNumElement.value.trim() : '';

            if (!question || !answer || !gridNum) {
                console.error(`Error: Question ${i} incomplete.`);
                isValid = false;
                break;
            }

            dataArray.push({
                block: gridNum,
                question: question,
                answer: answer
            });
        }
    }

    if (!isValid) return alert("Please complete all visible fields before applying.");

    // Using new escape helper for safety
    const jsonString = JSON.stringify(dataArray);
    const escapedJsonString = escapeForJSX(jsonString);
    const jsxCommand = `applyBatchQA('${escapedJsonString}');`;

    csInterface.evalScript(jsxCommand, function(result) {
        if (result && result.indexOf('Error') === 0) {
            console.error('AE Script Error:', result);
        } else {
            console.info('Content Applied Successfully!');
        }
    });
}