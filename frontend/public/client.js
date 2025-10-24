// État global du jeu
(function initializeGameState() {
    window.state = {
        user: JSON.parse(localStorage.getItem('user') || 'null'),
        currentTable: null,
        gameState: null,
        socket: null
    };
})();

// Base URL for backend API/socket. Keep as a single constant so it's easy to change.
const API_BASE = (window && window.location && window.location.hostname ? `${window.location.protocol}//${window.location.hostname}:5000` : 'http://localhost:5000');

// Récupère token/username pour la handshake auth
function getHandshakeAuth() {
    const token = localStorage.getItem('token') || '';
    const usernameField = document.getElementById('username');
    const initialUsername = usernameField && usernameField.value.trim() ? usernameField.value.trim() : (state.user && state.user.username ? state.user.username : '');
    return { token, username: initialUsername };
}

function initSocket() {
    console.log('Initialisation socket...');
    
    // si déjà connecté, ne pas reconnecter
    if (window.gameSocket && window.gameSocket.connected) {
        console.log('Socket déjà connecté, réutilisation');
        return;
    }

    const auth = getHandshakeAuth();
    console.log('Tentative de connexion avec auth:', auth);
    
    // connect to backend socket (server listens on port 5000)
    window.gameSocket = io(API_BASE, { 
        auth,
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5
    });
    state.socket = window.gameSocket;

    state.socket.on('connect', () => {
        // Ensure we have a local user record for guests so the UI can
        // identify the current player and show private cards.
        if (!state.user || !state.user.id) {
            const auth = getHandshakeAuth();
            state.user = {
                id: state.socket.id,
                username: auth.username && auth.username.length ? auth.username : `Guest_${state.socket.id.slice(0,5)}`,
                chips: 1000,
                isGuest: true
            };
            try { localStorage.setItem('user', JSON.stringify(state.user)); } catch (e) { /* ignore */ }
        }
        // If we have a persisted user from the server (registered user),
        // ensure we keep the canonical id under `id` for easier comparisons.
        if (state.user && state.user._id && !state.user.id) {
            state.user.id = state.user._id;
            try { localStorage.setItem('user', JSON.stringify(state.user)); } catch (e) { /* ignore */ }
        }

        console.log('✅ Connecté au serveur (socket id:', state.socket.id + ')', 'user:', state.user);
    });

    // Ack from server that an action was processed
    state.socket.on('actionAck', (ack) => {
        console.log('actionAck reçu du serveur:', ack);
        if (state.lastActionTimeout) {
            clearTimeout(state.lastActionTimeout);
            state.lastActionTimeout = null;
        }
        // Réactiver boutons (server processed)
        document.getElementById('foldBtn').disabled = false;
        const cb = document.getElementById('checkBtn'); if (cb) cb.disabled = false;
        document.getElementById('callBtn').disabled = false;
        document.getElementById('raiseBtn').disabled = false;
    });

    state.socket.on('disconnect', (reason) => {
        console.log('🔌 Déconnecté du serveur, raison:', reason);
        
        // Désactiver les boutons pendant la déconnexion
        document.getElementById('foldBtn').disabled = true;
    const cb = document.getElementById('checkBtn'); if (cb) cb.disabled = true;
        document.getElementById('callBtn').disabled = true;
        document.getElementById('raiseBtn').disabled = true;
        
        // Si la déconnexion n'est pas volontaire, on tente de se reconnecter
        if (reason === 'io server disconnect' || reason === 'transport close') {
            console.log('Tentative de reconnexion automatique...');
            setTimeout(() => {
                if (!state.socket.connected) {
                    console.log('Reconnexion après timeout...');
                    state.socket.connect();
                }
            }, 1000);
        }
    });
    
    state.socket.on('connect_error', (error) => {
        console.log('Erreur de connexion:', error);
    });

    // Handle server-side errors sent via socket
    state.socket.on('serverError', (err) => {
        console.warn('serverError reçu:', err);
        const msg = err && err.message ? err.message : 'Erreur serveur';
        const errEl = document.getElementById('login-error');
        if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }

        // Re-enable action buttons if they were disabled
        try {
            const foldBtn = document.getElementById('foldBtn'); if (foldBtn) foldBtn.disabled = false;
            const checkBtn = document.getElementById('checkBtn'); if (checkBtn) checkBtn.disabled = false;
            const callBtn = document.getElementById('callBtn'); if (callBtn) callBtn.disabled = false;
            const raiseBtn = document.getElementById('raiseBtn'); if (raiseBtn) raiseBtn.disabled = false;
        } catch (e) {}
    });
    
    state.socket.on('reconnect', (attemptNumber) => {
        console.log('Reconnecté au serveur après', attemptNumber, 'tentatives');
        
        // Si on était dans une partie, on demande l'état actuel
        if (state.currentTable) {
            console.log('Demande de l\'état de la table après reconnexion');
            state.socket.emit('getTableState', { tableId: state.currentTable });
        }
        
        // Réactiver les boutons
        document.getElementById('foldBtn').disabled = false;
        const cb = document.getElementById('checkBtn'); if (cb) cb.disabled = false;
        document.getElementById('callBtn').disabled = false;
        document.getElementById('raiseBtn').disabled = false;
    });

    state.socket.on('tableCreated', (data) => {
        console.log('Table créée', data);
        // rafraîchir le lobby
        updateTables();
        // si on est le créateur, rejoindre automatiquement
        if (data.tableId) handleJoinTable(data.tableId);
    });

    state.socket.on('playerJoined', (data) => {
        console.log('playerJoined', data);
        updateTables();
    });

    state.socket.on('gameState', (gs) => {
        // Sanitize public state: remove any hands accidentally present for other players
        try {
            const localIds = [state.user?.id, state.user?._id, state.socket?.id];
            if (gs && Array.isArray(gs.players)) {
                gs.players.forEach(p => {
                    const isLocal = localIds.some(x => x && String(x) === String(p.id)) || p.username === state.user?.username;
                    if (!isLocal && p.hand) delete p.hand;
                });
            }
        } catch (e) { /* ignore sanitization errors */ }

        updateGameState(gs);
    });

    // Receive private hand for this socket only
    state.socket.on('privateHand', ({ tableId, hand }) => {
        if (!state.gameState || state.currentTable !== tableId) return;
        // find the player entry for the local user and set its hand
        const player = state.gameState.players.find(p => {
            const localIds = [state.user?.id, state.user?._id, state.socket?.id];
            return localIds.some(x => x && String(x) === String(p.id));
        });
        if (player) {
            player.hand = hand;
            updatePlayers(state.gameState.players);
            // small reveal animation for the local player's cards
            setTimeout(() => {
                const container = document.querySelector('.player.pos-' + player.position + ' .player-cards');
                if (container) {
                    container.classList.add('reveal');
                    setTimeout(() => container.classList.remove('reveal'), 900);
                }
            }, 50);
        }
    });

    // When server wants to reveal all hands (end of hand)
    state.socket.on('revealHands', ({ tableState, reveal }) => {
        if (!state.currentTable || state.currentTable !== tableState.id) return;
        // merge public state then temporarily attach hands for display
        state.gameState = tableState;
        if (reveal && tableState.players) {
            // temporarily request server to send hands — server emits reveal data via gameState
            // For now, server will embed hands when emitting reveal; we merge if provided
            if (tableState.players.forEach) {
                // if hands present, use them
                tableState.players.forEach(p => {
                    if (p.hand) {
                        const player = state.gameState.players.find(x => x.id === p.id);
                        if (player) player.hand = p.hand;
                    }
                });
            }
            updatePlayers(state.gameState.players);
            // hide again after 3s
            setTimeout(() => {
                // remove hands from all but local player
                state.gameState.players.forEach(p => { if (String(p.id) !== String(state.user?.id)) p.hand = undefined; });
                updatePlayers(state.gameState.players);
            }, 3000);
        }
    });

    state.socket.on('chatMessage', addChatMessage);
}

