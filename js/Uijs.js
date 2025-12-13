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
                // Grid Mocks
                else if(script.includes("getGridFiles")) cb(JSON.stringify([{id:1, fileName:"1.png"}, {id:2, fileName:"2.png"}]));
                else if(script.includes("saveSnapshot")) cb(JSON.stringify({status:"success", id: 3, fileName:"3.png"}));
                else if(script.includes("deleteGridFile")) cb("SUCCESS");
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
let activeGrid = null; // Changed to null initially
let fileSelection = 'new';
const panelStates = Array(MAX_QUESTIONS + 1).fill(false); // Index 1 through 6
let isAutoFrenzy = false;
let is60SecVid = false;


// --- File System & Preset State (UPDATED) ---
let baseDirPath = null;
let presetsIndex = [];
let loadedPreset = null;
let questionImages = {}; // Map<index, File> - Stores actual file objects for saving
let availableGrids = []; // List of grids loaded from DTC_Grids
let gridToDelete = null; // Temp store for delete modal

// --- Settings Default & Saved State ---
// These are the immutable defaults.
const DEFAULT_SETTINGS = {
    isCustomNamesEnabled: false, // Default checkbox state
    compMain: "GRID",
    compQa: "REPLACE Q&A",
    compGrid: "Grid",
    compAnswers: "ANSWERS",
    layerCtrl: "Controller",
    layerQ: "QUESTION",
    layerA: "ANSWER",
    layerTile: "Tile",
    fxNum: "Num",
    fxRow: "Row",
    fxCol: "Column",
    fxRot: "Rotation",
    fxLetter: "L"
};

// This variable holds the "committed" settings.
// When modal opens, inputs are populated from this.
// When "Save" is clicked, this is updated.
// When "Cancel" is clicked, nothing happens to this, so next Open restores this.
let savedSettings = { ...DEFAULT_SETTINGS };


// --- UTILS ---
function slugify(s) { return (s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
function newId() { return Math.floor(Date.now() + Math.random()*1e6).toString(36); }
function nowISO() { return new Date().toISOString(); }
function parseLines(str){ return (str||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean); }
function toDisplayPath(path){ 
    if (!path) return '— Folder not selected —';
    const parts = path.split(/[\/\\]/).filter(Boolean);
    return parts[parts.length - 1] ? '/' + parts[parts.length - 1] : path; 
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
            // FIX: Handle empty or undefined responses safely
            if (!res || res === "undefined" || res === "null") {
                resolve(null);
            } else if(res && res.startsWith("ERROR:")) {
                reject(res);
            } else {
                resolve(res);
            }
        });
    });
}


// --- INIT ---
window.onload = async () => {
    // 1. Initial Render of UI Components
    renderQuestionPanels();
    updateContentMode(true);
    // generateGridButtons(); // Wait for base path load
    setActiveTab(TABS.CONTENTS);

    // 2. Try to restore stored path
    try {
        const path = await evalScriptPromise("$._ext.getStoredBasePath()");
        if(path && path !== "" && !path.startsWith("ERROR")) {
            await setBaseHandleAndInit(path);
        } else {
             generateGridButtons(); // Render empty state
        }
    } catch(e) { 
        console.log("No base path stored"); 
        generateGridButtons();
    }

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
};

async function setBaseHandleAndInit(path) {
    baseDirPath = path;
    const label = document.getElementById('basePathLabel');
    if(label) {
        label.textContent = toDisplayPath(path);
        label.title = path;
    }
    await loadIndex();
    await loadGridsFromDisk(); // New function to load 1.png, 2.png...
}


// --- PRESET LOGIC ---

