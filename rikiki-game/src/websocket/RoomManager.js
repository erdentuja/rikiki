const Game = require('../game/Game');
const AIPlayer = require('../ai/AIPlayer');
const { pool } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Szoba kezelő osztály
 */
class RoomManager {
    constructor() {
        this.rooms = new Map(); // roomCode -> Room
        this.playerRooms = new Map(); // odayId -> roomCode
        this.ai = new AIPlayer('medium');
    }

    /**
     * Beállítások lekérdezése adatbázisból
     */
    async getSettings() {
        try {
            // WordPress wp_ prefixet használ
            const [rows] = await pool.execute('SELECT setting_key, setting_value FROM wp_rikiki_settings');
            const settings = {};
            for (const row of rows) {
                settings[row.setting_key] = row.setting_value;
            }
            console.log('Beállítások betöltve:', settings);
            return {
                playerCount: parseInt(settings.player_count) || 4,
                maxRounds: parseInt(settings.max_rounds) || 10,
                thinkingTime: parseInt(settings.thinking_time) || 30,
                allowEqualBids: settings.allow_equal_bids === '1'
            };
        } catch (error) {
            console.error('Beállítások lekérdezési hiba:', error);
            return {
                playerCount: 4,
                maxRounds: 10,
                thinkingTime: 30,
                allowEqualBids: false
            };
        }
    }

    /**
     * Új szoba létrehozása vagy csatlakozás
     */
    async joinOrCreateRoom(userId, userName, ws) {
        // Ellenőrzés: van-e már aktív szobája
        if (this.playerRooms.has(userId)) {
            const roomCode = this.playerRooms.get(userId);
            const room = this.rooms.get(roomCode);
            if (room && room.game.status !== 'finished') {
                // Újracsatlakozás
                return this.rejoinRoom(userId, ws, room);
            }
        }

        // Keresünk várakozó szobát
        for (const [code, room] of this.rooms) {
            if (room.game.status === 'waiting' && room.humanPlayers < room.game.playerCount) {
                return this.joinRoom(userId, userName, ws, room);
            }
        }

        // Új szoba létrehozása
        return this.createRoom(userId, userName, ws);
    }

    /**
     * Új szoba létrehozása
     */
    async createRoom(userId, userName, ws) {
        const settings = await this.getSettings();
        const roomCode = this.generateRoomCode();

        const game = new Game(roomCode, settings);

        const playerId = `player_${userId}`;
        game.addPlayer({
            id: playerId,
            wpUserId: userId,
            name: userName,
            isAI: false
        });

        const room = {
            code: roomCode,
            game: game,
            clients: new Map(), // userId -> ws
            humanPlayers: 1,
            createdAt: Date.now()
        };

        room.clients.set(userId, ws);
        this.rooms.set(roomCode, room);
        this.playerRooms.set(userId, roomCode);

        // Adatbázisba mentés
        await this.saveRoomToDb(room);

        return { room, playerId };
    }

    /**
     * Csatlakozás szobához
     */
    async joinRoom(userId, userName, ws, room) {
        const playerId = `player_${userId}`;

        room.game.addPlayer({
            id: playerId,
            wpUserId: userId,
            name: userName,
            isAI: false
        });

        room.clients.set(userId, ws);
        room.humanPlayers++;
        this.playerRooms.set(userId, room.code);

        // Adatbázis frissítése
        await this.updateRoomInDb(room);

        return { room, playerId };
    }

    /**
     * Újracsatlakozás szobához
     */
    rejoinRoom(userId, ws, room) {
        const playerId = `player_${userId}`;
        room.clients.set(userId, ws);

        const player = room.game.players.find(p => p.id === playerId);
        if (player) {
            player.isConnected = true;
        }

        return { room, playerId };
    }

    /**
     * Játék indítása (AI-val feltöltve)
     */
    async startGame(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) {
            throw new Error('Szoba nem található!');
        }

        // AI játékosok hozzáadása
        room.game.fillWithAI();

        // Játék indítása
        const gameState = room.game.start();

        // Adatbázis frissítése
        await this.updateRoomInDb(room);

        // AI lépések ütemezése ha AI kezd
        this.scheduleAIMove(room);

