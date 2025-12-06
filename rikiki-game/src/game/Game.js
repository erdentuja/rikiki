const { Card, Deck } = require('./Card');
const { v4: uuidv4 } = require('uuid');

/**
 * Rikiki játék fő osztály
 */
class Game {
    constructor(roomId, settings = {}) {
        this.roomId = roomId;
        this.gameId = uuidv4();

        // Beállítások
        this.playerCount = settings.playerCount || 4;
        this.maxRounds = settings.maxRounds || 10;
        this.allowEqualBids = settings.allowEqualBids || false;
        this.thinkingTime = settings.thinkingTime || 30;

        // Játékosok
        this.players = [];

        // Játék állapot
        this.status = 'waiting'; // waiting, bidding, playing, roundEnd, finished
        this.currentRound = 0;
        this.roundDirection = 'up'; // up vagy down
        this.cardsPerRound = 0;

        // Kör állapot
        this.deck = new Deck();
        this.trumpCard = null;
        this.trumpSuit = null;
        this.currentTrick = [];
        this.leadSuit = null;
        this.currentPlayerIndex = 0;
        this.dealerIndex = 0;
        this.trickStarterIndex = 0;

        // Eredmények táblázat
        this.scoreTable = [];
    }

    /**
     * Játékos hozzáadása
     */
    addPlayer(player) {
        if (this.players.length >= this.playerCount) {
            throw new Error('A szoba megtelt!');
        }

        this.players.push({
            id: player.id,
            odayId: player.odayId,
            name: player.name,
            isAI: player.isAI || false,
            hand: [],
            bid: null,
            tricksWon: 0,
            totalScore: 0,
            isConnected: !player.isAI,
            seatPosition: this.players.length
        });

        return this.players.length;
    }

    /**
     * AI játékosok hozzáadása a hiányzó helyekre
     */
    fillWithAI() {
        const aiNames = ['Robi', 'Kati', 'Béla', 'Zsuzsi', 'Peti', 'Anna'];
        let aiIndex = 0;

        while (this.players.length < this.playerCount) {
            this.addPlayer({
                id: `ai_${uuidv4().substring(0, 8)}`,
                odayId: null,
                name: aiNames[aiIndex % aiNames.length],
                isAI: true
            });
            aiIndex++;
        }
    }

    /**
     * Játék indítása
     */
    start() {
        if (this.players.length < this.playerCount) {
            this.fillWithAI();
        }

        this.status = 'playing';
        this.currentRound = 0;
        this.roundDirection = 'up';
        this.dealerIndex = Math.floor(Math.random() * this.playerCount);

        // Eredménytábla inicializálás
        this.initScoreTable();

        // Első kör indítása
        this.startNewRound();

        return this.getGameState();
    }

    /**
     * Eredménytábla inicializálása
     */
    initScoreTable() {
        this.scoreTable = [];
        const totalRounds = this.maxRounds * 2 - 1;

        for (let i = 0; i < totalRounds; i++) {
            const cardCount = i < this.maxRounds ? i + 1 : this.maxRounds * 2 - i - 1;
            this.scoreTable.push({
                round: i + 1,
                cardCount: cardCount,
                players: this.players.map(p => ({
                    playerId: p.id,
                    name: p.name,
                    bid: null,
                    tricks: null,
                    score: null,
                    totalScore: 0
                }))
            });
        }
    }

    /**
     * Új kör indítása
     */
    startNewRound() {
        this.currentRound++;

        // Lapszám meghatározása
        const totalRounds = this.maxRounds * 2 - 1;
        if (this.currentRound <= this.maxRounds) {
            this.cardsPerRound = this.currentRound;
        } else {
            this.cardsPerRound = totalRounds - this.currentRound + 1;
        }

        // Ellenőrzés, hogy vége van-e
        if (this.currentRound > totalRounds) {
            this.endGame();
            return;
        }

        // Pakli újrakeverése
        this.deck.reset();

        // Lapok osztása
        for (const player of this.players) {
            player.hand = this.deck.deal(this.cardsPerRound);
            player.hand.sort((a, b) => {
                if (a.suit !== b.suit) {
                    return Card.SUITS.indexOf(a.suit) - Card.SUITS.indexOf(b.suit);
                }
                return a.getStrength() - b.getStrength();
            });
            player.bid = null;
            player.tricksWon = 0;
        }

        // Adu meghatározása (random lap a maradékból)
        if (this.deck.remaining() > 0) {
            this.trumpCard = this.deck.drawOne();
            this.trumpSuit = this.trumpCard.suit;
        } else {
            this.trumpCard = null;
            this.trumpSuit = null;
        }

        // Osztó utáni játékos kezd licitálni
        this.dealerIndex = (this.dealerIndex + 1) % this.playerCount;
        this.currentPlayerIndex = (this.dealerIndex + 1) % this.playerCount;
        this.trickStarterIndex = this.currentPlayerIndex;

        // Állapot: licitálás
        this.status = 'bidding';
        this.currentTrick = [];
        this.leadSuit = null;
    }