async function loadIndex() {
    try {
        const txt = await evalScriptPromise('$._ext.readTextFile("presets_index.json")');
        if (!txt) { presetsIndex = []; return; }
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
    
    document.getElementById('new-preset-modal').classList.add('hidden');
    document.getElementById('save-confirm-modal').classList.add('hidden');
}

// --- SAVE PRESET ---

function openNewPresetModal() {
    if(!baseDirPath) return alert("Select Folder First");
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
    const formState = getCurrentFormData();
    
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
                }
            } catch(e) { console.error("Copy error: " + e); }
        }
    }

    const presetData = {
        id, name,
        createdAt: nowISO(),
        updatedAt: nowISO(),
        placeholders: {
            data: formState,
            images: imagesMeta
        }
    };

    const jsonStr = escapeForJSX(JSON.stringify(presetData));
    const jsonPath = escapeForJSX(`${folderName}/preset.json`);
    
    try {
        await evalScriptPromise(`$._ext.writeTextFile("${jsonPath}", '${jsonStr}')`);
        
        presetsIndex.push({ id, name, folder: folderName, updatedAt: presetData.updatedAt });
        const idxStr = escapeForJSX(JSON.stringify(presetsIndex));
        await evalScriptPromise(`$._ext.writeTextFile("presets_index.json", '${idxStr}')`);
        
        loadedPreset = { ...presetData, folder: folderName };
        closeNewPresetModal();
        renderPresetDropdownItems();
        alert(`Saved preset '${name}'!`);
    } catch(e) { 
        alert("Save failed: " + e); 
        console.error(e);
    }
}

// --- SAVE CHANGES ---