function reconnectSocket() {
    if (state.socket) {
        state.socket.disconnect();
        state.socket = null;
    }
    initSocket();
}

// Initialisation UI
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('loginBtn').addEventListener('click', handleLogin);
    document.getElementById('registerBtn').addEventListener('click', showRegisterModal);
    document.getElementById('submitRegisterBtn').addEventListener('click', handleRegister);
    document.getElementById('adminOpenBtn').addEventListener('click', () => window.open(window.location.origin + '/admin.html', '_blank'));
    document.getElementById('adminLoginBtn').addEventListener('click', handleAdminLogin);
    document.getElementById('adminLogoutBtn').addEventListener('click', () => {
        localStorage.removeItem('adminToken');
        document.getElementById('admin-panel').classList.add('hidden');
        document.getElementById('admin-login').classList.remove('hidden');
    });
    document.getElementById('createTableBtn').addEventListener('click', showCreateTableModal);
    document.getElementById('submitCreateTableBtn').addEventListener('click', handleCreateTable);
    document.getElementById('leaveTableBtn').addEventListener('click', handleLeaveTable);
    document.getElementById('sendMessageBtn').addEventListener('click', handleSendMessage);
    document.getElementById('chat-message').addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSendMessage(); });

    // Boutons d'action de jeu
    document.getElementById('foldBtn').addEventListener('click', () => handleGameAction('fold'));
    document.getElementById('checkBtn').addEventListener('click', () => handleGameAction('check'));
    document.getElementById('callBtn').addEventListener('click', () => handleGameAction('call'));
    document.getElementById('raiseBtn').addEventListener('click', () => {
        const amount = parseInt(document.getElementById('betSlider').value);
        handleGameAction('raise', amount);
    });
    
    // Mise à jour du montant affiché quand le slider change
    document.getElementById('betSlider').addEventListener('input', (e) => {
        document.getElementById('betAmount').textContent = e.target.value;
    });
    
    // Ajouter les gestionnaires pour fermer les modals
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal').classList.add('hidden');
        });
    });

    // connect as guest initially
    initSocket();
});

