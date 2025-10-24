import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { generateDeck, shuffleDeck } from "./game/deck.js";
import { evaluateHand, determineWinner } from "./game/pokerLogic.js";
import User from "./models/User.js";
// Exported maps for admin introspection
export const tables = new Map();
export const userSockets = new Map();

export const initSocket = (server) => {
    const io = new Server(server, {
        cors: {
            origin: process.env.NODE_ENV === 'production'
                ? ['https://poker-texas-holdem.netlify.app', 'https://www.poker-texas-holdem.netlify.app']
                : '*',
            methods: ["GET", "POST"],
            credentials: true
        },
        transports: ['websocket', 'polling']
    });

    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth && socket.handshake.auth.token;
            if (token) {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.id);
                if (!user) throw new Error("Utilisateur non trouvé");
                socket.user = user;
            } else {
                const guestName = socket.handshake.auth && socket.handshake.auth.username
                    ? socket.handshake.auth.username
                    : `Guest_${socket.id.slice(0,5)}`;
                socket.user = {
                    id: socket.id,
                    socketId: socket.id,
                    username: guestName,
                    chips: 1000,
                    isGuest: true
                };
            }
            next();
        } catch (error) {
            console.warn('Socket auth warning:', error.message);
            const guestName = `Guest_${socket.id.slice(0,5)}`;
            socket.user = { id: socket.id, username: guestName, chips: 1000, isGuest: true };
            next();
        }
    });

    io.on("connection", (socket) => {
        console.log("🧑 Connexion:", socket.user.username);
        userSockets.set(socket.user.id, socket);

        // Create table
        socket.on("createTable", (data) => {
            try {
                console.log('createTable received from', socket.user.username, data);
                const tableId = `table_${Date.now()}`;
                const table = {
                    id: tableId,
                    name: data.name,
                    maxPlayers: data.maxPlayers || 2,
                    smallBlind: data.smallBlind || 10,
                    bigBlind: data.bigBlind || 20,
                    players: [],
                    deck: [],
                    pot: 0,
                    community: [],
                    currentPlayer: null,
                    dealer: -1,
                    status: "waiting",
                    round: null,
                    currentBet: 0,
                    lastRaise: 0
                };
                tables.set(tableId, table);
                console.log('table created:', tableId, table.name);
                socket.emit("tableCreated", { tableId });
            } catch (err) {
                console.error('createTable error:', err && (err.stack || err.message));
                socket.emit('serverError', { message: 'Impossible de créer la table' });
            }
        });

        // Fournir la liste des tables (callback)
        socket.on('getTables', (payload, cb) => {
            try {
                const list = Array.from(tables.values()).map(t => getPublicTableState(t));
                if (typeof cb === 'function') cb(list);
            } catch (err) {
                if (typeof cb === 'function') cb([]);
            }
        });

        // Rejoindre une table
        socket.on("joinTable", async ({ tableId }) => {
            try {
                const table = tables.get(tableId);
                if (!table) return socket.emit('serverError', { message: 'Table introuvable' });

                if (table.players.length >= table.maxPlayers) {
                    return socket.emit("error", { message: "Table pleine" });
                }

                const player = {
                    id: socket.id,
                    socketId: socket.id,
                    username: socket.user.username,
                    chips: socket.user.chips || 1000,
                    hand: [],
                    bet: 0,
                    folded: false,
                    position: table.players.length
                };

                table.players.push(player);
                socket.join(tableId);

                io.to(tableId).emit("playerJoined", {
                    player: {
                        id: player.id,
                        username: player.username,
                        chips: player.chips,
                        position: player.position
                    },
                    tableState: getPublicTableState(table)
                });

                if (table.players.length >= 2 && table.status === "waiting") {
                    startGame(io, table);
                }
            } catch (err) {
                console.error('joinTable error:', err && (err.stack || err.message));
                socket.emit('serverError', { message: 'Erreur lors du joinTable' });
            }
        });

        // Récupération de l'état de la table après reconnexion
        socket.on("getTableState", ({ tableId }) => {
            try {
                const table = tables.get(tableId);
                if (table) {
                    console.log('Envoi de l\'état de la table après reconnexion pour', socket.id);
                    socket.join(tableId);
                    io.to(socket.id).emit("gameState", getPublicTableState(table));

                    const player = table.players.find(p => p.id === socket.id);
                    if (player && player.hand) {
                        io.to(socket.id).emit("privateHand", { tableId, hand: player.hand });
                    }
                }
            } catch (err) {
                console.error('getTableState error:', err && (err.stack || err.message));
                socket.emit('serverError', { message: 'Impossible de récupérer l\'état' });
            }
        });

        // Action de jeu (wrapper sécurisé)
        socket.on("gameAction", ({ tableId, action, amount }) => {
            console.log('>>> gameAction ENTRY', { socketId: socket.id, tableId, action, amount });
            try {
                const table = tables.get(tableId);
                if (!table || table.status !== "playing") {
                    console.log('Action rejetée : table invalide ou pas en jeu', { tableId, status: table?.status });
                    socket.emit('serverError', { message: 'Table invalide ou non en jeu' });
                    return;
                }

                const player = table.players.find(p => p.id === socket.id);
                if (!player) {
                    console.log('Action rejetée : joueur non trouvé', { socketId: socket.id, players: table.players });
                    socket.emit('serverError', { message: 'Joueur non trouvé à la table' });
                    return;
                }

                if (table.currentPlayer !== player.position) {
                    console.log('Action rejetée : mauvais joueur', {
                        expected: table.currentPlayer,
                        actual: player.position,
                        playerId: socket.id,
                        tableState: {
                            players: table.players.map(p => ({ id: p.id, position: p.position })),
                            currentPlayer: table.currentPlayer
                        }
                    });
                    socket.emit('serverError', { message: 'Ce n\'est pas votre tour' });
                    return;
                }

                handlePlayerAction(io, table, player, action, amount);
                try {
                    socket.emit('actionAck', { tableId, action, amount, ok: true });
                } catch (e) {}
                console.log('<<< gameAction EXIT ok', { socketId: socket.id, tableId, action, amount });
            } catch (err) {
                console.error('gameAction handler error:', err && (err.stack || err.message));
                try { socket.emit('serverError', { message: 'Erreur interne serveur lors de l\'action' }); } catch (e) {}
            }
        });

        // Chat
        socket.on("chatMessage", ({ tableId, message }) => {
            const table = tables.get(tableId);
            if (!table) return;

            io.to(tableId).emit("chatMessage", {
                username: socket.user.username,
                message: message
            });
        });

        // Déconnexion
        socket.on("disconnect", (reason) => {
            console.log('🧑 Déconnexion:', socket.user?.username, 'reason:', reason);
            userSockets.delete(socket.user.id);
            tables.forEach((table, tableId) => {
                const playerIndex = table.players.findIndex(p => p.id === socket.user.id);
                if (playerIndex !== -1) {
                    table.players.splice(playerIndex, 1);
                    io.to(tableId).emit("playerLeft", {
                        playerId: socket.user.id,
                        tableState: getPublicTableState(table)
                    });

                    if (table.players.length < 2 && table.status === "playing") {
                        endGame(io, table, table.players[0]);
                    }
                }
            });
        });
    });
    // Return io so the server can use it for admin actions
    return io;
};