function saveChangesConfirmation() {
    if (!loadedPreset) return;
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
    
    let currentImages = loadedPreset.placeholders?.images || [];
    const imageFiles = Object.keys(questionImages).map(k => ({ slot: parseInt(k), file: questionImages[k] })).filter(i => i.file);

    for (const { slot, file } of imageFiles) {
        if(file.path) {
            const sourcePath = escapeForJSX(file.path);
            const destRelPath = escapeForJSX(`${folderName}/assets/${file.name}`);
            try {
                const res = await evalScriptPromise(`$._ext.copyFile("${sourcePath}", "${destRelPath}")`);
                if(res === "SUCCESS") {
                    currentImages = currentImages.filter(img => img.slot !== slot);
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
    delete updatedData.folder; 

    const jsonStr = escapeForJSX(JSON.stringify(updatedData));
    const jsonPath = escapeForJSX(`${folderName}/preset.json`);
    
    try {
        await evalScriptPromise(`$._ext.writeTextFile("${jsonPath}", '${jsonStr}')`);
        entry.updatedAt = updatedData.updatedAt;
        const idxStr = escapeForJSX(JSON.stringify(presetsIndex));
        await evalScriptPromise(`$._ext.writeTextFile("presets_index.json", '${idxStr}')`);
        loadedPreset = { ...updatedData, folder: folderName };
        closeSaveConfirmModal();
        alert("Changes saved successfully!");
    } catch(e) { alert("Save failed: " + e); }
}

// --- SELECT PRESET & LOADING ---

async function selectPreset(id) {
    const d = document.getElementById('preset-dropdown-menu');
    if(!d.classList.contains('hidden')) togglePresetDropdown();

    const entry = presetsIndex.find(p => p.id === id);
    if(!entry) return;

    try {
        const jsonPath = escapeForJSX(`${entry.folder}/preset.json`);
        const txt = await evalScriptPromise(`$._ext.readTextFile("${jsonPath}")`);
        if(!txt || txt.startsWith("ERROR:")) return alert("Error reading preset: " + txt);

        const json = JSON.parse(txt);
        loadedPreset = { ...json, folder: entry.folder }; 
        loadDataIntoForm(json.placeholders?.data, json.placeholders?.images || [], entry.folder);
        renderPresetDropdownItems();
    } catch(e) { alert("Load failed: " + e); }
}

async function loadDataIntoForm(data, imagePlaceholders = [], folderName) {
    questionImages = {};
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

        const savedImg = imagePlaceholders.find(p => p.slot === i);
        const preview = document.getElementById(`image-preview-${i}`);
        const overlay = document.getElementById(`image-overlay-${i}`);

        if (savedImg && savedImg.fileName && baseDirPath) {
            const root = baseDirPath.replace(/\\/g, '/');
            const relative = `${folderName}/${savedImg.relPath || ('assets/' + savedImg.fileName)}`;
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
        } else {
            if(preview) { preview.src = ""; preview.classList.add('hidden'); }
            if(overlay) {
                overlay.classList.remove('bg-slate-900/50');
                overlay.classList.add('bg-slate-900/70');
                overlay.innerHTML = `<span class="text-xs font-semibold">Choose Image</span>`;
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

        if (q) questions.push(q.value.trim());
        if (a) answers.push(a.value.trim());
        if (g && g.value.trim()) numbers.push(g.value.trim());
        if (f && f.value.trim()) frenzy[i] = f.value.trim();
    }
    return {
        questions: questions.join('\n'),
        answers: answers.join('\n'),
        numbers: numbers.join(', '),
        frenzy: frenzy
    };
}


// --- UI HANDLERS ---

function handleImageSelection(event, index) {
    const file = event.target.files[0];
    if(!file) return;
    questionImages[index] = file;
    const preview = document.getElementById(`image-preview-${index}`);
    const overlay = document.getElementById(`image-overlay-${index}`);
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
    event.target.value = null; 
}

function handleImageLoad(file, index) {
    const previewElement = document.getElementById(`image-preview-${index}`);
    const overlayElement = document.getElementById(`image-overlay-${index}`);
    if(!file) {
        if(previewElement) { previewElement.src = ""; previewElement.classList.add('hidden'); }
        if(overlayElement) {
            overlayElement.classList.remove('bg-slate-900/50');
            overlayElement.classList.add('bg-slate-900/70');
            overlayElement.innerHTML = `<span class="text-xs font-semibold">Choose Image</span>`;
        }
    }
}


// --- TAB & CONTENT LOGIC ---

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

    // IMPORTANT: force is only true on init. 
    // We do NOT want to re-render panels when checkboxes change, 
    // as that destroys user input.
    if(force) renderQuestionPanels();
    updatePanelVisibilityAndInputs();
}

function handleCheckboxChange(is60Sec) {
    // REMOVED MUTUAL EXCLUSIVITY LOGIC
    // Both can be checked simultaneously now.
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
    const collapsedClass = panelStates[index] ? 'collapsed' : '';
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
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M6 9l6 6 6-6"/></svg>
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
                        <div id="image-box-${index}" class="relative aspect-square w-full rounded-lg border-2 border-gray-700 bg-slate-900 overflow-hidden group cursor-pointer" onclick="document.getElementById('image-file-input-${index}').click(); event.stopPropagation();">
                            <img id="image-preview-${index}" src="" alt="Selected image" class="absolute inset-0 w-full h-full object-cover hidden">
                            <div id="image-overlay-${index}" class="absolute inset-0 flex flex-col items-center justify-center text-center p-2 z-10 bg-slate-900/70 text-gray-400 group-hover:bg-slate-900/90 transition duration-150">
                                <span class="text-xs font-semibold">Choose Image</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="input-grid-${index}" class="grid gap-2 mt-1 grid-cols-3">
                    <div>
                        <label for="answer-${index}" class="block text-xs font-medium mb-1 text-gray-400">Answer</label>
                        <input type="text" id="answer-${index}" placeholder="Enter answer" class="w-full p-2 rounded-lg bg-slate-900 border border-gray-700 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-gray-500">
                    </div>
                    ${frenzyInputHTML}
                    <div>
                        <label for="grid-num-${index}" class="block text-xs font-medium mb-1 text-gray-400">Grid Num</label>
                        <input type="text" id="grid-num-${index}" placeholder="Ex : 10a" class="w-full p-2 rounded-lg bg-slate-900 border border-gray-700 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-gray-500">
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

        if (isVisible) {
            wrapper.classList.remove('hidden-panel');
            wrapper.style.marginBottom = '1.5rem';
        } else {
            wrapper.classList.add('hidden-panel');
            wrapper.style.marginBottom = '0';
        }

        const frenzyWrapper = document.getElementById(`frenzy-wrapper-${i}`);
        if (frenzyWrapper) {
            const content = frenzyWrapper.querySelector('.frenzy-content');
            const placeholder = frenzyWrapper.querySelector('.frenzy-placeholder');
            if (isVisible && showFrenzies) {
                content.classList.remove('hidden');
                placeholder.classList.add('hidden');
            } else {
                content.classList.add('hidden');
                placeholder.classList.add('hidden'); 
            }
        }
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
    if (typeof index !== 'undefined') {
        panelStates[index] = panel.classList.contains('collapsed');
    }
}


// =========================================================
// GRID MANAGEMENT (NEW LOGIC)
// =========================================================

async function loadGridsFromDisk() {
    try {
        if(!baseDirPath) return;
        const res = await evalScriptPromise("$._ext.getGridFiles()");
        // Handle case where res is null or undefined string
        if(res && !res.startsWith("ERROR") && res !== "undefined") {
            availableGrids = JSON.parse(res);
        } else {
            availableGrids = [];
        }
    } catch(e) { 
        console.warn("Grid Load Error:", e);
        availableGrids = []; 
    }
    generateGridButtons();
    
    // Auto-select first grid if none selected or if previously selected is gone
    if (availableGrids.length > 0) {
        if (!activeGrid || !availableGrids.find(g => g.id === activeGrid)) {
            // Default to first if current active is missing
            drawGrid(availableGrids[0].id);
        } else {
            drawGrid(activeGrid); // Refresh view
        }
    } else {
        document.getElementById('current-grid').innerHTML = '<span class="text-gray-500 text-sm">No grids found.</span>';
    }
}

function generateGridButtons() {
    const buttonsContainer = document.getElementById('grid-buttons');
    if (!buttonsContainer) return;

    let buttonsHtml = '';
    
    // Generate numeric buttons based on file scan
    availableGrids.forEach(grid => {
        const id = grid.id;
        const isActive = (id === activeGrid);
        const colorClass = isActive ? 'bg-blue-600' : 'bg-blue-500';
        buttonsHtml += `<button id="grid-btn-${id}" onclick="drawGrid(${id})" class="${colorClass} text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-blue-600 transition">${id}</button>`;
    });

    // Plus Button (Opens Modal)
    buttonsHtml += `<button onclick="openModal()" class="text-blue-500 font-bold py-2 px-4 text-xl rounded-lg hover:text-blue-400 transition">+</button>`;
    
    buttonsContainer.innerHTML = buttonsHtml;
}

function drawGrid(gridId) {
    activeGrid = gridId;
    
    // Update button states
    document.querySelectorAll('#grid-buttons button').forEach(btn => {
        if(btn.innerText === "+") return;
        btn.classList.remove('bg-blue-600');
        btn.classList.add('bg-blue-500');
        if(btn.id === `grid-btn-${gridId}`) {
            btn.classList.remove('bg-blue-500');
            btn.classList.add('bg-blue-600');
        }
    });

    const gridContainer = document.getElementById('current-grid');
    const gridData = availableGrids.find(g => g.id === gridId);

    if (gridData && baseDirPath) {
        // Construct File URL
        const root = baseDirPath.replace(/\\/g, '/');
        const cleanRoot = root.startsWith('/') ? root : '/' + root;
        const fileName = gridData.fileName;
        const fullPath = `file://${cleanRoot}/DTC_Grids/${fileName}`;
        const uniqueParam = `?t=${Date.now()}`;

        // Add Image + Delete Overlay (WITH RETRY LOGIC and ZOOM)
        // Image styles: 
        // - w-full h-full: fills the square container
        // - object-cover: crops to fill without stretching
        // - scale-[2.0]: zooms in 2x (Tailwind arbitrary value)
        // - origin-center: zooms from center
        
        // Retry logic: checks if image failed (broken link), tries again up to 5 times.
        const retryScript = `
            if(!this.retries) this.retries = 0; 
            if(this.retries < 5) { 
                this.retries++; 
                setTimeout(()=> { this.src = '${fullPath}?t=' + Date.now(); }, 200 * this.retries); 
            }
        `;

        gridContainer.innerHTML = `
            <div class="relative w-full h-full group flex justify-center items-center overflow-hidden rounded-lg">
                <img src="${fullPath}${uniqueParam}" 
                     alt="Grid ${gridId}" 
                     class="w-full h-full object-cover transform scale-[1.5] origin-center"
                     onerror="${retryScript.replace(/\n/g, '')}">
                
                <button onclick="openDeleteGridModal(${gridId}, '${fileName}')" 
                        class="hidden group-hover:block absolute top-[6px] right-[6px] bg-red-600 text-white rounded-full p-1.5 shadow-lg hover:bg-red-700 transition z-10">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        `;
        // Ensure container has flex classes from previous logic
        gridContainer.classList.remove('crossword-grid', 'grid');
        gridContainer.classList.add('flex', 'items-center', 'justify-center');
    } else {
        gridContainer.innerHTML = '<span class="text-gray-500">Grid not found</span>';
    }
}

// --- GRID MODALS ---

function openModal() {
    document.getElementById('save-grid-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('save-grid-modal').classList.add('hidden');
}

async function saveGridAndCreateNew() {
    // Call JSX to find Comp and Save
    try {
        const resStr = await evalScriptPromise("$._ext.saveSnapshot()");
        
        // CHECK IF HOST SCRIPT RETURNED EMPTY/NULL
        if (!resStr) {
            alert("Error: Host script returned no data. \n\n1. Ensure 'FilePicker.jsx' is loaded.\n2. Ensure a comp named 'Grid' exists.\n3. Try reloading the extension.");
            return;
        }

        const res = JSON.parse(resStr);
        
        if (res.status === 'success') {
            closeModal();
            await loadGridsFromDisk(); // Reload buttons, fetching new files list
            
            // Draw new grid immediately
            // Note: image onerror handles if OS hasn't flushed file write yet
            drawGrid(res.id); 
        } else {
            alert("Error: " + res.message);
        }
    } catch(e) {
        alert("Operation Failed: " + e);
    }
}

// --- DELETE GRID ---

function openDeleteGridModal(id, fileName) {
    gridToDelete = { id, fileName };
    document.getElementById('delete-grid-message').textContent = `Are you sure you want to delete Grid ${id}? This cannot be undone.`;
    document.getElementById('delete-grid-confirm-modal').classList.remove('hidden');
}

function closeDeleteGridModal() {
    gridToDelete = null;
    document.getElementById('delete-grid-confirm-modal').classList.add('hidden');
}

async function confirmDeleteGrid() {
    if (!gridToDelete) return;

    try {
        const res = await evalScriptPromise(`$._ext.deleteGridFile("${gridToDelete.fileName}")`);
        if (res === "SUCCESS") {
            // Delete logic handles renumbering, so we just reload everything
            closeDeleteGridModal();
            await loadGridsFromDisk(); // This will pull the new [1, 2, 3...] list
            
            // If active grid was deleted or shifted, loadGridsFromDisk handles selecting first or maintaining valid selection
        } else {
            alert("Delete failed: " + res);
        }
    } catch(e) {
        alert("Error: " + e);
    }
}


function updateFileSelection(value) {
    fileSelection = value;
}


// --- SETTINGS MODAL LOGIC (STRICT SAVE/CANCEL) ---

function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;

    // 1. Restore the checkbox state from saved settings
    document.getElementById('toggle-edit-names').checked = savedSettings.isCustomNamesEnabled;

    // 2. Populate UI inputs from 'savedSettings' (which are either defaults or saved custom)
    document.getElementById('set-comp-main').value = savedSettings.compMain;
    document.getElementById('set-comp-qa').value = savedSettings.compQa;
    document.getElementById('set-comp-grid').value = savedSettings.compGrid;
    document.getElementById('set-comp-answers').value = savedSettings.compAnswers;

    document.getElementById('set-layer-ctrl').value = savedSettings.layerCtrl;
    document.getElementById('set-layer-q').value = savedSettings.layerQ;
    document.getElementById('set-layer-a').value = savedSettings.layerA;
    document.getElementById('set-layer-tile').value = savedSettings.layerTile;

    document.getElementById('set-fx-num').value = savedSettings.fxNum;
    document.getElementById('set-fx-row').value = savedSettings.fxRow;
    document.getElementById('set-fx-col').value = savedSettings.fxCol;
    document.getElementById('set-fx-rot').value = savedSettings.fxRot;
    document.getElementById('set-fx-letter').value = savedSettings.fxLetter;

    // 3. Set visual state (enable/disable fields based on restored checkbox)
    toggleSettingsInputs();

    modal.classList.remove('hidden');
}

function closeSettingsModal() {
    // "Cancel" action: Just close. 
    // Any changes made to DOM elements while open are discarded because next openSettingsModal() 
    // wipes them with values from 'savedSettings'.
    document.getElementById('settings-modal').classList.add('hidden');
}

function toggleSettingsInputs() {
    const isChecked = document.getElementById('toggle-edit-names').checked;
    const inputs = document.querySelectorAll('.settings-input');
    
    // 1. Enable/Disable
    inputs.forEach(input => {
        input.disabled = !isChecked;
    });

    // 2. LOGIC: If Unchecked -> Immediately reset UI to Defaults.
    // This means if user unchecks the box, they lose their custom edits in the UI immediately,
    // which aligns with "reset what already there... acts as default texts".
    if (!isChecked) {
        document.getElementById('set-comp-main').value = DEFAULT_SETTINGS.compMain;
        document.getElementById('set-comp-qa').value = DEFAULT_SETTINGS.compQa;
        document.getElementById('set-comp-grid').value = DEFAULT_SETTINGS.compGrid;
        document.getElementById('set-comp-answers').value = DEFAULT_SETTINGS.compAnswers;
        
        document.getElementById('set-layer-ctrl').value = DEFAULT_SETTINGS.layerCtrl;
        document.getElementById('set-layer-q').value = DEFAULT_SETTINGS.layerQ;
        document.getElementById('set-layer-a').value = DEFAULT_SETTINGS.layerA;
        document.getElementById('set-layer-tile').value = DEFAULT_SETTINGS.layerTile;
        
        document.getElementById('set-fx-num').value = DEFAULT_SETTINGS.fxNum;
        document.getElementById('set-fx-row').value = DEFAULT_SETTINGS.fxRow;
        document.getElementById('set-fx-col').value = DEFAULT_SETTINGS.fxCol;
        document.getElementById('set-fx-rot').value = DEFAULT_SETTINGS.fxRot;
        document.getElementById('set-fx-letter').value = DEFAULT_SETTINGS.fxLetter;
    }
    // If Checked -> We do nothing to the values. 
    // If coming from unchecked state, they are currently Defaults (because of logic above).
    // If coming from saved custom state, they are currently Custom.
}

function saveSettings() {
    // Commit the changes to the 'savedSettings' object
    savedSettings.isCustomNamesEnabled = document.getElementById('toggle-edit-names').checked;

    savedSettings.compMain = document.getElementById('set-comp-main').value.trim() || DEFAULT_SETTINGS.compMain;
    savedSettings.compQa = document.getElementById('set-comp-qa').value.trim() || DEFAULT_SETTINGS.compQa;
    savedSettings.compGrid = document.getElementById('set-comp-grid').value.trim() || DEFAULT_SETTINGS.compGrid;
    savedSettings.compAnswers = document.getElementById('set-comp-answers').value.trim() || DEFAULT_SETTINGS.compAnswers;

    savedSettings.layerCtrl = document.getElementById('set-layer-ctrl').value.trim() || DEFAULT_SETTINGS.layerCtrl;
    savedSettings.layerQ = document.getElementById('set-layer-q').value.trim() || DEFAULT_SETTINGS.layerQ;
    savedSettings.layerA = document.getElementById('set-layer-a').value.trim() || DEFAULT_SETTINGS.layerA;
    savedSettings.layerTile = document.getElementById('set-layer-tile').value.trim() || DEFAULT_SETTINGS.layerTile;

    savedSettings.fxNum = document.getElementById('set-fx-num').value.trim() || DEFAULT_SETTINGS.fxNum;
    savedSettings.fxRow = document.getElementById('set-fx-row').value.trim() || DEFAULT_SETTINGS.fxRow;
    savedSettings.fxCol = document.getElementById('set-fx-col').value.trim() || DEFAULT_SETTINGS.fxCol;
    savedSettings.fxRot = document.getElementById('set-fx-rot').value.trim() || DEFAULT_SETTINGS.fxRot;
    savedSettings.fxLetter = document.getElementById('set-fx-letter').value.trim() || DEFAULT_SETTINGS.fxLetter;

    // Ideally, save this to disk (JSON) here if needed.
    // For now, it is saved in memory session.
    
    console.log("Settings Saved:", savedSettings);
    closeSettingsModal();
}


// --- AFTER EFFECTS COMMUNICATION ---

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