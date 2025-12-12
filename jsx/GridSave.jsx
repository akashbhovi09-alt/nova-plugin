// js/GridSave.js

const GridManager = {
    currentGrids: [],
    activeGridId: null,

    // --- INIT ---
    init: async function() {
        // Initial load
        await this.refreshGridList();
    },

    // --- DATA FETCHING ---
    refreshGridList: async function() {
        try {
            const result = await evalScriptPromise("$._ext.getGridIndex()");
            if (result && !result.startsWith("ERROR") && result !== "[]") {
                this.currentGrids = JSON.parse(result);
            } else {
                this.currentGrids = [];
            }
            
            // Sort grids by ID
            this.currentGrids.sort((a, b) => a.id - b.id);

            this.renderButtons();

            // If we have an active grid, re-draw it, otherwise clear or pick first
            if (this.activeGridId) {
                const stillExists = this.currentGrids.find(g => g.id === this.activeGridId);
                if (stillExists) this.drawGridPreview(this.activeGridId);
                else {
                    this.activeGridId = null;
                    this.clearPreview();
                }
            }
        } catch (e) {
            console.error("Grid load error:", e);
        }
    },

    // --- RENDER BUTTONS ---
    renderButtons: function() {
        const container = document.getElementById('grid-buttons');
        if (!container) return;

        let html = '';
        
        // Render existing grids
        this.currentGrids.forEach(g => {
            const isActive = (this.activeGridId === g.id);
            const bgClass = isActive ? 'bg-blue-600' : 'bg-blue-500';
            html += `<button onclick="GridManager.selectGrid(${g.id})" class="${bgClass} text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-blue-600 transition">${g.id}</button>`;
        });

        // The '+' Button
        html += `<button onclick="GridManager.openSaveModal()" class="text-blue-500 font-bold py-2 px-4 text-xl rounded-lg hover:text-blue-400 transition">+</button>`;

        container.innerHTML = html;
    },

    // --- SELECTION & PREVIEW ---
    selectGrid: function(id) {
        this.activeGridId = id;
        this.renderButtons(); // Update active state colors
        this.drawGridPreview(id);
    },

    drawGridPreview: function(id) {
        const container = document.getElementById('current-grid');
        const grid = this.currentGrids.find(g => g.id === id);

        if (!grid || !baseDirPath) {
            this.clearPreview();
            return;
        }

        // Clean path for file:// URL
        const root = baseDirPath.replace(/\\/g, '/');
        const cleanRoot = root.startsWith('/') ? root : '/' + root;
        const fullPath = `file://${cleanRoot}/DTC_Grids/${grid.fileName}`; // Cache busting optional

        // HTML with Image and Delete Button
        container.innerHTML = `
            <div class="relative w-full h-full group">
                <img src="${fullPath}" class="w-full h-full object-contain rounded-md" onerror="this.src=''; this.alt='Image not found'">
                
                <button onclick="GridManager.confirmDelete(${id})" 
                    class="absolute top-1 right-1 bg-red-600 hover:bg-red-700 text-white rounded-full p-1 shadow-lg opacity-0 group-hover:opacity-100 transition duration-200"
                    title="Delete Grid">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        `;
        
        // Remove 'grid' class to allow image to fill
        container.classList.remove('crossword-grid', 'grid');
        container.classList.add('flex', 'items-center', 'justify-center');
    },

    clearPreview: function() {
        const container = document.getElementById('current-grid');
        container.innerHTML = '<span class="text-gray-500 text-xs">No Grid Selected</span>';
        container.classList.add('crossword-grid', 'grid'); // Revert styles if needed
    },

    // --- SAVE LOGIC ---
    openSaveModal: function() {
        if (!baseDirPath) return alert("Please pick a Presets Folder first.");
        document.getElementById('save-grid-modal').classList.remove('hidden');
    },

    saveFromComp: async function() {
        // Close modal first
        document.getElementById('save-grid-modal').classList.add('hidden');

        try {
            const resStr = await evalScriptPromise("$._ext.saveGridSnapshot()");
            const res = JSON.parse(resStr);

            if (res.status === "error") {
                alert("Error: " + res.message);
            } else {
                // Success
                await this.refreshGridList();
                // Select the new grid
                this.selectGrid(res.id);
                // Reset scroll/view if needed
            }
        } catch (e) {
            alert("Script Error: " + e);
        }
    },

    // --- DELETE LOGIC ---
    confirmDelete: function(id) {
        // We can reuse the generic save-confirm-modal or use a standard confirm for simplicity
        // Per requirement: "confirmation dialogue box will appear with option 'cancel' and 'continue'"
        
        // Let's repurpose the existing 'save-confirm-modal' or create a simple JS confirm
        // For better UI, I will update the HTML to have a specific delete modal, 
        // OR dynamically inject text into the existing confirm modal. 
        // Let's use the standard `confirm` for safety or build a custom one if preferred.
        // Given the detailed UI code, a custom modal is better.
        
        // Using the existing #save-confirm-modal structure dynamically
        const modal = document.getElementById('save-confirm-modal');
        const title = modal.querySelector('h3');
        const msg = document.getElementById('save-confirm-message');
        const okBtn = modal.querySelector('button.bg-red-600');
        
        // Save original state to restore later if needed (simple approach)
        title.textContent = "Delete Grid?";
        msg.textContent = "Are you sure you want to delete Grid " + id + "? This cannot be undone.";
        
        // Clone button to remove old listeners
        const newBtn = okBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newBtn, okBtn);
        
        newBtn.onclick = async () => {
            await this.performDelete(id);
            closeSaveConfirmModal();
        };

        modal.classList.remove('hidden');
    },

    performDelete: async function(id) {
        try {
            const res = await evalScriptPromise(`$._ext.deleteGridItem(${id})`);
            if(res === "SUCCESS") {
                this.activeGridId = null; // Deselect
                await this.refreshGridList();
                this.clearPreview();
            } else {
                alert("Delete failed: " + res);
            }
        } catch(e) {
            alert("Delete error: " + e);
        }
    }
};

// Expose to window for HTML onclick events
window.GridManager = GridManager;