// Admin functions
async function handleAdminLogin() {
    const username = document.getElementById('admin-username').value;
    const password = document.getElementById('admin-password').value;
    try {
        const res = await fetch(API_BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Erreur admin');
            return;
        }
        localStorage.setItem('adminToken', data.token);
        document.getElementById('admin-login').classList.add('hidden');
        document.getElementById('admin-panel').classList.remove('hidden');
        await loadAdminUsers();
    } catch (err) { console.error(err); alert('Erreur admin'); }
}

async function loadAdminUsers() {
    const token = localStorage.getItem('adminToken');
    if (!token) return;
    try {
        const res = await fetch(API_BASE + '/api/admin/users', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) {
            const d = await res.json(); alert(d.error || 'Erreur'); return;
        }
        const data = await res.json();
        const list = document.getElementById('admin-users-list');
        list.innerHTML = (data.users || []).map(u => `
            <div class="admin-user-row">${u.username} (${u.email || 'n/a'}) <button data-id="${u.id || u._id}" class="btn btn-danger admin-delete">Supprimer</button></div>
        `).join('');
        list.querySelectorAll('.admin-delete').forEach(btn => btn.addEventListener('click', async (e) => {
            const id = e.target.getAttribute('data-id');
            if (!confirm('Supprimer cet utilisateur ?')) return;
            const res = await fetch(API_BASE + '/api/admin/users/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
            if (!res.ok) { const d = await res.json(); alert(d.error || 'Erreur suppression'); return; }
            await loadAdminUsers();
        }));
    } catch (err) { console.error(err); alert('Impossible de charger la liste'); }
}

// Prefill username field from localStorage if present
document.addEventListener('DOMContentLoaded', () => {
    const storedUser = JSON.parse(localStorage.getItem('user') || 'null');
    const usernameField = document.getElementById('username');
    if (storedUser && storedUser.username && usernameField) {
        usernameField.value = storedUser.username;
    }
});

// Authentification
async function handleLogin() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    try {
        const res = await fetch(API_BASE + '/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) {
            // Show error on page
            const errEl = document.getElementById('login-error');
            if (errEl) { errEl.textContent = data.error || 'Erreur de connexion'; errEl.style.display = 'block'; }
            return;
        }
        state.user = data.user;
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        reconnectSocket();
        showLobby();
    } catch (err) {
        console.error(err); alert('Erreur connexion');
    }
}

