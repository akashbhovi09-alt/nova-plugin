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

// Limit how much of a preset name we show in the CONTENTS tab trigger.
// Requirement: max 18 characters (including spaces), then "...".
function truncatePresetNameForUI(name, maxChars) {
    var s = String(name || '');
    var m = (typeof maxChars === 'number' && maxChars > 0) ? maxChars : 18;
    if (s.length <= m) return s;
    // Keep exactly m characters visible, then append ellipsis.
    return s.substring(0, m) + '...';
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
    if (nameSpan) {
        var fullName = loadedPreset ? (loadedPreset.name || '') : '-- Select Preset --';
        nameSpan.textContent = truncatePresetNameForUI(fullName, 18);
        // Keep full name accessible (hover) and for internal UI reads.
        try { nameSpan.setAttribute('title', fullName); } catch(_) {}
        try { nameSpan.setAttribute('data-fullname', fullName); } catch(_) {}
    }
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
        loadDataIntoForm(json.placeholders?.data, json.placeholders?.images || [], entry.folder, json.placeholders?.ccExtraImages || []);
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
    const ccExtraImagesMeta = [];
    for (const slot in questionImages) {
        const img = questionImages[slot];
        if (!img || !img.path) continue;
        const res = await evalScriptPromise(`$._ext.copyFile("${escapeForJSX(img.path)}", "${escapeForJSX(folder + '/assets/' + img.name)}")`);
        if (res === "SUCCESS") imagesMeta.push({ slot: parseInt(slot), fileName: img.name, relPath: `assets/${img.name}` });
    }
// Copy CC extra images into preset assets (KEEP ORIGINAL FILE NAME)
for (let i = 0; i < (ccExtraImages || []).length; i++) {
    const img = ccExtraImages[i];
    if (!img || !img.path) continue;
    // IMPORTANT: Do NOT rename CC images. Keep exactly the same name as selected.
    const originalName = String(img.name || "").trim();
    if (!originalName) continue;
    const res = await evalScriptPromise(`$._ext.copyFile("${escapeForJSX(img.path)}", "${escapeForJSX(folder + '/assets/' + originalName)}")`);
    if (res === "SUCCESS") ccExtraImagesMeta.push({ fileName: originalName, relPath: `assets/${originalName}` });
}
const presetData = { id, name, createdAt: nowISO(), updatedAt: nowISO(), placeholders: { data: formData, images: imagesMeta, ccExtraImages: ccExtraImagesMeta } };
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

    // Build a reference map of currently-selected images in the UI.
    // IMPORTANT: If the same image (same file name) is used multiple times across
    // Questions and/or CC, deleting one instance must NOT delete the physical asset
    // while another instance still references it.
    // We store referenced items as relPaths like: assets/<originalName>
    const _referencedRel = (function(){
        const m = {};
        try {
            // Question panel references
            for (const slot in (questionImages || {})) {
                const it = questionImages[slot];
                if (!it || !it.name) continue;
                const rel = 'assets/' + String(it.name);
                m[rel] = (m[rel] || 0) + 1;
            }
        } catch(e) {}
        try {
            // CC panel references
            for (let i = 0; i < (ccExtraImages || []).length; i++) {
                const it = ccExtraImages[i];
                if (!it || !it.name) continue;
                const rel = 'assets/' + String(it.name);
                m[rel] = (m[rel] || 0) + 1;
            }
        } catch(e2) {}
        return m;
    })();

    // Delete any removed preset assets from disk (scheduled by UI deletions)
    try {
        const dels = (typeof window !== 'undefined' && window.deletedPresetAssetRelPaths && Array.isArray(window.deletedPresetAssetRelPaths)) ? window.deletedPresetAssetRelPaths : [];
        if (dels.length > 0) {
            const _remainingDels = [];
            for (let i = 0; i < dels.length; i++) {
                const rel = dels[i];
                if (!rel) continue;
                // Guard: If still referenced elsewhere in UI, do NOT delete from disk.
                try {
                    if (_referencedRel && _referencedRel[String(rel)] > 0) { _remainingDels.push(rel); continue; }
                } catch(g) {}
                try { await evalScriptPromise(`$._ext.deleteFile("${escapeForJSX(folder + '/' + rel)}")`); } catch(x) {}
            }
            // Keep any still-referenced items queued for a future save after user removes the last reference.
            window.deletedPresetAssetRelPaths = _remainingDels;
        }
    } catch(e) {}
    const formData = getCurrentFormData();
    let imagesMeta = [];
    let ccExtraImagesMeta = [];
    for (const slot in questionImages) {
        const img = questionImages[slot];
        if (!img || !img.path) continue;
        const fullDest = `${baseDirPath}/${folder}/assets/${img.name}`.replace(/\\/g, '/');
        const cleanSource = img.path.replace(/\\/g, '/');
        if (cleanSource !== fullDest) {
            const res = await evalScriptPromise(`$._ext.copyFile("${escapeForJSX(img.path)}", "${escapeForJSX(folder + '/assets/' + img.name)}")`);
            if (res === "SUCCESS") {
                imagesMeta.push({ slot: parseInt(slot), fileName: img.name, relPath: `assets/${img.name}` });
                // IMPORTANT: keep in-memory items updated so future deletions/replacements delete from disk.
                // Do NOT rename files. Keep the exact original file name.
                try { img.relPath = `assets/${img.name}`; img.fromPreset = true; img.assetFileName = img.name; img.path = fullDest; } catch (x) {}
            }
        } else {
            imagesMeta.push({ slot: parseInt(slot), fileName: img.name, relPath: `assets/${img.name}` });
            try { img.relPath = `assets/${img.name}`; img.fromPreset = true; img.assetFileName = img.name; img.path = fullDest; } catch (x) {}
        }
    }
// Copy CC extra images into preset assets (KEEP ORIGINAL FILE NAME)
for (let i = 0; i < (ccExtraImages || []).length; i++) {
    const img = ccExtraImages[i];
    if (!img || !img.path) continue;
    const originalName = String(img.name || "").trim();
    if (!originalName) continue;
    const fullDest = `${baseDirPath}/${folder}/assets/${originalName}`.replace(/\\/g, '/');
    const cleanSource = img.path.replace(/\\/g, '/');
    const rel = `assets/${originalName}`;
    if (cleanSource !== fullDest) {
        const res = await evalScriptPromise(`$._ext.copyFile("${escapeForJSX(img.path)}", "${escapeForJSX(folder + '/assets/' + originalName)}")`);
        if (res === "SUCCESS") {
            ccExtraImagesMeta.push({ fileName: originalName, relPath: rel });
            // Keep in-memory items updated so future deletions delete from disk
            try { img.relPath = rel; img.fromPreset = true; img.assetFileName = originalName; img.path = fullDest; } catch (x) {}
        }
    } else {
        ccExtraImagesMeta.push({ fileName: originalName, relPath: rel });
        try { img.relPath = rel; img.fromPreset = true; img.assetFileName = originalName; img.path = fullDest; } catch (x) {}
    }
}

    // --- Additive cleanup ---
    // CC extra images now KEEP ORIGINAL NAMES (no CC_ prefix). We can still safely remove
    // orphaned CC assets by comparing previously-saved ccExtraImages relPaths to the newly-saved list.
    // We only delete files that were previously recorded in preset.json under placeholders.ccExtraImages.
    try {
        const oldList = (loadedPreset && loadedPreset.placeholders && Array.isArray(loadedPreset.placeholders.ccExtraImages)) ? loadedPreset.placeholders.ccExtraImages : [];
        const oldRelPaths = oldList.map(m => m && m.relPath ? String(m.relPath) : '').filter(Boolean);
        const newRelPaths = ccExtraImagesMeta.map(m => m && m.relPath ? String(m.relPath) : '').filter(Boolean);
        for (let i = 0; i < oldRelPaths.length; i++) {
            const rel = oldRelPaths[i];
            if (!rel) continue;
            if (newRelPaths.indexOf(rel) === -1) {
                try { await evalScriptPromise(`$._ext.deleteFile("${escapeForJSX(folder + '/' + rel)}")`); } catch(x) {}
            }
        }
    } catch (e) {}
const updatedData = { ...loadedPreset, updatedAt: nowISO(), placeholders: { data: formData, images: imagesMeta, ccExtraImages: ccExtraImagesMeta } };
    delete updatedData.folder;
    try {
        await evalScriptPromise(`$._ext.writeTextFile("${folder}/preset.json", '${escapeForJSX(JSON.stringify(updatedData))}')`);
        entry.updatedAt = updatedData.updatedAt;
        await evalScriptPromise(`$._ext.writeTextFile("presets_index.json", '${escapeForJSX(JSON.stringify(presetsIndex))}')`);
        loadedPreset = { ...updatedData, folder };
        closeSaveConfirmModal();
        showToast("Changes saved successfully!🙌");
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

async function loadDataIntoForm(data, imagePlaceholders = [], folder, ccExtraImagePlaceholders = []) {
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
        const box = document.getElementById(`image-box-${i}`);
        const imgMeta = imagePlaceholders.find(p => p.slot === i);

        if (imgMeta && baseDirPath) {
            const fullLocalPath = `${baseDirPath}/${folder}/${imgMeta.relPath}`;
            const cleanPath = fullLocalPath.replace(/\\/g, '/');
            const fileUrl = "file://" + (cleanPath.startsWith('/') ? '' : '/') + cleanPath;
            if(preview) { preview.src = fileUrl; preview.classList.remove('hidden'); }
            if(overlay) { overlay.classList.add('bg-slate-900/50'); overlay.innerHTML = `<span class="text-[10px] text-green-400 truncate w-full px-1">${imgMeta.fileName}</span>`; }
            if(box) { box.classList.add('has-image'); }
            questionImages[i] = { name: imgMeta.fileName, path: fullLocalPath, relPath: imgMeta.relPath, fromPreset: true };
        } else {
            if(preview) { preview.src = ""; preview.classList.add('hidden'); }
            if(overlay) { overlay.classList.remove('bg-slate-900/50'); overlay.innerHTML = `<span class="text-xs font-semibold">Choose Image</span>`; }
            if(box) { box.classList.remove('has-image'); }
        }
    }

// CC Extra images (UI) - restore previews if preset has them
try {
    // IMPORTANT: keep window.ccExtraImages in sync, otherwise stale CC images can leak
    // into Apply Content (and therefore CC Attribution) even when the UI looks cleared.
    ccExtraImages = [];
    try { if (typeof window !== 'undefined') window.ccExtraImages = []; } catch(_) {}
    const ccList = Array.isArray(ccExtraImagePlaceholders) ? ccExtraImagePlaceholders : [];
    if (ccList.length > 0 && baseDirPath && folder) {
        ccList.forEach((m) => {
            if (!m) return;
            const fullLocalPath = `${baseDirPath}/${folder}/${m.relPath}`.replace(/\\/g, '/');
            const cleanPath = fullLocalPath.replace(/\\/g, '/');
            const fileUrl = "file://" + (cleanPath.startsWith('/') ? '' : '/') + cleanPath;
            ccExtraImages.push({ id: newId ? newId() : (Date.now().toString(36)+Math.random().toString(36).slice(2)), name: m.fileName, path: fullLocalPath, relPath: m.relPath, fromPreset: true, dataUrl: "", fileUrl: fileUrl });
        });
    }
    try { if (typeof window !== 'undefined') window.ccExtraImages = ccExtraImages; } catch(_) {}
    if (typeof renderCCExtraImages === 'function') renderCCExtraImages();
} catch(e) {}

}

function handleImageSelection(event, index) {
    const file = event.target.files[0];
    if(!file) return;

    // REPLACE BEHAVIOR:
    // If a question slot already had an image saved in the preset assets, and the user selects
    // another image (i.e., replacing), we must delete the old asset file on next "Save Changes".
    // IMPORTANT: since we keep original file names, do NOT schedule deletion if the old relPath
    // would be identical to the newly-selected file's relPath (same name), or we'd delete the new one.
    try {
        const existing = questionImages ? questionImages[index] : null;
        const newRel = `assets/${file.name}`;
        if (existing && existing.relPath && existing.relPath !== newRel) {
            if (!window.deletedPresetAssetRelPaths) window.deletedPresetAssetRelPaths = [];
            window.deletedPresetAssetRelPaths.push(existing.relPath);
        }
    } catch(e) {}
    // Clear any pending deletion entries for the same destination name
    try {
        if (window.deletedPresetAssetRelPaths && Array.isArray(window.deletedPresetAssetRelPaths)) {
            const rel = `assets/${file.name}`;
            window.deletedPresetAssetRelPaths = window.deletedPresetAssetRelPaths.filter(p => p !== rel);
        }
    } catch(e) {}
    questionImages[index] = { name: file.name, path: file.path, relPath: '', fromPreset: false };
    const preview = document.getElementById(`image-preview-${index}`);
    const overlay = document.getElementById(`image-overlay-${index}`);
    const box = document.getElementById(`image-box-${index}`);
    const reader = new FileReader();
    reader.onload = (e) => {
        if(preview) { preview.src = e.target.result; preview.classList.remove('hidden'); }
        if(overlay) { overlay.classList.add('bg-slate-900/50'); overlay.innerHTML = `<span class="text-[10px] text-blue-400 truncate w-full px-1">${file.name}</span>`; }
        if(box) { box.classList.add('has-image'); }
    };
    reader.readAsDataURL(file);
    event.target.value = null; 
}

// Delete question thumbnail (UI) + schedule asset file removal on Save Changes
// Additive only.
function deleteQuestionImage(index, ev) {
    try {
        if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
        const existing = questionImages ? questionImages[index] : null;
        if (!existing) return;

        // Use the same in-panel confirmation modal used for grid deletes (more professional than AE confirm)
        // Additive only.
        openDeleteConfirmModal(
            'Delete Image?',
            'Do you want to delete this image?',
            function onConfirm(){
                try {
                    // Track preset asset for deletion if it came from preset assets
                    try {
                        if (existing && existing.relPath) {
                            if (!window.deletedPresetAssetRelPaths) window.deletedPresetAssetRelPaths = [];
                            window.deletedPresetAssetRelPaths.push(existing.relPath);
                        }
                    } catch(e) {}

                    // Clear UI + state
                    try { delete questionImages[index]; } catch(e) { questionImages[index] = null; }
                    const preview = document.getElementById(`image-preview-${index}`);
                    const overlay = document.getElementById(`image-overlay-${index}`);
                    const box = document.getElementById(`image-box-${index}`);
                    if (preview) { preview.src = ""; preview.classList.add('hidden'); }
                    if (overlay) { overlay.classList.remove('bg-slate-900/50'); overlay.innerHTML = `<span class="text-xs font-semibold">Choose Image</span>`; }
                    if (box) { box.classList.remove('has-image'); }
                    showToast('Image deleted');
                } catch(err2) {
                    try { showToast('Delete failed'); } catch(x) {}
                }
            }
        );
    } catch (err) {
        try { showToast('Delete failed'); } catch(x) {}
    }
}

// Reusable confirmation modal helper (same modal used for preset/grid delete)
// Additive only.
function openDeleteConfirmModal(title, message, onConfirm) {
    try {
        const modal = document.getElementById('delete-confirm-modal');
        const t = document.getElementById('delete-modal-title');
        const msg = document.getElementById('delete-modal-message');
        const confirmBtn = document.getElementById('delete-modal-confirm-btn');
        if (!modal || !confirmBtn) {
            // Fallback (should not happen)
            try { if (confirm(message || 'Delete?')) { if (typeof onConfirm === 'function') onConfirm(); } } catch(x) {}
            return;
        }
        if (t) t.textContent = title || 'Delete?';
        if (msg) msg.textContent = message || '';
        confirmBtn.onclick = function(){
            try { closeDeleteModal(); } catch(e) { try { modal.classList.add('hidden'); } catch(x) {} }
            try { if (typeof onConfirm === 'function') onConfirm(); } catch(e2) {}
        };
        modal.classList.remove('hidden');
    } catch (e) {
        try { if (confirm(message || 'Delete?')) { if (typeof onConfirm === 'function') onConfirm(); } } catch(x) {}
    }
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

async function loadGridsFromDisk(deletedGridId) {
    try {
        if(!baseDirPath) return;
        const res = await evalScriptPromise("$._ext.getGridFiles()");
        availableGrids = (res && !res.startsWith("ERROR")) ? JSON.parse(res) : [];
    } catch(e) { availableGrids = []; }
    if(typeof generateGridButtons === 'function') generateGridButtons();
    if (availableGrids.length > 0) {
        const stillExists = !!activeGrid && !!availableGrids.find(g => g.id === activeGrid);
        if (stillExists) {
            drawGrid(activeGrid);
            return;
        }

        // If active grid no longer exists (common after delete), pick the "previous" grid.
        // Requirement: If user deletes button 7, active should become 6 (or nearest previous).
        // If nothing previous exists, fall back to the first available.
        const sorted = availableGrids.slice().sort((a,b) => (a.id||0) - (b.id||0));
        let nextActive = sorted[0].id;
        const delId = Number(deletedGridId);
        if (!isNaN(delId)) {
            const prev = sorted.filter(g => Number(g.id) < delId).pop();
            if (prev && prev.id !== undefined && prev.id !== null) nextActive = prev.id;
        }
        activeGrid = nextActive;
        drawGrid(nextActive);
    } else {
        const cg = document.getElementById('current-grid');
        if(cg) cg.innerHTML = '<span class="text-gray-500 text-sm">No grids found.</span>';
    }
}

function drawGrid(gridId) {
    activeGrid = gridId;
    document.querySelectorAll('#grid-buttons button').forEach(btn => {
        if(btn.innerText === "+") return;
        // Active state should be very dark (near black-blue) while keeping hover styling unchanged.
        btn.classList.toggle('grid-btn-active', btn.id === `grid-btn-${gridId}`);
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
                    await loadGridsFromDisk(id);
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
                try { await evalScriptPromise(`$._ext.genGridNum("${escapeForJSX(JSON.stringify(savedSettings))}")`); } catch (e) {}
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
        ['set-comp-maincomp','compMainComp'],
        ['set-comp-main',   'compMain'],
        ['set-comp-qa',     'compQa'],
        ['set-comp-grid',   'compGrid'],
        ['set-comp-answers','compAnswers'],
        ['set-comp-cc','compCC'], ['set-comp-keypad','compKeypad'], ['set-comp-clue','compClue'], ['set-comp-question','compQuestion'], ['set-comp-endshot','compEndshot'], ['set-comp-image','compImage'],

        // Layer names
        ['set-layer-ctrl',       'layerCtrl'],
        ['set-layer-adv-ctrl',   'advLayerCtrl'],
        ['set-layer-q',          'layerQ'],
        ['set-layer-a',          'layerA'],
        ['set-layer-tile',       'layerTile'],
        ['set-layer-parent',     'layerParent'],
        ['set-layer-ans-lmt','layerAnsLmt'], ['set-layer-tap-sfx','layerTapSfx'],

        // Effect / property names
        ['set-fx-num',     'fxNum'],
        ['set-fx-row',     'fxRow'],
        ['set-fx-col',     'fxCol'],
        ['set-fx-rot',     'fxRot'],
        ['set-fx-letter',  'fxLetter'],
        ['set-af-base','afBaseFrames'], ['set-af-per-letter','afPerLetterFrames'], ['set-letter-gap','letterGapFrames'],
        ['set-fq-f1','fqFramesF1'], ['set-fq-f2','fqFramesF2'], ['set-fq-other','fqFramesOther'],
        ['set-limit-30','limit30sTo'], ['set-limit-60','limit60sTo'],
        ['set-marker-yellow','markerLabelYellow'], ['set-marker-aqua','markerLabelAqua'],
        ['set-solvea3-index','solveA3ImageIndexFromBottom'], ['set-solvea3-o-offset','solveA3OOffsetFrames'], ['set-solvea3-endshot','solveA3EndshotFromC3Frames']
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
        ccExtraImages: (ccExtraImages || []).map(it => it && it.path ? it.path : '').filter(Boolean),
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
                            const novaCfg = escapeForJSX(JSON.stringify(savedSettings));
                            const cmd2 = `$._ext.adjustMarkerKeypad(${preserve}, ${is60}, ${solveA3}, "${novaCfg}")`;
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