// Démarrage d'une nouvelle partie
function startGame(io, table) {
    try {
        table.status = "playing";
        table.deck = shuffleDeck(generateDeck());
        table.pot = 0;
        table.community = [];
        table.round = "pre-flop";
        table.currentBet = table.bigBlind;
        table.lastRaise = table.bigBlind;

        // Rotation du dealer
        table.dealer = (table.dealer + 1) % table.players.length;

        // Distribution des cartes
        table.players.forEach(player => {
            player.hand = [table.deck.pop(), table.deck.pop()];
            player.bet = 0;
            player.folded = false;
        });

        // DEBUG: log dealt hands (temporary)
        try {
            console.log(`DEBUG startGame - table ${table.id} hands:`);
            table.players.forEach(p => console.log('  player', p.id, 'socketId', p.socketId, 'hand', p.hand.map(c => `${c.value}${c.suit}`)));
        } catch (e) { console.warn('DEBUG log failed', e.message); }

        // Blindes
        const sbPos = (table.dealer + 1) % table.players.length;
        const bbPos = (table.dealer + 2) % table.players.length;

        // Stockage des positions pour l'UI
        table.sbPos = sbPos;
        table.bbPos = bbPos;

        // Prélèvement des blindes
        table.players[sbPos].chips -= table.smallBlind;
        table.players[sbPos].bet = table.smallBlind;
        table.players[bbPos].chips -= table.bigBlind;
        table.players[bbPos].bet = table.bigBlind;
        table.pot = table.smallBlind + table.bigBlind;

        // Premier joueur (après la grosse blinde)
        table.currentPlayer = (bbPos + 1) % table.players.length;

        // Envoi de l'état initial
        broadcastGameState(io, table);

        // Send private hands to each player after initial broadcast
        table.players.forEach(p => {
            try {
                const sock = io.sockets.sockets.get(p.socketId);
                if (sock) {
                    sock.emit('privateHand', { tableId: table.id, hand: p.hand });
                    console.log(`DEBUG privateHand sent to ${p.socketId} (player ${p.id})`);
                }
            } catch (err) { console.warn('private hand send failed:', err.message); }
        });
    } catch (err) {
        console.error('startGame failed for table', table?.id, err.stack || err.message);
        try {
            io.to(table.id).emit('serverError', { message: 'Erreur serveur lors du démarrage de la partie' });
        } catch (e) { /* ignore */ }
    }
}

