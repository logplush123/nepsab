const workerCode = `
    let allData = [];

    self.onmessage = function(e) {
        const { type, payload } = e.data;
        
        if (type === 'SET_DATA') {
            allData = payload;
            self.postMessage({ type: 'READY' });
        }

        if (type === 'SEARCH') {
            const query = payload.trim().toLowerCase();
            if (!query) {
                self.postMessage({ type: 'SEARCH_RESULTS', results: allData, exactWords: [] });
                return;
            }

            const exact = [];
            const starts = [];
            const contains = [];
            const inDef = [];

            // Single pass through the data for maximum efficiency
            for (let i = 0; i < allData.length; i++) {
                const item = allData[i];
                const word = item.word.toLowerCase();
                
                if (word === query) {
                    exact.push(item);
                } else if (word.startsWith(query)) {
                    starts.push(item);
                } else if (word.includes(query)) {
                    contains.push(item);
                } else {
                    // Optimized check: only search definitions if not found in word
                    // Using stringified version for rapid 'includes' check across all senses
                    const defs = JSON.stringify(item.definitions).toLowerCase();
                    if (defs.includes(query)) {
                        inDef.push(item);
                    }
                }
            }
            
            self.postMessage({ 
                type: 'SEARCH_RESULTS', 
                results: [...exact, ...starts, ...contains, ...inDef],
                exactWords: exact.map(e => e.word)
            });
        }
    };
`;

class SmartSabdkosh {
    constructor() {
        this.allData = [];
        this.filteredData = [];
        this.exactWords = [];
        this.itemH = 80;
        this.buffer = 10;
        this.letterIndexes = {};
        this.currentSearch = '';

        this.elements = {
            viewport: document.getElementById('scrollViewport'),
            spacer: document.getElementById('scrollSpacer'),
            container: document.getElementById('visibleItems'),
            searchInput: document.getElementById('searchInput'),
            searchInfo: document.getElementById('searchInfo'),
            resultCount: document.getElementById('resultCount'),
            clearSearch: document.getElementById('clearSearch'),
            loadingSpinner: document.getElementById('loadingSpinner'),
            emptyState: document.getElementById('emptyState'),
            alphaBar: document.getElementById('alphaBar')
        };

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.worker = new Worker(URL.createObjectURL(blob));
        
        this.modal = new bootstrap.Modal(document.getElementById('wordModal'));
        this.init();
    }

    async init() {
        try {

            const response = await fetch('data/nepalisabdkosh.json');
            if (!response.ok) throw new Error('Network response was not ok');

            const reader = response.body.getReader();
            let chunks = [];
            let receivedLength = 0;

            while(true) {
                const {done, value} = await reader.read();
                if (done) break;
                chunks.push(value);
                receivedLength += value.length;
            }

            // Combine chunks into a single Uint8Array
            let combined = new Uint8Array(receivedLength);
            let position = 0;
            for(let chunk of chunks) {
                combined.set(chunk, position);
                position += chunk.length;
            }
            chunks = null; // Clear chunks for GC

            const text = new TextDecoder("utf-8").decode(combined);
            const data = JSON.parse(text);
            combined = null; // Clear combined for GC

            // Sort and freeze to prevent unnecessary proxy overhead in large arrays
            this.allData = Object.freeze(data.sort((a, b) => a.word.localeCompare(b.word, 'ne')));
            this.filteredData = this.allData;

            this.mapLetters();
            this.renderAlphaBar();
            this.setupWorker();
            this.setupListeners();
            
            this.elements.loadingSpinner.style.display = 'none';
            this.elements.searchInput.disabled = false;
            this.elements.searchInput.focus();
            this.refresh();
        } catch (e) {
            console.error("Critical Load Error:", e);
            this.elements.container.innerHTML = `<div class="p-4 text-center text-danger">Couldn't Found Data </div>`;
        }
    }

    setupWorker() {
        this.worker.postMessage({ type: 'SET_DATA', payload: this.allData });
        this.worker.onmessage = (e) => {
            if (e.data.type === 'SEARCH_RESULTS') {
                this.filteredData = e.data.results;
                this.exactWords = e.data.exactWords;
                this.updateUIAfterSearch();
            }
        };
    }