    /**
     * Licitálás
     */
    placeBid(playerId, bid) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);

        if (playerIndex === -1) {
            throw new Error('Játékos nem található!');
        }

        if (playerIndex !== this.currentPlayerIndex) {
            throw new Error('Nem te következel!');
        }

        if (this.status !== 'bidding') {
            throw new Error('Nem licitálási fázis!');
        }

        if (bid < 0 || bid > this.cardsPerRound) {
            throw new Error('Érvénytelen licit!');
        }

        // Ellenőrzés: utolsó játékos nem licitálhat úgy, hogy összesen kijöjjön
        if (!this.allowEqualBids && this.isLastBidder(playerIndex)) {
            const totalBids = this.players.reduce((sum, p) => sum + (p.bid || 0), 0);
            if (totalBids + bid === this.cardsPerRound) {
                throw new Error(`Nem licitálhatsz ${bid}-t, mert akkor kijönne a lapszám!`);
            }
        }

        this.players[playerIndex].bid = bid;

        // Eredménytáblába beírás
        const roundData = this.scoreTable[this.currentRound - 1];
        const playerScore = roundData.players.find(p => p.playerId === playerId);
        if (playerScore) {
            playerScore.bid = bid;
        }

        // Következő játékos vagy játék kezdése
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerCount;

        // Ha mindenki licitált, kezdődik a játék
        if (this.players.every(p => p.bid !== null)) {
            this.status = 'playing';
            this.currentPlayerIndex = this.trickStarterIndex;
        }

        return this.getGameState();
    }

    /**
     * Utolsó licitáló-e
     */
    isLastBidder(playerIndex) {
        const bidsPlaced = this.players.filter(p => p.bid !== null).length;
        return bidsPlaced === this.playerCount - 1;
    }

    /**
     * Játszható lapok lekérdezése
     */
    getPlayableCards(playerId) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return [];

        // Ha nincs kezdőszín, bármi játszható
        if (!this.leadSuit || this.currentTrick.length === 0) {
            return player.hand.map(c => c.id);
        }

        // Van-e a kezében a kezdő színből
        const suitCards = player.hand.filter(c => c.suit === this.leadSuit);
        if (suitCards.length > 0) {
            return suitCards.map(c => c.id);
        }

        // Ha nincs színe, van-e aduja
        const trumpCards = player.hand.filter(c => c.suit === this.trumpSuit);
        if (trumpCards.length > 0 && this.trumpSuit) {
            return trumpCards.map(c => c.id);
        }

        // Ha se szín, se adu, bármi játszható
        return player.hand.map(c => c.id);
    }

    /**
     * Lap kijátszása
     */
    playCard(playerId, cardId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        const player = this.players[playerIndex];

        if (playerIndex === -1) {
            throw new Error('Játékos nem található!');
        }

        if (playerIndex !== this.currentPlayerIndex) {
            throw new Error('Nem te következel!');
        }

        if (this.status !== 'playing') {
            throw new Error('Nem játék fázis!');
        }

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) {
            throw new Error('A lap nincs a kezedben!');
        }

        // Ellenőrzés: szabályos-e a lap
        const playableCards = this.getPlayableCards(playerId);
        if (!playableCards.includes(cardId)) {
            throw new Error('Ezt a lapot nem játszhatod ki!');
        }

        // Lap kijátszása
        const card = player.hand.splice(cardIndex, 1)[0];

        // Ha ez az első lap az ütésben, ez lesz a kezdőszín
        if (this.currentTrick.length === 0) {
            this.leadSuit = card.suit;
        }

        this.currentTrick.push({
            playerId: playerId,
            playerIndex: playerIndex,
            card: card
        });

        // Következő játékos
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerCount;

        // Ha mindenki kijátszott, ütés értékelése
        if (this.currentTrick.length === this.playerCount) {
            return this.evaluateTrick();
        }

        return this.getGameState();
    }

    /**
     * Ütés értékelése
     */
    evaluateTrick() {
        let winningPlay = this.currentTrick[0];

        for (let i = 1; i < this.currentTrick.length; i++) {
            const play = this.currentTrick[i];

            // Adu üt mindent (kivéve erősebb adut)
            if (play.card.suit === this.trumpSuit && winningPlay.card.suit !== this.trumpSuit) {
                winningPlay = play;
            }
            // Ugyanaz a szín -> erősebb nyer
            else if (play.card.suit === winningPlay.card.suit && play.card.getStrength() > winningPlay.card.getStrength()) {
                winningPlay = play;
            }
        }

        // Nyertes ütése növelése
        const winner = this.players[winningPlay.playerIndex];
        winner.tricksWon++;

        // Következő ütés indítója
        this.trickStarterIndex = winningPlay.playerIndex;
        this.currentPlayerIndex = winningPlay.playerIndex;

        const trickResult = {
            winner: winner,
            winningCard: winningPlay.card,
            trick: this.currentTrick.map(t => ({ playerId: t.playerId, card: t.card.toJSON() }))
        };

        // Ütés törlése
        this.currentTrick = [];
        this.leadSuit = null;

        // Ha nincs több lap, kör vége
        if (this.players[0].hand.length === 0) {
            return this.endRound(trickResult);
        }

        const state = this.getGameState();
        state.trickResult = trickResult;
        return state;
    }

    /**
     * Kör vége - pontozás
     */
    endRound(lastTrickResult = null) {
        this.status = 'roundEnd';

        const roundData = this.scoreTable[this.currentRound - 1];

        for (const player of this.players) {
            let score = 0;

            if (player.bid === player.tricksWon) {
                // Eltalálta: +10 + ütések száma
                score = 10 + player.tricksWon;
            } else {
                // Nem találta el: -pont ahány ütéssel mellé
                score = -Math.abs(player.bid - player.tricksWon);
            }

            player.totalScore += score;

            // Eredménytáblába beírás
            const playerScore = roundData.players.find(p => p.playerId === player.id);
            if (playerScore) {
                playerScore.tricks = player.tricksWon;
                playerScore.score = score;
                playerScore.totalScore = player.totalScore;
            }
        }

        const state = this.getGameState();
        state.roundEnd = {
            round: this.currentRound,
            results: this.players.map(p => ({
                playerId: p.id,
                name: p.name,
                bid: p.bid,
                tricks: p.tricksWon,
                score: roundData.players.find(ps => ps.playerId === p.id)?.score || 0,
                totalScore: p.totalScore
            }))
        };

        if (lastTrickResult) {
            state.trickResult = lastTrickResult;
        }

        return state;
    }

    /**
     * Játék vége
     */
    endGame() {
        this.status = 'finished';

        // Rangsorolás
        const rankings = [...this.players]
            .sort((a, b) => b.totalScore - a.totalScore)
            .map((p, index) => ({
                position: index + 1,
                playerId: p.id,
                name: p.name,
                isAI: p.isAI,
                totalScore: p.totalScore
            }));

        return {
            ...this.getGameState(),
            rankings: rankings
        };
    }

    /**
     * Játék állapotának lekérdezése
     */
    getGameState() {
        return {
            gameId: this.gameId,
            roomId: this.roomId,
            status: this.status,
            currentRound: this.currentRound,
            totalRounds: this.maxRounds * 2 - 1,
            cardsPerRound: this.cardsPerRound,
            trumpCard: this.trumpCard ? this.trumpCard.toJSON() : null,
            trumpSuit: this.trumpSuit,
            currentPlayerIndex: this.currentPlayerIndex,
            currentPlayerId: this.players[this.currentPlayerIndex]?.id,
            dealerIndex: this.dealerIndex,
            allowEqualBids: this.allowEqualBids,
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                isAI: p.isAI,
                seatPosition: p.seatPosition,
                bid: p.bid,
                tricksWon: p.tricksWon,
                totalScore: p.totalScore,
                cardCount: p.hand.length,
                isConnected: p.isConnected
            })),
            currentTrick: this.currentTrick.map(t => ({
                playerId: t.playerId,
                card: t.card.toJSON()
            })),
            leadSuit: this.leadSuit,
            scoreTable: this.scoreTable
        };
    }

    /**
     * Játékos kézlapjainak lekérdezése
     */
    getPlayerHand(playerId) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return [];
        return player.hand.map(c => c.toJSON());
    }

    /**
     * Játékos állapotának lekérdezése
     */
    getPlayerState(playerId) {
        const state = this.getGameState();
        const player = this.players.find(p => p.id === playerId);

        if (player) {
            state.myHand = this.getPlayerHand(playerId);
            state.playableCards = this.getPlayableCards(playerId);
            state.isMyTurn = this.players[this.currentPlayerIndex]?.id === playerId;

            // Nem engedélyezett licitek kiszámítása
            if (this.status === 'bidding' && state.isMyTurn && !this.allowEqualBids && this.isLastBidder(this.players.indexOf(player))) {
                const totalBids = this.players.reduce((sum, p) => sum + (p.bid || 0), 0);
                const forbiddenBid = this.cardsPerRound - totalBids;
                if (forbiddenBid >= 0 && forbiddenBid <= this.cardsPerRound) {
                    state.forbiddenBid = forbiddenBid;
                }
            }
        }

        return state;
    }
}

module.exports = Game;
