/**
 * UIFN.JS
 * Handling CSInterface, After Effects communication, and File System logic.
 */

// =================================================================================
// 1. INITIALIZATION & STATE
// =================================================================================
const csInterface = new CSInterface();

let baseDirPath = null;
let presetsIndex = [];
let loadedPreset = null;
let questionImages = {}; 
let availableGrids = [];

// =================================================================================
// 2. JSX / STRING UTILITIES
// =================================================================================

function escapeForJSX(str) { 
    if (!str) return "";
    return str.replace(/\\/g, '\\\\').replace(/\"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function evalScriptPromise(script) {
    return new Promise((resolve, reject) => {
        csInterface.evalScript(script, res => {
            if (res && res.startsWith("ERROR:")) reject(res);
            else resolve(res);
        });
    });
}

// =================================================================================
// 2B. HOST SCRIPT LOADER (ROBUST)
// =================================================================================
// Some AE installs / cold starts may not have loaded jsx/main.jsx yet.
// Before calling any $._ext function, we ensure the host entry is loaded.
function ensureHostFunctions(requiredFnNames, cb) {
    try {
        var checks = (requiredFnNames || []).map(function (fn) {
            return '($._ext && typeof $._ext.' + fn + ' === "function")';
        }).join(' && ');
        if (!checks) checks = '($._ext)';

        csInterface.evalScript('(' + checks + ') ? "OK" : "MISSING"', function (res) {
            if (String(res) === 'OK') return cb();

            // Attempt to (re)load host entry then continue.
            var extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
            var safePath = (extensionRoot + '/jsx/main.jsx').replace(/\\/g, '/');
            csInterface.evalScript('$.evalFile("' + safePath + '")', function () {
                cb();
            });
        });
    } catch (e) {
        // Fail-open: still attempt callback so we don't block UI.
        cb();
    }
}

// =================================================================================
// 3. SYSTEM INITIALIZATION
// =================================================================================

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
                if(path && path !== "ERROR:CANCELED") {
                    await setBaseHandleAndInit(path);
                    showToast("Folder selected successfully!");
                } else {
                    const displayPath = (typeof toDisplayPath === 'function') ? toDisplayPath(baseDirPath) : "/DTC_Presets";
                    showToast(`Current preset folder is "${displayPath}"`);
                }
            } catch(e) { showToast("Error: " + e); }
        });
    }
};

async function setBaseHandleAndInit(path) {
    baseDirPath = path.replace(/\\/g, '/');
    const label = document.getElementById('basePathLabel');
    if(label) { 
        label.textContent = (typeof toDisplayPath === 'function') ? toDisplayPath(baseDirPath) : "/DTC_Presets"; 
        label.title = baseDirPath; 
    }
    await loadIndex();
    await loadGridsFromDisk();
}

// =================================================================================
// 4. PRESET CORE ACTIONS
// =================================================================================

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
    itemsHtml += `<div class="border-t border-slate-700 my-1"></div><button onclick="openNewPresetModal()" class="w-full text-left px-4 py-2 text-sm text-green-400 hover:bg-slate-700 rounded-lg">+ Create New Preset</button><button onclick="saveChangesConfirmation()" ${loadedPreset ? '' : 'disabled'} class="w-full text-left px-4 py-2 text-sm text-yellow-400 hover:bg-slate-700 rounded-lg disabled:opacity-30">Save Changes</button>`;
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
        if(!txt || txt.startsWith("ERROR:")) return showToast("Error reading preset");
        const json = JSON.parse(txt);
        loadedPreset = { ...json, folder: entry.folder }; 
        loadDataIntoForm(json.placeholders?.data, json.placeholders?.images || [], entry.folder);
        renderPresetDropdownItems();
    } catch(e) { showToast("Load failed"); }
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
        const res = await evalScriptPromise(`$._ext.copyFile("${escapeForJSX(img.path)}", "${escapeForJSX(folder + '/assets/' + img.name)}")`);
        if (res === "SUCCESS") imagesMeta.push({ slot: parseInt(slot), fileName: img.name, relPath: `assets/${img.name}` });
    }
    const presetData = { id, name, createdAt: nowISO(), updatedAt: nowISO(), placeholders: { data: formData, images: imagesMeta } };
    try {
        await evalScriptPromise(`$._ext.writeTextFile("${folder}/preset.json", '${escapeForJSX(JSON.stringify(presetData))}')`);
        presetsIndex.push({ id, name, folder, updatedAt: presetData.updatedAt });
        await evalScriptPromise(`$._ext.writeTextFile("presets_index.json", '${escapeForJSX(JSON.stringify(presetsIndex))}')`);
        loadedPreset = { ...presetData, folder };
        if(typeof closeNewPresetModal === 'function') closeNewPresetModal();
        renderPresetDropdownItems();
        showToast(`Preset '${name}' created!`);
    } catch(e) { showToast("Save failed"); }
}