async function handleRegister() {
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    try {
    const res = await fetch(API_BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email, password }) });
        const data = await res.json();
        if (!res.ok) {
            const errEl = document.getElementById('login-error');
            if (errEl) { errEl.textContent = data.error || 'Erreur inscription'; errEl.style.display = 'block'; }
            return;
        }
        alert('Compte créé'); hideModal('register-modal');
    } catch (err) { console.error(err); alert('Erreur inscription'); }
}

// Tables
function handleCreateTable() {
    if (!state.socket) {
        console.error('Socket non connecté');
        alert('Erreur de connexion au serveur. Veuillez recharger la page.');
        return;
    }

    const tableName = document.getElementById('table-name').value || 'Table';
    const tableSize = parseInt(document.getElementById('table-size').value || '2');
    const smallBlind = parseInt(document.getElementById('small-blind').value || '10');
    const bigBlind = parseInt(document.getElementById('big-blind').value || '20');
    
    console.log('Création de table :', { 
        name: tableName, 
        maxPlayers: tableSize, 
        smallBlind, 
        bigBlind,
        socketId: state.socket.id,
        user: state.user
    });
    
    state.socket.emit('createTable', { name: tableName, maxPlayers: tableSize, smallBlind, bigBlind });
    document.getElementById('create-table-modal').classList.add('hidden');
}

function handleJoinTable(tableId) {
    state.currentTable = tableId;
    state.socket.emit('joinTable', { tableId });
    showGameSection();
}

function handleLeaveTable() {
    if (state.currentTable) state.socket.emit('leaveTable', { tableId: state.currentTable });
    state.currentTable = null; showLobby();
}

// Game actions
function updateGameState(gameState) {
    if (!gameState) {
        console.error('État de jeu invalide reçu');
        return;
    }

    state.gameState = gameState;
    document.getElementById('pot').textContent = `Pot: ${gameState.pot}`;
    updateCommunityCards(gameState.community || []);
    updatePlayers(gameState.players || []);
    
    // Log détaillé de l'état du jeu
    console.log('État du jeu mis à jour:', {
        pot: gameState.pot,
        currentPlayer: gameState.currentPlayer,
        players: gameState.players.map(p => ({
            id: p.id,
            username: p.username,
            position: p.position,
            chips: p.chips,
            bet: p.bet,
            folded: p.folded
        })),
        localPlayer: state.user,
        socketId: state.socket?.id,
        isMyTurn: gameState.currentPlayer !== undefined && 
                 gameState.players[gameState.currentPlayer]?.id === state.socket?.id
    });
    
    // Mise à jour des contrôles
    const isCurrentPlayer = gameState.currentPlayer !== undefined && 
        gameState.players[gameState.currentPlayer]?.id === state.socket?.id;
    
    console.log('Tour du joueur:', {
        isCurrentPlayer,
        currentPlayerId: gameState.players[gameState.currentPlayer]?.id,
        myId: state.socket?.id,
        socketId: state.socket?.id,
        players: gameState.players.map(p => ({ id: p.id, position: p.position }))
    });
    
    // Activer/désactiver les boutons d'action
    const foldBtn = document.getElementById('foldBtn');
    const callBtn = document.getElementById('callBtn');
    const raiseBtn = document.getElementById('raiseBtn');
    const betSlider = document.getElementById('betSlider');
    
    foldBtn.disabled = !isCurrentPlayer;
    callBtn.disabled = !isCurrentPlayer;
    raiseBtn.disabled = !isCurrentPlayer;
    betSlider.disabled = !isCurrentPlayer;
    
    // Mettre à jour le slider de mise
    if (isCurrentPlayer) {
        const currentPlayer = gameState.players[gameState.currentPlayer];
        const currentBet = gameState.currentBet || 0;
        const minBet = currentBet * 2;
        
        console.log('Configuration mise:', {
            currentBet,
            minBet,
            playerChips: currentPlayer.chips
        });
        
        betSlider.min = minBet;
        betSlider.max = currentPlayer.chips;
        betSlider.value = minBet;
        document.getElementById('betAmount').textContent = minBet;
        
        // Ajouter des indicateurs visuels
        foldBtn.classList.add('active');
        callBtn.classList.add('active');
        raiseBtn.classList.add('active');
    } else {
        // Retirer les indicateurs visuels
        foldBtn.classList.remove('active');
        callBtn.classList.remove('active');
        raiseBtn.classList.remove('active');
    }
    // Pot change animation
    try {
        const potEl = document.getElementById('pot');
        if (potEl) {
            const prev = state._prevPot || 0;
            if (gameState.pot !== prev) {
                potEl.classList.add('pot-animate');
                clearTimeout(state._potTimer);
                state._potTimer = setTimeout(() => potEl.classList.remove('pot-animate'), 700);
            }
            state._prevPot = gameState.pot;
        }
    } catch (e) { /* ignore */ }
}