    mapLetters() {
        this.letterIndexes = {};
        for (let i = 0; i < this.allData.length; i++) {
            const firstChar = this.allData[i].word[0];
            if (!(firstChar in this.letterIndexes)) {
                this.letterIndexes[firstChar] = i;
            }
        }
    }

    renderAlphaBar() {
        const letters = Object.keys(this.letterIndexes).sort();
        this.elements.alphaBar.innerHTML = letters.map(char => 
            `<div class="alpha-btn" onclick="window.app.jumpTo('${char}')">${char}</div>`
        ).join('');
    }

    jumpTo(char) {
        if (this.currentSearch) {
            this.elements.searchInput.value = '';
            this.currentSearch = '';
            this.performSearch('');
        }
        const index = this.letterIndexes[char];
        if (index !== undefined) {
            this.elements.viewport.scrollTop = index * this.itemH;
        }
    }

    setupListeners() {
        this.elements.viewport.addEventListener('scroll', () => this.refresh());
        
        let debounceTimer;
        this.elements.searchInput.addEventListener('input', (e) => {
            const query = e.target.value;
            this.currentSearch = query;
            
            this.elements.clearSearch.classList.toggle('d-none', !query);
            this.elements.searchInfo.classList.toggle('d-none', !query);

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => this.performSearch(query), 250);
        });

        this.elements.clearSearch.onclick = () => {
            this.elements.searchInput.value = '';
            this.currentSearch = '';
            this.performSearch('');
            this.elements.searchInput.focus();
        };
    }

    performSearch(query) {
        this.worker.postMessage({ type: 'SEARCH', payload: query });
    }

    updateUIAfterSearch() {
        this.elements.resultCount.textContent = this.filteredData.length.toLocaleString();
        this.elements.emptyState.classList.toggle('d-none', this.filteredData.length > 0);
        this.elements.viewport.scrollTop = 0;
        this.refresh();
    }

    refresh() {
        const count = this.filteredData.length;
        this.elements.spacer.style.height = (count * this.itemH) + "px";

        const scrollTop = this.elements.viewport.scrollTop;
        const start = Math.max(0, Math.floor(scrollTop / this.itemH) - this.buffer);
        const end = Math.min(count, Math.ceil((scrollTop + this.elements.viewport.clientHeight) / this.itemH) + this.buffer);

        const visibleChunk = this.filteredData.slice(start, end);
        this.elements.container.style.transform = `translateY(${start * this.itemH}px)`;

        this.elements.container.innerHTML = visibleChunk.map(item => {
            const isExact = this.exactWords.includes(item.word);
            return `
                <div class="list-item ${isExact ? 'exact-match' : ''}" onclick="window.app.openWord('${item.word.replace(/'/g, "\\'")}')">
                    <div class="word-text">${this.highlightText(item.word, this.currentSearch)}</div>
                    <div class="word-preview">${item.definitions[0]?.senses[0] || ''}</div>
                </div>
            `;
        }).join('');

        this.updateAlphaHighlight();
    }

    updateAlphaHighlight() {
        if (this.currentSearch) return;
        const idx = Math.floor(this.elements.viewport.scrollTop / this.itemH);
        const item = this.filteredData[idx];
        if (item) {
            const char = item.word[0];
            document.querySelectorAll('.alpha-btn').forEach(btn => {
                btn.classList.toggle('active', btn.textContent === char);
            });
        }
    }

    highlightText(text, search) {
        if (!search) return text;
        const regex = new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<span class="highlight">$1</span>');
    }

    openWord(wordName) {
        const item = this.allData.find(w => w.word === wordName);
        if (!item) return;

        document.getElementById('modalTitle').textContent = item.word;
        document.getElementById('modalBody').innerHTML = item.definitions.map(def => `
            <div class="def-box mb-3 p-2 border-bottom">
                <span class="badge bg-light text-primary mb-2">${def.grammar || 'शब्द'}</span>
                <div class="senses">
                    ${def.senses.map(sense => `<div class="mb-1 small">• ${sense}</div>`).join('')}
                </div>
            </div>
        `).join('');

        this.modal.show();
    }
}

// Initialize and globalize
window.app = new SmartSabdkosh();