// Gestion des actions des joueurs
function handlePlayerAction(io, table, player, action, amount) {
    try {
        switch (action) {
            case "fold":
                player.folded = true;
                break;

            case "call":
                const callAmount = table.currentBet - player.bet;
                player.chips -= callAmount;
                player.bet = table.currentBet;
                table.pot += callAmount;
                break;

            case "check":
                // Check is valid only if player's current bet equals the table's currentBet
                if ((table.currentBet || 0) !== (player.bet || 0)) {
                    // invalid check, ignore and inform player
                    try { io.to(player.socketId).emit('serverError', { message: 'Impossible de checker : vous devez suivre ou relancer' }); } catch(e){}
                    return;
                }
                // no chips exchange, valid pass
                break;

            case "raise":
                if (amount < table.currentBet * 2 || amount > player.chips) return;
                const raiseAmount = amount - player.bet;
                player.chips -= raiseAmount;
                player.bet = amount;
                table.pot += raiseAmount;
                table.lastRaise = amount - table.currentBet; // Calculer lastRaise avant de mettre à jour currentBet
                table.currentBet = amount;
                break;
        }

        // Passage au joueur suivant
        let attempts = 0;
        do {
            table.currentPlayer = (table.currentPlayer + 1) % table.players.length;
            attempts++;
            // safety to prevent infinite loops in case all players folded incorrectly
            if (attempts > table.players.length + 5) break;
        } while (table.players[table.currentPlayer].folded);

        // Vérification de fin de tour
        if (isRoundComplete(table)) {
            progressRound(io, table);
        } else {
            broadcastGameState(io, table);
        }
    } catch (err) {
        console.error('handlePlayerAction failed on table', table?.id, 'player', player?.id, err.stack || err.message);
        try {
            io.to(table.id).emit('serverError', { message: 'Erreur serveur lors du traitement de votre action' });
        } catch (e) { /* ignore */ }
    }
}

// Progression des tours
function progressRound(io, table) {
    // Vérifier s'il reste plusieurs joueurs actifs
    const activePlayers = table.players.filter(p => !p.folded);
    if (activePlayers.length === 1) {
        return endHand(io, table);
    }

    switch (table.round) {
        case "pre-flop":
            table.round = "flop";
            table.community.push(table.deck.pop(), table.deck.pop(), table.deck.pop());
            break;

        case "flop":
            table.round = "turn";
            table.community.push(table.deck.pop());
            break;

        case "turn":
            table.round = "river";
            table.community.push(table.deck.pop());
            break;

        case "river":
            return endHand(io, table);
    }

    resetBets(table);
    table.currentPlayer = (table.dealer + 1) % table.players.length;
    
    // Passer les joueurs qui ont fold
    while (table.players[table.currentPlayer].folded) {
        table.currentPlayer = (table.currentPlayer + 1) % table.players.length;
    }
    
    broadcastGameState(io, table);
}