function saveChangesConfirmation() {
    if (!loadedPreset) return;
    const modal = document.getElementById('save-confirm-modal');
    const msg = document.getElementById('save-confirm-message');
    if (msg) msg.textContent = `Update changes to '${loadedPreset.name}'?`;
    if (modal) modal.classList.remove('hidden');
}

function closeSaveConfirmModal() {
    const modal = document.getElementById('save-confirm-modal');
    if (modal) modal.classList.add('hidden');
}

async function saveChangesToPreset() {
    if (!loadedPreset) return;
    const entry = presetsIndex.find(p => p.id === loadedPreset.id);
    if (!entry) return;
    const folder = entry.folder;
    const formData = getCurrentFormData();
    let imagesMeta = [];
    for (const slot in questionImages) {
        const img = questionImages[slot];
        if (!img || !img.path) continue;
        const fullDest = `${baseDirPath}/${folder}/assets/${img.name}`.replace(/\\/g, '/');
        const cleanSource = img.path.replace(/\\/g, '/');
        if (cleanSource !== fullDest) {
            const res = await evalScriptPromise(`$._ext.copyFile("${escapeForJSX(img.path)}", "${escapeForJSX(folder + '/assets/' + img.name)}")`);
            if (res === "SUCCESS") imagesMeta.push({ slot: parseInt(slot), fileName: img.name, relPath: `assets/${img.name}` });
        } else {
            imagesMeta.push({ slot: parseInt(slot), fileName: img.name, relPath: `assets/${img.name}` });
        }
    }
    const updatedData = { ...loadedPreset, updatedAt: nowISO(), placeholders: { data: formData, images: imagesMeta } };
    delete updatedData.folder;
    try {
        await evalScriptPromise(`$._ext.writeTextFile("${folder}/preset.json", '${escapeForJSX(JSON.stringify(updatedData))}')`);
        entry.updatedAt = updatedData.updatedAt;
        await evalScriptPromise(`$._ext.writeTextFile("presets_index.json", '${escapeForJSX(JSON.stringify(presetsIndex))}')`);
        loadedPreset = { ...updatedData, folder };
        closeSaveConfirmModal();
        showToast("Changes saved successfully!");
    } catch(e) { showToast("Save failed"); }
}

// =================================================================================
// 5. DATA SYNC & LOADING
// =================================================================================

