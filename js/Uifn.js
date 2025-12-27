/**
 * UIFN.JS
 * Handling CSInterface, After Effects communication, and File System logic.
 */

const csInterface = new CSInterface();
let baseDirPath = null;
let presetsIndex = [];
let loadedPreset = null;
let questionImages = {}; // Stores slot: { name, path }
let availableGrids = [];

// --- JSX UTILS ---
function escapeForJSX(str) { 
    if (!str) return "";
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function evalScriptPromise(script) {
    return new Promise((resolve, reject) => {
        csInterface.evalScript(script, res => {
            if (res && res.startsWith("ERROR:")) reject(res);
            else resolve(res);
        });
    });
}

// --- INIT SEQUENCE ---
window.onload = async () => {
    if(typeof renderQuestionPanels === 'function') renderQuestionPanels();
    if(typeof updateContentMode === 'function') updateContentMode(true);
    if(typeof setActiveTab === 'function') setActiveTab('contents');

    try {
        const path = await evalScriptPromise("$._ext.getStoredBasePath()");
        if(path && path !== "" && !path.startsWith("ERROR")) {
            await setBaseHandleAndInit(path);
        } else {
             if(typeof generateGridButtons === 'function') generateGridButtons();
        }
    } catch(e) { 
        if(typeof generateGridButtons === 'function') generateGridButtons();
    }

    const pickBtn = document.getElementById('pickBaseBtn');
    if(pickBtn) {
        pickBtn.addEventListener('click', async () => {
            try {
                const path = await evalScriptPromise("$._ext.pickBaseFolder()");
                if(path && path !== "ERROR:CANCELED") await setBaseHandleAndInit(path);
            } catch(e) { alert(e); }
        });
    }
};

async function setBaseHandleAndInit(path) {
    // Normalize path for internal consistency
    baseDirPath = path.replace(/\\/g, '/');
    const label = document.getElementById('basePathLabel');
    if(label) { 
        label.textContent = toDisplayPath(baseDirPath); 
        label.title = baseDirPath; 
    }
    await loadIndex();
    await loadGridsFromDisk();
}

// --- PRESET ACTIONS ---
async function loadIndex() {
    try {
        const txt = await evalScriptPromise('$._ext.readTextFile("presets_index.json")');
        presetsIndex = (!txt || txt === "ERROR:INDEX_NOT_FOUND") ? [] : JSON.parse(txt);
    } catch(e) { presetsIndex = []; }
    renderPresetDropdownItems();
}

function renderPresetDropdownItems() {
    const list = document.getElementById('preset-list');
    if(!list) return;
    
    const sorted = presetsIndex.sort((a,b) => (b.updatedAt||'').localeCompare(a.updatedAt||''));
    
    let itemsHtml = sorted.map(p => `
        <div class="group relative flex items-center px-1 rounded-lg hover:bg-slate-700 transition">
            <button onclick="selectPreset('${p.id}')" class="flex-grow text-left px-3 py-2 text-sm truncate ${loadedPreset && p.id === loadedPreset.id ? 'text-blue-400 font-bold' : 'text-gray-200'}">
                ${p.name}
            </button>
            <button onclick="requestDeletePreset('${p.id}', '${p.name}')" class="hidden group-hover:block p-1 text-red-500 hover:text-red-400 mr-2 transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        </div>
    `).join('');
    
    itemsHtml += `
        <div class="border-t border-slate-700 my-1"></div>
        <button onclick="openNewPresetModal()" class="w-full text-left px-4 py-2 text-sm text-green-400 hover:bg-slate-700 rounded-lg">+ Create New Preset</button>
        <button onclick="saveChangesToPreset()" ${loadedPreset ? '' : 'disabled'} class="w-full text-left px-4 py-2 text-sm text-yellow-400 hover:bg-slate-700 rounded-lg disabled:opacity-30">Save Changes</button>
    `;
    
    list.innerHTML = itemsHtml;
    const nameSpan = document.getElementById('selected-preset-name');
    if(nameSpan) nameSpan.textContent = loadedPreset ? loadedPreset.name : '-- Select Preset --';
}

async function selectPreset(id) {
    if(typeof togglePresetDropdown === 'function') togglePresetDropdown();
    const entry = presetsIndex.find(p => p.id === id);
    if(!entry) return;
    
    try {
        const jsonPath = escapeForJSX(`${entry.folder}/preset.json`);
        const txt = await evalScriptPromise(`$._ext.readTextFile("${jsonPath}")`);
        if(!txt || txt.startsWith("ERROR:")) return alert("Error reading preset");
        
        const json = JSON.parse(txt);
        loadedPreset = { ...json, folder: entry.folder }; 
        loadDataIntoForm(json.placeholders?.data, json.placeholders?.images || [], entry.folder);
        renderPresetDropdownItems();
    } catch(e) { alert("Load failed: " + e); }
}

async function saveNewPreset() {
    const nameInput = document.getElementById('new-preset-input');
    const name = nameInput ? nameInput.value.trim() : "";
    if(!name) return;
    
    const id = Date.now().toString(36);
    const folder = `${id}_${slugify(name)}`;
    const formData = getCurrentFormData();
    
    const imagesMeta = [];
    for (const slot in questionImages) {
        const img = questionImages[slot];
        if (!img || !img.path) continue;
        
        const sourcePath = escapeForJSX(img.path);
        const destRelPath = escapeForJSX(`${folder}/assets/${img.name}`);
        
        try {
            const res = await evalScriptPromise(`$._ext.copyFile("${sourcePath}", "${destRelPath}")`);
            if (res === "SUCCESS") {
                imagesMeta.push({ slot: parseInt(slot), fileName: img.name, relPath: `assets/${img.name}` });
            }
        } catch(e) { console.error("Asset Copy Fail:", e); }
    }

    const presetData = { id, name, createdAt: nowISO(), updatedAt: nowISO(), placeholders: { data: formData, images: imagesMeta } };
    const jsonStr = escapeForJSX(JSON.stringify(presetData));
    
    try {
        await evalScriptPromise(`$._ext.writeTextFile("${folder}/preset.json", '${jsonStr}')`);
        presetsIndex.push({ id, name, folder, updatedAt: presetData.updatedAt });
        const idxStr = escapeForJSX(JSON.stringify(presetsIndex));
        await evalScriptPromise(`$._ext.writeTextFile("presets_index.json", '${idxStr}')`);
        
        loadedPreset = { ...presetData, folder };
        if(typeof closeNewPresetModal === 'function') closeNewPresetModal();
        renderPresetDropdownItems();
        alert(`Preset '${name}' created!`);
    } catch(e) { alert("Save failed: " + e); }
}

async function saveChangesToPreset() {
    if (!loadedPreset) return;
    const entry = presetsIndex.find(p => p.id === loadedPreset.id);
    if (!entry) return alert("Preset index mismatch");

    const folder = entry.folder;
    const formData = getCurrentFormData();
    let imagesMeta = [];

    for (const slot in questionImages) {
        const img = questionImages[slot];
        if (!img || !img.path) continue;
        
        const sourcePath = escapeForJSX(img.path);
        const destRelPath = escapeForJSX(`${folder}/assets/${img.name}`);
        
        // Normalize paths for comparison
        const fullDest = `${baseDirPath}/${folder}/assets/${img.name}`.replace(/\\/g, '/');
        const cleanSource = img.path.replace(/\\/g, '/');
        
        if (cleanSource !== fullDest) {
            try {
                const res = await evalScriptPromise(`$._ext.copyFile("${sourcePath}", "${destRelPath}")`);
                if (res === "SUCCESS") {
                    imagesMeta.push({ slot: parseInt(slot), fileName: img.name, relPath: `assets/${img.name}` });
                }
            } catch(e) { console.error(e); }
        } else {
            imagesMeta.push({ slot: parseInt(slot), fileName: img.name, relPath: `assets/${img.name}` });
        }
    }

    const updatedData = { ...loadedPreset, updatedAt: nowISO(), placeholders: { data: formData, images: imagesMeta } };
    delete updatedData.folder;

    try {
        const jsonStr = escapeForJSX(JSON.stringify(updatedData));
        await evalScriptPromise(`$._ext.writeTextFile("${folder}/preset.json", '${jsonStr}')`);
        entry.updatedAt = updatedData.updatedAt;
        const idxStr = escapeForJSX(JSON.stringify(presetsIndex));
        await evalScriptPromise(`$._ext.writeTextFile("presets_index.json", '${idxStr}')`);
        loadedPreset = { ...updatedData, folder };
        alert("Changes saved!");
    } catch(e) { alert("Save failed"); }
}

function getCurrentFormData() {
    const questions = [], answers = [], grids = [], frenzies = {};
    const checks = {
        autoFrenzy: document.getElementById('checkbox-auto-frenzy')?.checked || false,
        is60s: document.getElementById('checkbox-60-sec-vid')?.checked || false,
        solveA3: document.getElementById('solve-a3')?.checked || false
    };

    for (let i = 1; i <= MAX_QUESTIONS; i++) {
        questions.push(document.getElementById(`question-textarea-${i}`)?.value || "");
        answers.push(document.getElementById(`answer-${i}`)?.value || "");
        grids.push(document.getElementById(`grid-num-${i}`)?.value || "");
        const f = document.getElementById(`frenzies-${i}`);
        if (f) frenzies[i] = f.value;
    }
    return { questions, answers, grids, frenzies, checks };
}

async function loadDataIntoForm(data, imagePlaceholders = [], folder) {
    if (!data) return;
    questionImages = {}; 

    const afChk = document.getElementById('checkbox-auto-frenzy');
    const vidChk = document.getElementById('checkbox-60-sec-vid');
    if(afChk) afChk.checked = !!data.checks?.autoFrenzy;
    if(vidChk) vidChk.checked = !!data.checks?.is60s;
    
    // Sync loaded frenzy data into the global persistence cache
    if (data.frenzies) {
        window.globalFrenzyCache = { ...data.frenzies };
    }
    
    updateContentMode(true);

    const solveA3 = document.getElementById('solve-a3');
    if(solveA3) solveA3.checked = !!data.checks?.solveA3;

    for (let i = 1; i <= MAX_QUESTIONS; i++) {
        const qInput = document.getElementById(`question-textarea-${i}`); if(qInput) qInput.value = data.questions[i-1] || "";
        const aInput = document.getElementById(`answer-${i}`); if(aInput) aInput.value = data.answers[i-1] || "";
        const gInput = document.getElementById(`grid-num-${i}`); if(gInput) gInput.value = data.grids[i-1] || "";
        const fInput = document.getElementById(`frenzies-${i}`); if(fInput) fInput.value = data.frenzies[i] || "";

        const preview = document.getElementById(`image-preview-${i}`);
        const overlay = document.getElementById(`image-overlay-${i}`);
        const imgMeta = imagePlaceholders.find(p => p.slot === i);

        if (imgMeta && baseDirPath) {
            const fullLocalPath = `${baseDirPath}/${folder}/${imgMeta.relPath}`;
            const cleanPath = fullLocalPath.replace(/\\/g, '/');
            const fileUrl = "file://" + (cleanPath.startsWith('/') ? '' : '/') + cleanPath;
            
            if(preview) {
                preview.src = fileUrl;
                preview.classList.remove('hidden');
            }
            if(overlay) {
                overlay.classList.add('bg-slate-900/50');
                overlay.innerHTML = `<span class="text-[10px] text-green-400 truncate w-full px-1">${imgMeta.fileName}</span>`;
            }
            questionImages[i] = { name: imgMeta.fileName, path: fullLocalPath };
        } else {
            if(preview) { preview.src = ""; preview.classList.add('hidden'); }
            if(overlay) {
                overlay.classList.remove('bg-slate-900/50');
                overlay.innerHTML = `<span class="text-xs font-semibold">Choose Image</span>`;
            }
        }
    }
}

function handleImageSelection(event, index) {
    const file = event.target.files[0];
    if(!file) return;
    
    questionImages[index] = { name: file.name, path: file.path };
    const preview = document.getElementById(`image-preview-${index}`);
    const overlay = document.getElementById(`image-overlay-${index}`);
    
    const reader = new FileReader();
    reader.onload = (e) => {
        if(preview) { preview.src = e.target.result; preview.classList.remove('hidden'); }
        if(overlay) {
            overlay.classList.add('bg-slate-900/50');
            overlay.innerHTML = `<span class="text-[10px] text-blue-400 truncate w-full px-1">Selected: ${file.name}</span>`;
        }
    };
    reader.readAsDataURL(file);
    event.target.value = null; 
}

// --- DELETION HELPER ---
function requestDeletePreset(id, name) {
    const modal = document.getElementById('delete-confirm-modal');
    const title = document.getElementById('delete-modal-title');
    const msg = document.getElementById('delete-modal-message');
    if(title) title.textContent = "Delete Preset?";
    if(msg) msg.textContent = `Are you sure you want to delete '${name}'? This will delete the entire folder and its assets.`;
    
    const confirmBtn = document.getElementById('delete-modal-confirm-btn');
    if(confirmBtn) confirmBtn.onclick = () => confirmDeletePreset(id);
    if(modal) modal.classList.remove('hidden');
}

async function confirmDeletePreset(id) {
    const idx = presetsIndex.findIndex(p => p.id === id);
    if (idx === -1) return;
    
    const entry = presetsIndex[idx];
    try {
        const res = await evalScriptPromise(`$._ext.deleteFolder("${entry.folder}")`);
        if (res === "SUCCESS") {
            presetsIndex.splice(idx, 1);
            await evalScriptPromise(`$._ext.writeTextFile("presets_index.json", '${escapeForJSX(JSON.stringify(presetsIndex))}')`);
            if (loadedPreset && loadedPreset.id === id) loadedPreset = null;
            closeDeleteModal();
            renderPresetDropdownItems();
        }
    } catch(e) { alert("Delete failed: " + e); }
}

function closeDeleteModal() { document.getElementById('delete-confirm-modal').classList.add('hidden'); }

// --- GRID BRIDGE ---
async function loadGridsFromDisk() {
    try {
        if(!baseDirPath) return;
        const res = await evalScriptPromise("$._ext.getGridFiles()");
        availableGrids = (res && !res.startsWith("ERROR")) ? JSON.parse(res) : [];
    } catch(e) { availableGrids = []; }
    
    if(typeof generateGridButtons === 'function') generateGridButtons();
    
    if (availableGrids.length > 0) {
        if (!activeGrid || !availableGrids.find(g => g.id === activeGrid)) drawGrid(availableGrids[0].id);
        else drawGrid(activeGrid);
    } else {
        const cg = document.getElementById('current-grid');
        if(cg) cg.innerHTML = '<span class="text-gray-500 text-sm">No grids found.</span>';
    }
}

function drawGrid(gridId) {
    activeGrid = gridId;
    document.querySelectorAll('#grid-buttons button').forEach(btn => {
        if(btn.innerText === "+") return;
        btn.classList.toggle('bg-blue-600', btn.id === `grid-btn-${gridId}`);
        btn.classList.toggle('bg-blue-500', btn.id !== `grid-btn-${gridId}`);
    });

    const gridContainer = document.getElementById('current-grid');
    const gridData = availableGrids.find(g => g.id === gridId);
    if (gridData && baseDirPath) {
        const root = baseDirPath.replace(/\\/g, '/');
        const cleanRoot = root.startsWith('/') ? root : '/' + root;
        const fullPath = `file://${cleanRoot}/DTC_Grids/${gridData.fileName}`;
        
        if(gridContainer) {
            gridContainer.innerHTML = `
                <div class="relative w-full h-full group flex justify-center items-center overflow-hidden rounded-lg">
                    <img src="${fullPath}?t=${Date.now()}" alt="Grid ${gridId}" class="w-full h-full object-cover transform scale-[1.3]">
                    <button onclick="requestDeleteGrid(${gridId}, '${gridData.fileName}')" class="hidden group-hover:block absolute top-[6px] right-[6px] bg-red-600 text-white rounded-full p-1.5 shadow-lg transition">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>`;
        }
    }
}

async function requestDeleteGrid(id, fileName) {
    const modal = document.getElementById('delete-confirm-modal');
    const title = document.getElementById('delete-modal-title');
    const msg = document.getElementById('delete-modal-message');
    if(title) title.textContent = "Delete Grid?";
    if(msg) msg.textContent = `Are you sure you want to delete Grid ${id}?`;
    
    const confirmBtn = document.getElementById('delete-modal-confirm-btn');
    if(confirmBtn) {
        confirmBtn.onclick = async () => {
            try {
                const res = await evalScriptPromise(`$._ext.deleteGridFile("${fileName}")`);
                if (res === "SUCCESS") {
                    closeDeleteModal();
                    await loadGridsFromDisk();
                }
            } catch(e) { alert("Delete failed"); }
        };
    }
    if(modal) modal.classList.remove('hidden');
}

async function saveGridAndCreateNew() {
    // REQUIREMENT: Visual cue on the button
    const modal = document.getElementById('save-grid-modal');
    const saveBtn = modal ? modal.querySelector('button.bg-blue-600') : null;
    let originalText = "";
    
    if (saveBtn) {
        originalText = saveBtn.textContent;
        saveBtn.textContent = "Saving...";
        saveBtn.disabled = true;
    }

    try {
        const resStr = await evalScriptPromise("$._ext.saveSnapshot()");
        const res = JSON.parse(resStr);
        if (res.status === 'success') {
            // REQUIREMENT: 0.3s fake delay loading animation
            setTimeout(async () => {
                if(typeof closeModal === 'function') closeModal();
                await loadGridsFromDisk();
                drawGrid(res.id); 
                
                // Restore button for next time
                if (saveBtn) {
                    saveBtn.textContent = originalText;
                    saveBtn.disabled = false;
                }
            }, 300);
        } else {
            alert("Error: " + res.message);
            if (saveBtn) { saveBtn.textContent = originalText; saveBtn.disabled = false; }
        }
    } catch(e) { 
        alert("Operation Failed: " + e); 
        if (saveBtn) { saveBtn.textContent = originalText; saveBtn.disabled = false; }
    }
}

function saveSettings() {
    savedSettings.isCustomNamesEnabled = document.getElementById('toggle-edit-names').checked;
    
    // Frenzy settings
    savedSettings.f1a2 = document.getElementById('set-f1-a2')?.value;
    savedSettings.f2a3 = document.getElementById('set-f2-a3')?.value;
    savedSettings.f3a4 = document.getElementById('set-f3-a4')?.value;
    savedSettings.f4a5 = document.getElementById('set-f4-a5')?.value;
    savedSettings.f5a6 = document.getElementById('set-f5-a6')?.value;
    savedSettings.minGap = document.getElementById('set-min-gap')?.value;
    savedSettings.randSeed = document.getElementById('set-rand-seed')?.value;
    
    // Markers
    savedSettings.replaceImage = document.getElementById('set-chk-replace')?.checked;
    savedSettings.preserveMarker = document.getElementById('set-chk-preserve')?.checked;

    const fields = ['compMain', 'compQa', 'compGrid', 'compAnswers', 'layerCtrl', 'layerQ', 'layerA', 'layerTile'];
    fields.forEach(f => {
        const el = document.getElementById('set-' + f.toLowerCase().replace(/([a-z])([A-Z])/g, '$1-$2'));
        if (el) savedSettings[f] = el.value.trim() || DEFAULT_SETTINGS[f];
    });
    
    if(typeof closeSettingsModal === 'function') closeSettingsModal();
}