// Fin d'une main
function endHand(io, table) {
    const activePlayers = table.players.filter(p => !p.folded);
    
    if (activePlayers.length === 1) {
        // Un seul joueur reste
        const winner = activePlayers[0];
        winner.chips += table.pot;
        announceWinner(io, table, [winner]);
    } else {
        // Showdown
        const hands = activePlayers.map(player => ({
            player,
            hand: evaluateHand([...player.hand, ...table.community])
        }));
        
        const winners = determineWinner(hands);
        const winAmount = Math.floor(table.pot / winners.length);
        
        winners.forEach(winner => {
            winner.player.chips += winAmount;
        });
        
        announceWinner(io, table, winners);
    }

    // Reveal all hands to table for a short moment before starting next hand
    console.log(`DEBUG endHand - revealing hands for table ${table.id}`);
    // embed hands into tableState for reveal (temporary)
    const revealState = getPublicTableState(table);
    revealState.players = table.players.map(p => ({ id: p.id, hand: p.hand, username: p.username }));
    io.to(table.id).emit('revealHands', { tableState: revealState, reveal: true });

    // Nouvelle main après 3 secondes
    setTimeout(() => startGame(io, table), 3000);
}

// Fonctions utilitaires
function getPublicTableState(table) {
    return {
        id: table.id,
        name: table.name,
        players: table.players.map(p => ({
            id: p.id,
            username: p.username,
            chips: p.chips,
            bet: p.bet,
            folded: p.folded,
            position: p.position,
            // hand intentionally omitted from public state for privacy
        })),
        pot: table.pot,
        community: table.community,
        currentPlayer: table.currentPlayer,
        dealer: table.dealer,
        status: table.status,
        round: table.round,
        currentBet: table.currentBet,
        smallBlind: table.smallBlind,
        bigBlind: table.bigBlind
    };
}

function broadcastGameState(io, table) {
    // Emit public state (without players' private hands)
    const publicState = getPublicTableState(table);
    io.to(table.id).emit("gameState", publicState);

    // Send private hand to each player's socket only
    table.players.forEach(p => {
        try {
            const sock = io.sockets.sockets.get(p.socketId);
            if (sock) {
                sock.emit('privateHand', { tableId: table.id, hand: p.hand });
            }
        } catch (err) {
            console.warn('Failed to send privateHand to', p.socketId, err.message);
        }
    });
}

function isRoundComplete(table) {
    const activePlayers = table.players.filter(p => !p.folded);
    return activePlayers.every(p => p.bet === table.currentBet);
}

function resetBets(table) {
    table.players.forEach(p => p.bet = 0);
    table.currentBet = 0;
    table.lastRaise = 0;
}

function announceWinner(io, table, winners) {
    io.to(table.id).emit("handComplete", {
        winners: winners.map(w => ({
            username: w.player.username,
            hand: w.hand,
            amount: Math.floor(table.pot / winners.length)
        })),
        tableState: getPublicTableState(table)
    });
}

function endGame(io, table, winner) {
    if (!table || !winner) return;
    
    // Award pot to winner
    winner.chips += table.pot;
    
    // Reset table state
    table.status = "waiting";
    table.pot = 0;
    table.community = [];
    table.currentBet = 0;
    table.currentPlayer = null;
    table.dealer = null;
    table.sbPos = null;
    table.bbPos = null;
    table.deck = [];
    table.round = null;
    table.lastRaise = 0;
    
    // Reset all player states
    table.players.forEach(p => {
        p.hand = [];
        p.bet = 0;
        p.folded = false;
    });
    
    // Notify all players at the table
    io.to(table.id).emit("gameState", getPublicTableState(table));
    io.to(table.id).emit("gameEnded", {
        winner: winner.username,
        reason: "Other players left the table",
        amount: table.pot
    });
}

// Admin utilities
export function getAdminTables() {
    return Array.from(tables.values()).map(t => ({
        id: t.id,
        name: t.name,
        status: t.status,
        players: t.players.map(p => ({ id: p.id, username: p.username, chips: p.chips, position: p.position, folded: p.folded })),
        pot: t.pot,
        round: t.round,
        currentPlayer: t.currentPlayer
    }));
}

export function forceEndTable(io, tableId) {
    const table = tables.get(tableId);
    if (!table) return false;
    // award pot to first active player or reset
    const active = table.players.filter(p => !p.folded);
    if (active.length >= 1) {
        active[0].chips += table.pot;
    }
    // Reset and notify
    table.status = 'waiting';
    table.pot = 0;
    table.community = [];
    table.currentBet = 0;
    table.currentPlayer = null;
    table.dealer = null;
    table.round = null;
    table.players.forEach(p => { p.hand = []; p.bet = 0; p.folded = false; });
    try { io.to(tableId).emit('gameState', getPublicTableState(table)); } catch (e) {}
    return true;
}