function getCurrentFormData() {
    const questions = [], answers = [], grids = [], frenzies = {};
    const checks = {
        autoFrenzy: document.getElementById('checkbox-auto-frenzy')?.checked || false,
        is60s: document.getElementById('checkbox-60-sec-vid')?.checked || false,
        solveA3: document.getElementById('solve-a3-checkbox')?.checked || false
    };
    for (let i = 1; i <= MAX_QUESTIONS; i++) {
        questions.push(document.getElementById(`question-textarea-${i}`)?.value || "");
        answers.push(document.getElementById(`answer-${i}`)?.value || "");
        grids.push(document.getElementById(`grid-num-${i}`)?.value || "");
        const fInput = document.getElementById(`frenzies-${i}`);
        if (fInput) window.globalFrenzyCache[i] = fInput.value;
        frenzies[i] = window.globalFrenzyCache[i] || "";
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
    
    if (data.frenzies) {
        window.globalFrenzyCache = { ...data.frenzies };
    }
    
    if(typeof updateContentMode === 'function') updateContentMode(true);

    const solveA3 = document.getElementById('solve-a3-checkbox');
    if(solveA3) solveA3.checked = !!data.checks?.solveA3;

    for (let i = 1; i <= MAX_QUESTIONS; i++) {
        const qInput = document.getElementById(`question-textarea-${i}`); if(qInput) qInput.value = data.questions[i-1] || "";
        const aInput = document.getElementById(`answer-${i}`); if(aInput) aInput.value = data.answers[i-1] || "";
        const gInput = document.getElementById(`grid-num-${i}`); if(gInput) gInput.value = data.grids[i-1] || "";
        
        const fInput = document.getElementById(`frenzies-${i}`); 
        if(fInput) fInput.value = window.globalFrenzyCache[i] || "";

        const preview = document.getElementById(`image-preview-${i}`);
        const overlay = document.getElementById(`image-overlay-${i}`);
        const imgMeta = imagePlaceholders.find(p => p.slot === i);

        if (imgMeta && baseDirPath) {
            const fullLocalPath = `${baseDirPath}/${folder}/${imgMeta.relPath}`;
            const cleanPath = fullLocalPath.replace(/\\/g, '/');
            const fileUrl = "file://" + (cleanPath.startsWith('/') ? '' : '/') + cleanPath;
            if(preview) { preview.src = fileUrl; preview.classList.remove('hidden'); }
            if(overlay) { overlay.classList.add('bg-slate-900/50'); overlay.innerHTML = `<span class="text-[10px] text-green-400 truncate w-full px-1">${imgMeta.fileName}</span>`; }
            questionImages[i] = { name: imgMeta.fileName, path: fullLocalPath };
        } else {
            if(preview) { preview.src = ""; preview.classList.add('hidden'); }
            if(overlay) { overlay.classList.remove('bg-slate-900/50'); overlay.innerHTML = `<span class="text-xs font-semibold">Choose Image</span>`; }
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
        if(overlay) { overlay.classList.add('bg-slate-900/50'); overlay.innerHTML = `<span class="text-[10px] text-blue-400 truncate w-full px-1">Selected: ${file.name}</span>`; }
    };
    reader.readAsDataURL(file);
    event.target.value = null; 
}

// =================================================================================
// 6. DELETE & GRID BRIDGE ACTIONS
// =================================================================================

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
            showToast("Preset deleted.");
        }
    } catch(e) { showToast("Delete failed"); }
}

