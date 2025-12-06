require('dotenv').config();
const WebSocket = require('ws');
const { initDatabase, pool } = require('../config/database');
const RoomManager = require('./websocket/RoomManager');

const PORT = process.env.WS_PORT || 3002;

// WebSocket szerver indítása
const wss = new WebSocket.Server({
    port: PORT,
    // CORS engedélyezése
    verifyClient: (info) => {
        // Engedélyezzük a localhost és rikiki.test domaineket
        const origin = info.origin || info.req.headers.origin;
        const allowed = ['http://localhost', 'http://rikiki.test', 'https://rikiki.test'];
        return !origin || allowed.some(a => origin.startsWith(a));
    }
});

console.log(`Rikiki WebSocket szerver indítása a ${PORT} porton...`);

// Adatbázis inicializálása
initDatabase()
    .then(() => {
        console.log('Adatbázis inicializálva!');
    })
    .catch(err => {
        console.error('Adatbázis hiba:', err);
    });

// Kapcsolat kezelése
wss.on('connection', (ws, req) => {
    console.log('Új kapcsolat!');

    let userId = null;
    let playerId = null;
    let currentRoom = null;

    // Üzenet kezelése
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Üzenet:', data.type);

            switch (data.type) {
                case 'auth':
                    // Felhasználó azonosítása (WP user ID)
                    userId = data.userId;
                    const userName = data.userName || `Játékos_${userId}`;

                    // Csatlakozás vagy szoba létrehozása
                    const result = await RoomManager.joinOrCreateRoom(userId, userName, ws);
                    currentRoom = result.room;
                    playerId = result.playerId;

                    // Válasz küldése
                    RoomManager.sendToClient(ws, {
                        type: 'authSuccess',
                        data: {
                            userId: userId,
                            playerId: playerId,
                            roomCode: currentRoom.code,
                            gameState: currentRoom.game.getPlayerState(playerId)
                        }
                    });

                    // Broadcast a szoba többi tagjának
                    RoomManager.broadcastToRoom(currentRoom, {
                        type: 'playerJoined',
                        data: {
                            playerId: playerId,
                            playerName: userName,
                            playerCount: currentRoom.game.players.length
                        }
                    });
                    break;

                case 'startGame':
                    // Játék indítása
                    if (!currentRoom) {
                        throw new Error('Nincs aktív szoba!');
                    }

                    const gameState = await RoomManager.startGame(currentRoom.code);

                    RoomManager.broadcastToRoom(currentRoom, {
                        type: 'gameStarted',
                        data: gameState
                    });
                    break;

                case 'bid':
                    // Licitálás
                    if (!currentRoom || !playerId) {
                        throw new Error('Nincs aktív játék!');
                    }

                    const bidState = currentRoom.game.placeBid(playerId, data.bid);

                    RoomManager.broadcastToRoom(currentRoom, {
                        type: 'gameState',
                        data: bidState
                    });

                    // AI lépések ütemezése
                    RoomManager.scheduleAIMove(currentRoom);
                    break;

                case 'playCard':
                    // Lap kijátszása
                    if (!currentRoom || !playerId) {
                        throw new Error('Nincs aktív játék!');
                    }

                    const playState = currentRoom.game.playCard(playerId, data.cardId);

                    RoomManager.broadcastToRoom(currentRoom, {
                        type: 'gameState',
                        data: playState
                    });

                    // Ha kör vége, új kör indítása késleltetéssel
                    if (playState.status === 'roundEnd') {
                        setTimeout(() => {
                            currentRoom.game.startNewRound();
                            const newState = currentRoom.game.getGameState();

                            RoomManager.broadcastToRoom(currentRoom, {
                                type: 'gameState',
                                data: newState
                            });

                            // AI lépések ütemezése
                            RoomManager.scheduleAIMove(currentRoom);
                        }, 3000);
                    } else {
                        // AI lépések ütemezése
                        RoomManager.scheduleAIMove(currentRoom);
                    }
                    break;

                case 'getState':
                    // Aktuális állapot lekérdezése
                    if (currentRoom && playerId) {
                        RoomManager.sendToClient(ws, {
                            type: 'gameState',
                            data: currentRoom.game.getPlayerState(playerId)
                        });
                    }
                    break;

                case 'getStats':
                    // Felhasználói statisztikák lekérdezése
                    if (userId) {
                        const stats = await getUserStats(userId);
                        RoomManager.sendToClient(ws, {
                            type: 'stats',
                            data: stats
                        });
                    }
                    break;

                case 'getLeaderboard':
                    // Ranglista lekérdezése
                    const leaderboard = await getLeaderboard();
                    RoomManager.sendToClient(ws, {
                        type: 'leaderboard',
                        data: leaderboard
                    });
                    break;

                case 'getActiveRooms':
                    // Aktív szobák számának lekérdezése (admin)
                    RoomManager.sendToClient(ws, {
                        type: 'activeRooms',
                        count: RoomManager.rooms.size
                    });
                    break;

                case 'adminRestartAll':
                    // Összes játék újraindítása (admin)
                    console.log('Admin: Összes játék újraindítása');

                    // Értesítjük az összes klienst
                    for (const [roomCode, room] of RoomManager.rooms) {
                        RoomManager.broadcastToRoom(room, {
                            type: 'gameRestarted',
                            message: 'A játék újraindult. Kérlek csatlakozz újra!'
                        });
                    }

                    // Szobák törlése
                    RoomManager.rooms.clear();
                    RoomManager.playerRooms.clear();

                    RoomManager.sendToClient(ws, {
                        type: 'restartSuccess'
                    });
                    break;

                default:
                    console.log('Ismeretlen üzenet típus:', data.type);
            }

        } catch (error) {
            console.error('Hiba:', error.message);
            RoomManager.sendToClient(ws, {
                type: 'error',
                message: error.message
            });
        }
    });

    // Kapcsolat bontás
    ws.on('close', () => {
        console.log('Kapcsolat bontva:', userId);
        if (userId) {
            RoomManager.handleDisconnect(userId);
        }
    });

    // Hiba kezelése
    ws.on('error', (error) => {
        console.error('WebSocket hiba:', error);
    });

    // Ping-pong a kapcsolat életben tartásához
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

// Kapcsolatok életben tartása
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

/**
 * Felhasználói statisztikák lekérdezése
 */
async function getUserStats(userId) {
    try {
        const [rows] = await pool.execute(
            `SELECT * FROM rikiki_user_stats WHERE user_id = ?`,
            [userId]
        );
        return rows[0] || {
            games_played: 0,
            games_won: 0,
            total_score: 0,
            highest_score: 0,
            rank_points: 1000
        };
    } catch (error) {
        console.error('Statisztika lekérdezési hiba:', error);
        return null;
    }
}

/**
 * Ranglista lekérdezése
 */
async function getLeaderboard() {
    try {
        const [rows] = await pool.execute(`
            SELECT
                rus.user_id,
                wu.display_name,
                rus.games_played,
                rus.games_won,
                rus.total_score,
                rus.highest_score,
                rus.rank_points
            FROM rikiki_user_stats rus
            LEFT JOIN wp_users wu ON rus.user_id = wu.ID
            ORDER BY rus.rank_points DESC
            LIMIT 50
        `);
        return rows;
    } catch (error) {
        console.error('Ranglista lekérdezési hiba:', error);
        return [];
    }
}

console.log(`Rikiki WebSocket szerver fut a ws://localhost:${PORT} címen`);
