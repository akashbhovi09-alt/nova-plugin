/**
 * INTERACT.JS
 * Handling UI State, DOM Rendering, and Local Interactions.
 */

// --- Global UI State ---
const TABS = { LOTSO: 'lotso', CONTENTS: 'contents', SETTINGS: 'settings' };
const MAX_QUESTIONS = 6;
let activeTab = TABS.CONTENTS;
let activeGrid = null;
const panelStates = Array(MAX_QUESTIONS + 1).fill(false);
let isAutoFrenzy = false;
let is60SecVid = false;

// Persistence cache to prevent text disappearing on toggle
window.globalFrenzyCache = {}; 

// --- Settings Default & Saved State ---
const DEFAULT_SETTINGS = {
    isCustomNamesEnabled: false,
    f1a2: "3",
    f2a3: "2",
    f3a4: "2",
    f4a5: "2",
    f5a6: "2",
    minGap: "2",
    randSeed: "12345",
    replaceImage: true, // REQUIREMENT: REPLACE_IMAGE ticked by default
    preserveMarker: false,
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

let savedSettings = { ...DEFAULT_SETTINGS };

// --- GLOBAL FIXES ---
// Disable Context Menu (Right Click)
window.addEventListener('contextmenu', e => e.preventDefault());

// Close Dropdown when clicking elsewhere
window.addEventListener('click', (e) => {
    const dropdown = document.getElementById('preset-dropdown-menu');
    const container = document.getElementById('preset-dropdown-container');
    if (dropdown && !dropdown.classList.contains('hidden')) {
        if (!container.contains(e.target)) {
            togglePresetDropdown();
        }
    }
});

// --- UI UTILS ---
function slugify(s) { return (s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
function newId() { return Math.floor(Date.now() + Math.random()*1e6).toString(36); }
function nowISO() { return new Date().toISOString(); }
function parseLines(str){ return (str||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean); }
function toDisplayPath(path){ 
    if (!path) return '— Folder not selected —';
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts[parts.length - 1] ? '/' + parts[parts.length - 1] : path; 
}

// --- TAB LOGIC ---
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

// --- CONTENT MODE & CHECKBOXES ---
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

// --- PANEL RENDERING ---
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
    
    // Middle slot logic (Frenzy vs Solve A3)
    let middleSlotHTML = `
        <div id="middle-slot-container-${index}" class="flex flex-col justify-end">
            <label for="frenzies-${index}" class="block text-[10px] font-medium mb-0.5 text-gray-500 uppercase">Frenzies</label>
            <input type="text" id="frenzies-${index}" placeholder="Enter frenzies" class="frenzy-input w-full p-2 rounded-lg bg-slate-900 border border-gray-700 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-gray-500">
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
                        <label for="answer-${index}" class="block text-[10px] font-medium mb-0.5 text-gray-500 uppercase">Answer</label>
                        <input type="text" id="answer-${index}" placeholder="Enter answer" class="w-full p-2 rounded-lg bg-slate-900 border border-gray-700 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-gray-500">
                    </div>
                    
                    ${middleSlotHTML}

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
    
    // Sync current DOM values to global cache before manipulation
    for (let i = 1; i <= MAX_QUESTIONS; i++) {
        const input = document.getElementById(`frenzies-${i}`);
        if (input) window.globalFrenzyCache[i] = input.value;
    }

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

        // Handle Middle Slot Content (Frenzy vs Solve A3)
        const middleSlot = document.getElementById(`middle-slot-container-${i}`);
        if (middleSlot) {
            if (!is60SecVid && i === 3) {
                middleSlot.innerHTML = `
                    <div class="flex items-center h-full pt-4">
                        <label class="custom-checkbox text-xs text-gray-400">
                            <input type="checkbox" id="solve-a3">
                            <span class="box"></span>
                            Solve A3
                        </label>
                    </div>
                `;
            } else if (isVisible && showFrenzies) {
                middleSlot.innerHTML = `
                    <label for="frenzies-${i}" class="block text-[10px] font-medium mb-0.5 text-gray-500 uppercase">Frenzies</label>
                    <input type="text" id="frenzies-${i}" placeholder="Enter frenzies" class="frenzy-input w-full p-2 rounded-lg bg-slate-900 border border-gray-700 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-gray-500">
                `;
                
                // RESTORE CACHED VALUE from window.globalFrenzyCache
                const frenzyInput = document.getElementById(`frenzies-${i}`);
                if (frenzyInput) {
                    if (window.globalFrenzyCache[i] !== undefined) frenzyInput.value = window.globalFrenzyCache[i];
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

// --- GRID UI ---
function generateGridButtons() {
    const buttonsContainer = document.getElementById('grid-buttons');
    if (!buttonsContainer) return;

    let buttonsHtml = '';
    const grids = (typeof availableGrids !== 'undefined') ? availableGrids : [];

    grids.forEach(grid => {
        const id = grid.id;
        const isActive = (id === activeGrid);
        const colorClass = isActive ? 'bg-blue-600' : 'bg-blue-500';
        buttonsHtml += `<button id="grid-btn-${id}" onclick="drawGrid(${id})" class="${colorClass} text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-blue-600 transition">${id}</button>`;
    });

    // Plus Button (Opens Modal)
    buttonsHtml += `<button onclick="openModal()" class="text-blue-500 font-bold py-2 px-4 text-xl rounded-lg hover:text-blue-400 transition">+</button>`;
    
    buttonsContainer.innerHTML = buttonsHtml;
}

function openModal() { document.getElementById('save-grid-modal').classList.remove('hidden'); }
function closeModal() { document.getElementById('save-grid-modal').classList.add('hidden'); }

// --- PRESET DROPDOWN UI ---
function togglePresetDropdown() {
    const d = document.getElementById('preset-dropdown-menu');
    if(!d) return;
    const isHidden = d.classList.contains('hidden');
    if (isHidden) {
        d.classList.remove('hidden');
        setTimeout(() => {
            d.classList.remove('opacity-0', 'translate-y-2');
        }, 10);
    } else {
        d.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => {
            d.classList.add('hidden');
        }, 200);
    }
}

function openNewPresetModal() {
    if(typeof baseDirPath !== 'undefined' && !baseDirPath) return alert("Select Folder First");
    togglePresetDropdown();
    const modal = document.getElementById('new-preset-modal');
    if(modal) {
        modal.classList.remove('hidden');
        const input = document.getElementById('new-preset-input');
        if(input) { input.value = ''; input.focus(); }
    }
}

function closeNewPresetModal() { document.getElementById('new-preset-modal').classList.add('hidden'); }

function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    document.getElementById('toggle-edit-names').checked = savedSettings.isCustomNamesEnabled;
    const fields = [
        ['set-f1-a2', 'f1a2'], ['set-f2-a3', 'f2a3'], ['set-f3-a4', 'f3a4'], ['set-f4-a5', 'f4a5'], ['set-f5-a6', 'f5a6'],
        ['set-min-gap', 'minGap'], ['set-rand-seed', 'randSeed'],
        ['set-chk-replace', 'replaceImage'], ['set-chk-preserve', 'preserveMarker'],
        ['set-comp-main', 'compMain'], ['set-comp-qa', 'compQa'], ['set-comp-grid', 'compGrid'], ['set-comp-answers', 'compAnswers'],
        ['set-layer-ctrl', 'layerCtrl'], ['set-layer-q', 'layerQ'], ['set-layer-a', 'layerA'], ['set-layer-tile', 'layerTile'],
        ['set-fx-num', 'fxNum'], ['set-fx-row', 'fxRow'], ['set-fx-col', 'fxCol'], ['set-fx-rot', 'fxRot'], ['set-fx-letter', 'fxLetter']
    ];
    fields.forEach(([elId, key]) => {
        const el = document.getElementById(elId);
        if (el) {
            if(el.type === 'checkbox') el.checked = savedSettings[key];
            else el.value = savedSettings[key];
        }
    });
    toggleSettingsInputs();
    modal.classList.remove('hidden');
}

function closeSettingsModal() { document.getElementById('settings-modal').classList.add('hidden'); }

function toggleSettingsInputs() {
    const isChecked = document.getElementById('toggle-edit-names').checked;
    document.querySelectorAll('.settings-input').forEach(input => { input.disabled = !isChecked; });
    
    if (!isChecked) {
        document.getElementById('set-f1-a2').value = DEFAULT_SETTINGS.f1a2;
        document.getElementById('set-f2-a3').value = DEFAULT_SETTINGS.f2a3;
        document.getElementById('set-f3-a4').value = DEFAULT_SETTINGS.f3a4;
        document.getElementById('set-f4-a5').value = DEFAULT_SETTINGS.f4a5;
        document.getElementById('set-f5-a6').value = DEFAULT_SETTINGS.f5a6;
        document.getElementById('set-min-gap').value = DEFAULT_SETTINGS.minGap;
        document.getElementById('set-rand-seed').value = DEFAULT_SETTINGS.randSeed;
        document.getElementById('set-chk-replace').checked = DEFAULT_SETTINGS.replaceImage;
        document.getElementById('set-chk-preserve').checked = DEFAULT_SETTINGS.preserveMarker;

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
}