// UI helpers
function showSection(id) { document.querySelectorAll('section').forEach(s => s.classList.add('hidden')); document.getElementById(id).classList.remove('hidden'); }
function showLobby() { showSection('lobby-section'); updateTables(); }
function showGameSection() { showSection('game-section'); }
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }
function showRegisterModal() { showModal('register-modal'); }
function showCreateTableModal() { showModal('create-table-modal'); }

function updateCommunityCards(cards) {
    const container = document.getElementById('community-cards'); if (!container) return;
    container.innerHTML = (cards || []).map(c => createCardElement(c)).join('');
}

function updatePlayers(players) {
    const container = document.getElementById('players-container'); 
    if (!container) return;
    
    // Arrange players around the table by their position
    container.innerHTML = (players || []).map(p => {
        // Robust detection of the local player: compare different possible id fields
        const localIds = [state.user?.id, state.user?._id, state.socket?.id];
        const isCurrentUser = localIds.some(x => x && String(x) === String(p.id)) || p.username === state.user?.username;
        const isCurrentPlayer = state.gameState?.currentPlayer !== undefined && 
            state.gameState.players[state.gameState.currentPlayer]?.id === p.id;
        // Add a position class so CSS can place players around table
        const posClass = `pos-${p.position}`;
        const isDealer = state.gameState && state.gameState.dealer === p.position;
        const isSB = state.gameState && state.gameState.sbPos === p.position;
        const isBB = state.gameState && state.gameState.bbPos === p.position;
        
        // Render cards horizontally (two cards side-by-side)
        const cardsHtml = p.hand ? (isCurrentUser ? p.hand.map(card => createCardElement(card)).join('') : p.hand.map(() => createCardElement({ hidden: true })).join('')) : '';

        // Build position markers (D, SB, BB)
        const positionMarkers = [];
        if (isDealer) positionMarkers.push('<span class="dealer-badge">D</span>');
        if (isSB) positionMarkers.push('<span class="dealer-badge sb">SB</span>');
        if (isBB) positionMarkers.push('<span class="dealer-badge bb">BB</span>');

        return `
            <div class="player ${posClass} ${isCurrentPlayer ? 'active' : ''} ${p.folded ? 'folded' : ''}" data-pos="${p.position}">
                <div class="player-info">
                    ${positionMarkers.join('')}
                    <span class="player-badge">${p.username} (${p.chips})</span>
                </div>
                <div class="player-cards">${cardsHtml}</div>
                <div class="chip-stack">${renderChipStack(p.chips)}</div>
                ${p.bet > 0 ? `<div class="player-bet">${p.bet}</div>` : ''}
            </div>
        `;
    }).join('');
}

// Small helper to render stack of chips (visual)
function renderChipStack(chips) {
    const chipsCount = Math.min(5, Math.floor(chips / 200));
    let html = '';
    for (let i = 0; i < chipsCount; i++) html += '<div class="chip"></div>';
    if (!html) html = '<div class="chip small"></div>';
    return html;
}