function closeDeleteModal() { document.getElementById('delete-confirm-modal').classList.add('hidden'); }

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
                    <button id="delete-grid-btn-${gridId}" class="hidden group-hover:block absolute top-[6px] right-[6px] bg-red-600 text-white rounded-full p-1.5 shadow-lg transition" title="Delete Grid">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>`;

            // Bind delete via addEventListener (no inline onclick)
            const delBtn = document.getElementById(`delete-grid-btn-${gridId}`);
            if (delBtn) delBtn.addEventListener('click', () => requestDeleteGrid(gridId, gridData.fileName));
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
                    showToast("Grid deleted.");
                }
            } catch(e) { showToast("Delete failed"); }
        };
    }
    if(modal) modal.classList.remove('hidden');
}

async function saveGridAndCreateNew() {
    const modal = document.getElementById('save-grid-modal');
    const saveBtn = modal ? modal.querySelector('button.bg-blue-600') : null;
    let originalText = "";
    if (saveBtn) { originalText = saveBtn.textContent; saveBtn.textContent = "Saving..."; saveBtn.disabled = true; }
    try {
        const resStr = await evalScriptPromise("$._ext.saveSnapshotAndPreset()");
        const res = JSON.parse(resStr);
        if (res.status === 'success') {
            setTimeout(async () => {
                if(typeof closeModal === 'function') closeModal();
                await loadGridsFromDisk();
                drawGrid(res.id); 
                if (saveBtn) { saveBtn.textContent = originalText; saveBtn.disabled = false; }
                showToast("Grid saved!");
            }, 300);
        } else {
            showToast("Error saving grid");
            if (saveBtn) { saveBtn.textContent = originalText; saveBtn.disabled = false; }
        }
    } catch(e) { 
        showToast("Operation Failed"); 
        if (saveBtn) { saveBtn.textContent = originalText; saveBtn.disabled = false; }
    }
}

// Load the currently selected grid preset (png id == json id)
async function loadActiveGridPreset() {
    try {
        if (!baseDirPath) return showToast("Select Folder First");
        if (!activeGrid) return showToast("No grid selected");
        const res = await evalScriptPromise(`$._ext.loadGridPresetById(${activeGrid})`);
        if (res === "SUCCESS") {
            showToast(`Grid ${activeGrid} loaded in AE!`);
            // Requirement: After loading preset, auto-run Gen GridNum with 0.05s delay
            setTimeout(async () => {
                try { await evalScriptPromise("$._ext.genGridNum()"); } catch (e) {}
            }, 50);
        } else {
            showToast((res && res.toString()) || "Load failed");
        }
    } catch (e) {
        showToast("Load failed");
    }
}

// =================================================================================
// 7. SETTINGS & AE BRIDGE
// =================================================================================

function saveSettings() {
    // NOTE: Do NOT rely on computed IDs here.
    // The HTML uses explicit kebab-case IDs (e.g. set-comp-main), so we map explicitly.

    const getText = (id) => (document.getElementById(id)?.value ?? '').toString().trim();
    const getChk = (id) => !!document.getElementById(id)?.checked;

    // Frenzy settings
    savedSettings.f1a2 = getText('set-f1-a2') || DEFAULT_SETTINGS.f1a2;
    savedSettings.f2a3 = getText('set-f2-a3') || DEFAULT_SETTINGS.f2a3;
    savedSettings.f3a4 = getText('set-f3-a4') || DEFAULT_SETTINGS.f3a4;
    savedSettings.f4a5 = getText('set-f4-a5') || DEFAULT_SETTINGS.f4a5;
    savedSettings.f5a6 = getText('set-f5-a6') || DEFAULT_SETTINGS.f5a6;
    savedSettings.af1  = getText('set-af1')   || DEFAULT_SETTINGS.af1;
    savedSettings.af2  = getText('set-af2')   || DEFAULT_SETTINGS.af2;
    savedSettings.af3  = getText('set-af3')   || DEFAULT_SETTINGS.af3;
    savedSettings.af4  = getText('set-af4')   || DEFAULT_SETTINGS.af4;
    savedSettings.af5  = getText('set-af5')   || DEFAULT_SETTINGS.af5;
    savedSettings.minGap   = getText('set-min-gap')   || DEFAULT_SETTINGS.minGap;
    savedSettings.randSeed = getText('set-rand-seed') || DEFAULT_SETTINGS.randSeed;

    // Answer & marker settings
    savedSettings.replaceImage   = getChk('set-chk-replace');
    savedSettings.preserveMarker = getChk('set-chk-preserve');

    // Persist ALL remaining sections the same way as the first two sections.
    const pairs = [
        // Comp names
        ['set-comp-main',   'compMain'],
        ['set-comp-qa',     'compQa'],
        ['set-comp-grid',   'compGrid'],
        ['set-comp-answers','compAnswers'],

        // Layer names
        ['set-layer-ctrl',       'layerCtrl'],
        ['set-layer-adv-ctrl',   'advLayerCtrl'],
        ['set-layer-q',          'layerQ'],
        ['set-layer-a',          'layerA'],
        ['set-layer-tile',       'layerTile'],
        ['set-layer-parent',     'layerParent'],

        // Effect / property names
        ['set-fx-num',     'fxNum'],
        ['set-fx-row',     'fxRow'],
        ['set-fx-col',     'fxCol'],
        ['set-fx-rot',     'fxRot'],
        ['set-fx-letter',  'fxLetter']
    ];

    pairs.forEach(([id, key]) => {
        const v = getText(id);
        savedSettings[key] = v || DEFAULT_SETTINGS[key];
    });

    // Persist to localStorage so values survive refresh / reopen.
    try {
        localStorage.setItem('nova_savedSettings', JSON.stringify(savedSettings));
    } catch (e) {}

    if (typeof closeSettingsModal === 'function') closeSettingsModal();
    showToast('Settings saved.');
}

function collectAndApplyContent() {
    // Build CEP payload for Crossword AutoPlacer.
    // NOTE: Empty fields are allowed; the JSX script preserves existing values when textboxes are empty.

    const rows = [];
    for (let i = 1; i <= MAX_QUESTIONS; i++) {
        const q = document.getElementById(`question-textarea-${i}`)?.value ?? "";
        const a = document.getElementById(`answer-${i}`)?.value ?? "";
        const g = document.getElementById(`grid-num-${i}`)?.value ?? "";
        const f = document.getElementById(`frenzies-${i}`)?.value ?? (window.globalFrenzyCache?.[i] ?? "");
        const imgPath = questionImages?.[i]?.path ?? "";
        rows.push({
            grid: g,
            question: q,
            answer: a,
            frenzy: f,
            imagePath: imgPath
        });
    }

    const matchCounts = [
        savedSettings.f1a2, savedSettings.f2a3, savedSettings.f3a4,
        savedSettings.f4a5, savedSettings.f5a6, "0"
    ];
    const afCounts = [
        savedSettings.af1, savedSettings.af2, savedSettings.af3,
        savedSettings.af4, savedSettings.af5, "0"
    ];

    // Ensure layer prefixes work with CrosswordAutoPlacer's "PREFIX + index" naming.
    // If user enters "QUESTION" we normalize to "QUESTION " so layers like "QUESTION 1" resolve.
    function normalizePrefix(p) {
        const s = (p ?? '').toString();
        if (!s) return s;
        if (/[A-Za-z]$/.test(s)) return s + ' ';
        return s;
    }

    const payload = {
        rows,
        settings: {
            // Core run settings
            minGap: savedSettings.minGap,
            randSeed: savedSettings.randSeed,
            replaceImage: !!savedSettings.replaceImage,
            autoFrenzy: !!(document.getElementById("checkbox-auto-frenzy")?.checked),

            // Frenzy mapping settings
            matchCounts,
            afCounts,

            // Names (must map to JSX constants)
            compMain: savedSettings.compMain,
            compQa: savedSettings.compQa,
            compGrid: savedSettings.compGrid,
            compAnswers: savedSettings.compAnswers,

            layerCtrl: savedSettings.layerCtrl,
            advLayerCtrl: savedSettings.advLayerCtrl,
            layerQPrefix: normalizePrefix(savedSettings.layerQ),
            layerAPrefix: normalizePrefix(savedSettings.layerA),
            layerTile: savedSettings.layerTile,
            layerParent: savedSettings.layerParent,

            fxNum: savedSettings.fxNum,
            fxRow: savedSettings.fxRow,
            fxCol: savedSettings.fxCol,
            fxRot: savedSettings.fxRot,
            fxLetter: savedSettings.fxLetter
        }
    };

    const cmd = `$._ext.CrosswordAutoPlacer_apply(\"${escapeForJSX(JSON.stringify(payload))}\")`;

    // Ensure host entry + CrosswordAutoPlacer hook is available, then apply.
    ensureHostFunctions(["CrosswordAutoPlacer_apply"], function () {
        csInterface.evalScript(cmd, (res) => {
            if (res && String(res).indexOf("ERROR") === 0) {
                showToast("AE Error: " + res);
            } else {
                showToast("Applied to AE.");

                // Run AdjustMarkerKeypad based on UI checkboxes (Preserve / 60 sec / Solve A3)
                try {
                    const preserveEl = document.getElementById("set-chk-preserve");
                    const is60El = document.getElementById("checkbox-60-sec-vid");
                    const solveA3El = document.getElementById("solve-a3-checkbox");

                    const preserve = preserveEl ? !!preserveEl.checked : true;
                    const is60 = is60El ? !!is60El.checked : true;
                    const solveA3 = (!is60 && solveA3El) ? !!solveA3El.checked : false;

                    // Slight delay helps AE settle after content placement
                    setTimeout(() => {
                        ensureHostFunctions(["adjustMarkerKeypad"], function () {
                            const cmd2 = `$._ext.adjustMarkerKeypad(${preserve}, ${is60}, ${solveA3})`;
                            csInterface.evalScript(cmd2, (res2) => {
                                if (res2 && res2.toString().indexOf("ERROR:") === 0) {
                                    console.error("AdjustMarkerKeypad error:", res2);
                                    showToast("Marker adjust error: " + res2, "error");
                                }
                            });
                        });
                    }, 50);
                } catch (e) {
                    console.error(e);
                }

            }
        });
    });

    showToast("Applying content to AE...");
}