        return gameState;
    }

    /**
     * AI lépés ütemezése
     */
    scheduleAIMove(room) {
        const game = room.game;
        const currentPlayer = game.players[game.currentPlayerIndex];

        if (!currentPlayer || !currentPlayer.isAI) {
            return;
        }

        if (game.status !== 'bidding' && game.status !== 'playing') {
            return;
        }

        const thinkingTime = this.ai.getThinkingTime();

        setTimeout(async () => {
            try {
                let newState;

                if (game.status === 'bidding') {
                    // AI licit
                    const otherBids = game.players
                        .filter(p => p.bid !== null)
                        .map(p => p.bid);

                    const bid = this.ai.calculateBid(
                        currentPlayer.hand,
                        game.trumpSuit,
                        game.cardsPerRound,
                        otherBids,
                        game.isLastBidder(game.currentPlayerIndex),
                        game.allowEqualBids
                    );

                    newState = game.placeBid(currentPlayer.id, bid);

                } else if (game.status === 'playing') {
                    // AI lap kijátszása
                    const playableCards = game.getPlayableCards(currentPlayer.id);
                    const cardId = this.ai.chooseCard(
                        currentPlayer.hand,
                        playableCards,
                        game.getGameState()
                    );

                    newState = game.playCard(currentPlayer.id, cardId);
                }

                // Broadcast az összes kliensnek
                this.broadcastToRoom(room, {
                    type: 'gameState',
                    data: newState
                });

                // Ha kör vége, új kör indítása késleltetéssel
                if (newState.status === 'roundEnd') {
                    setTimeout(() => {
                        game.startNewRound();
                        const state = game.getGameState();
                        this.broadcastToRoom(room, {
                            type: 'gameState',
                            data: state
                        });
                        this.scheduleAIMove(room);
                    }, 3000);
                } else {
                    // Következő AI lépés
                    this.scheduleAIMove(room);
                }

            } catch (error) {
                console.error('AI lépés hiba:', error);
            }
        }, thinkingTime);
    }

    /**
     * Üzenet küldése a szoba összes kliensének
     */
    broadcastToRoom(room, message) {
        for (const [odayId, ws] of room.clients) {
            if (ws.readyState === 1) { // WebSocket.OPEN
                // Személyre szabott állapot küldése
                if (message.type === 'gameState') {
                    const playerId = `player_${odayId}`;
                    const personalState = room.game.getPlayerState(playerId);
                    ws.send(JSON.stringify({
                        type: 'gameState',
                        data: personalState
                    }));
                } else {
                    ws.send(JSON.stringify(message));
                }
            }
        }
    }

    /**
     * Üzenet küldése egy kliensnek
     */
    sendToClient(ws, message) {
        if (ws.readyState === 1) {
            ws.send(JSON.stringify(message));
        }
    }

    /**
     * Szoba kód generálása
     */
    generateRoomCode() {
        return uuidv4().substring(0, 6).toUpperCase();
    }

    /**
     * Szoba mentése adatbázisba
     */
    async saveRoomToDb(room) {
        try {
            await pool.execute(
                `INSERT INTO rikiki_rooms (room_code, status, player_count, max_rounds)
                 VALUES (?, 'waiting', ?, ?)`,
                [room.code, room.game.playerCount, room.game.maxRounds]
            );
        } catch (error) {
            console.error('Szoba mentési hiba:', error);
        }
    }

    /**
     * Szoba frissítése adatbázisban
     */
    async updateRoomInDb(room) {
        try {
            await pool.execute(
                `UPDATE rikiki_rooms SET status = ?, current_round = ? WHERE room_code = ?`,
                [room.game.status, room.game.currentRound, room.code]
            );
        } catch (error) {
            console.error('Szoba frissítési hiba:', error);
        }
    }

    /**
     * Felhasználói statisztikák frissítése
     */
    async updateUserStats(userId, score, position, totalPlayers) {
        try {
            const isWinner = position === 1;

            await pool.execute(`
                INSERT INTO rikiki_user_stats (user_id, games_played, games_won, total_score, highest_score, rank_points)
                VALUES (?, 1, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    games_played = games_played + 1,
                    games_won = games_won + ?,
                    total_score = total_score + ?,
                    highest_score = GREATEST(highest_score, ?),
                    rank_points = rank_points + ?
            `, [
                userId,
                isWinner ? 1 : 0,
                score,
                score,
                this.calculateRankPoints(position, totalPlayers),
                isWinner ? 1 : 0,
                score,
                score,
                this.calculateRankPoints(position, totalPlayers)
            ]);
        } catch (error) {
            console.error('Statisztika frissítési hiba:', error);
        }
    }

    /**
     * Rang pontok számítása
     */
    calculateRankPoints(position, totalPlayers) {
        const basePoints = [25, 15, 10, 5, 2, 0];
        return basePoints[position - 1] || 0;
    }

    /**
     * Játékos kilépése
     */
    handleDisconnect(userId) {
        const roomCode = this.playerRooms.get(userId);
        if (!roomCode) return;

        const room = this.rooms.get(roomCode);
        if (!room) return;

        room.clients.delete(userId);

        const playerId = `player_${userId}`;
        const player = room.game.players.find(p => p.id === playerId);
        if (player) {
            player.isConnected = false;
        }

        // Ha minden ember kilépett, szoba törlése
        if (room.clients.size === 0) {
            // Várakozás újracsatlakozásra
            setTimeout(() => {
                if (room.clients.size === 0) {
                    this.rooms.delete(roomCode);
                    this.playerRooms.delete(userId);
                }
            }, 60000); // 1 perc várakozás
        }
    }

    /**
     * Szoba lekérdezése
     */
    getRoom(roomCode) {
        return this.rooms.get(roomCode);
    }

    /**
     * Játékos szobájának lekérdezése
     */
    getPlayerRoom(userId) {
        const roomCode = this.playerRooms.get(userId);
        return roomCode ? this.rooms.get(roomCode) : null;
    }
}

module.exports = new RoomManager();