function handleGameAction(action, amount = null) {
    console.log('Action tentée :', { action, amount, currentTable: state.currentTable, gameState: state.gameState });
    
    // Vérifications de base
    if (!state.currentTable || !state.gameState) {
        console.error('Impossible de jouer : pas de table ou état de jeu');
        alert('Erreur : aucune partie en cours');
        return;
    }

    if (!state.socket || !state.socket.connected) {
        console.error('Socket non connecté');
        alert('Erreur de connexion au serveur. Veuillez recharger la page.');
        return;
    }

    // Vérification du tour du joueur
    const isCurrentPlayer = state.gameState.currentPlayer !== undefined && 
        state.gameState.players[state.gameState.currentPlayer]?.id === state.socket?.id;
    
    if (!isCurrentPlayer) {
        console.error('Ce n\'est pas votre tour');
        alert('Ce n\'est pas votre tour');
        return;
    }

    // Validation de l'action
    const currentPlayer = state.gameState.players[state.gameState.currentPlayer];
    const currentBet = state.gameState.currentBet || 0;
    
    switch (action) {
        case 'fold':
            break;
            
        case 'call':
            if (currentBet <= 0) {
                console.error('Impossible de suivre : aucune mise en cours');
                return;
            }
            amount = currentBet;
            break;
            
        case 'raise':
            if (!amount || amount < currentBet * 2) {
                console.error('Montant de relance invalide');
                alert('Montant de relance invalide');
                return;
            }
            if (amount > currentPlayer.chips) {
                console.error('Pas assez de jetons');
                alert('Vous n\'avez pas assez de jetons');
                return;
            }
            break;
            
        default:
            console.error('Action invalide');
            return;
    }
    
    console.log('Envoi action :', {
        tableId: state.currentTable,
        action,
        amount,
        player: state.user,
        currentBet,
        playerChips: currentPlayer.chips
    });
    
    // Désactiver les boutons pendant le traitement
    document.getElementById('foldBtn').disabled = true;
    document.getElementById('callBtn').disabled = true;
    document.getElementById('raiseBtn').disabled = true;
    
    console.log('Envoi de l\'action au serveur avec socket id:', state.socket.id);
    state.socket.emit('gameAction', {
        tableId: state.currentTable,
        action,
        amount
    });
    
    // Écoute temporaire pour la réponse du serveur
    state.lastActionTimeout = setTimeout(() => {
        console.log('Pas de réponse du serveur après 2s');
        // Réactiver les boutons
        document.getElementById('foldBtn').disabled = false;
        document.getElementById('callBtn').disabled = false;
        document.getElementById('raiseBtn').disabled = false;
        state.lastActionTimeout = null;
    }, 2000);
}

function createCardElement(card) {
    if (!card) return '';

    // front shows value+suit, back shows a question mark
    const suitSymbol = card.suit ? getSuitSymbol(card.suit) : '';
    const color = card.suit === 'hearts' || card.suit === 'diamonds' ? 'red' : 'black';
    const isHidden = !!card.hidden;

    return `
        <div class="card ${isHidden ? 'hidden' : 'revealed'}">
            <div class="card-face front" style="color:${color}">${card.value || ''}${suitSymbol}</div>
            <div class="card-face back">?</div>
        </div>
    `;
}

function getSuitSymbol(suit) { 
    const symbols = { 
        'spades': '♠',
        'hearts': '♥',
        'diamonds': '♦',
        'clubs': '♣' 
    }; 
    return symbols[suit] || suit; 
}

function updateTables() {
    // Ask server for tables via socket; server should implement 'getTables' or keep client-side list via events
    if (!state.socket) return;
    state.socket.emit('getTables', {}, (tables = []) => {
        const container = document.getElementById('tables-list'); if (!container) return;
        container.innerHTML = tables.map(table => `
            <div class="table-card">
                <h3>${table.name}</h3>
                <p>Joueurs: ${table.players.length}/${table.maxPlayers}</p>
                <p>Blindes: ${table.smallBlind}/${table.bigBlind}</p>
                <button class="join-table-btn" data-table-id="${table.id}" ${table.players.length >= table.maxPlayers ? 'disabled' : ''}>Rejoindre</button>
            </div>
        `).join('');

        // Ajouter les écouteurs d'événements aux boutons après avoir créé le HTML
        container.querySelectorAll('.join-table-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const tableId = e.target.getAttribute('data-table-id');
                handleJoinTable(tableId);
            });
        });
    });
}

// Chat
function handleSendMessage() {
    const input = document.getElementById('chat-message'); if (!input) return; const message = input.value.trim();
    if (message && state.currentTable) { state.socket.emit('chatMessage', { tableId: state.currentTable, message }); input.value = ''; }
}

function addChatMessage(data) { const container = document.getElementById('chat-messages'); if (!container) return; const el = document.createElement('div'); el.className = 'chat-message'; el.innerHTML = `<strong>${data.username}:</strong> ${data.message}`; container.appendChild(el); container.scrollTop = container.scrollHeight; }

