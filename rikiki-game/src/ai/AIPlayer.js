const { Card } = require('../game/Card');

/**
 * AI játékos logika
 */
class AIPlayer {
    constructor(difficulty = 'medium') {
        this.difficulty = difficulty; // easy, medium, hard
    }

    /**
     * AI licit meghatározása
     */
    calculateBid(hand, trumpSuit, cardsPerRound, otherBids, isLastBidder, allowEqualBids) {
        let expectedTricks = 0;

        for (const card of hand) {
            const strength = card.getStrength();

            // Adu lapok értékelése
            if (card.suit === trumpSuit) {
                if (strength >= 10) { // J, Q, K, A
                    expectedTricks += 0.9;
                } else if (strength >= 7) {
                    expectedTricks += 0.6;
                } else {
                    expectedTricks += 0.3;
                }
            } else {
                // Nem adu lapok
                if (strength === 12) { // Ász
                    expectedTricks += 0.8;
                } else if (strength === 11) { // Király
                    expectedTricks += 0.5;
                } else if (strength === 10) { // Dáma
                    expectedTricks += 0.3;
                }
            }
        }

        // Nehézség szerinti módosítás
        if (this.difficulty === 'easy') {
            expectedTricks += (Math.random() - 0.5) * 2;
        } else if (this.difficulty === 'hard') {
            // Pontosabb becslés
        }

        let bid = Math.round(expectedTricks);
        bid = Math.max(0, Math.min(bid, cardsPerRound));

        // Utolsó licitáló ellenőrzése
        if (isLastBidder && !allowEqualBids) {
            const totalBids = otherBids.reduce((a, b) => a + b, 0);
            if (totalBids + bid === cardsPerRound) {
                // Módosítás szükséges
                if (bid > 0 && Math.random() > 0.5) {
                    bid--;
                } else if (bid < cardsPerRound) {
                    bid++;
                } else {
                    bid--;
                }
            }
        }

        return Math.max(0, Math.min(bid, cardsPerRound));
    }

    /**
     * AI lap kiválasztása
     */
    chooseCard(hand, playableCardIds, gameState) {
        const playableCards = hand.filter(c => playableCardIds.includes(c.id));

        if (playableCards.length === 0) {
            return null;
        }

        if (playableCards.length === 1) {
            return playableCards[0].id;
        }

        const { trumpSuit, currentTrick, leadSuit } = gameState;
        const player = gameState.players.find(p => p.id === gameState.currentPlayerId);
        const needsTricks = player ? player.bid > player.tricksWon : false;
        const hasEnoughTricks = player ? player.tricksWon >= player.bid : false;

        // Ha még ütés kell
        if (needsTricks) {
            return this.chooseWinningCard(playableCards, currentTrick, trumpSuit, leadSuit);
        }

        // Ha már elég ütés van, próbálj nem nyerni
        if (hasEnoughTricks) {
            return this.chooseLosingCard(playableCards, currentTrick, trumpSuit, leadSuit);
        }

        // Közepes stratégia
        return this.chooseMediumCard(playableCards, currentTrick, trumpSuit, leadSuit);
    }

    /**
     * Nyerő lap kiválasztása
     */
    chooseWinningCard(playableCards, currentTrick, trumpSuit, leadSuit) {
        let bestCard = null;
        let bestScore = -1;

        for (const card of playableCards) {
            let score = card.getStrength();

            // Adu bónusz
            if (card.suit === trumpSuit) {
                score += 20;
            }

            // Kezdőszín bónusz
            if (card.suit === leadSuit) {
                score += 10;
            }

            // Ellenőrzés, hogy ezzel nyernénk-e
            if (this.wouldWinTrick(card, currentTrick, trumpSuit, leadSuit)) {
                score += 50;
            }

            if (score > bestScore) {
                bestScore = score;
                bestCard = card;
            }
        }

        return bestCard ? bestCard.id : playableCards[0].id;
    }

    /**
     * Vesztő lap kiválasztása
     */
    chooseLosingCard(playableCards, currentTrick, trumpSuit, leadSuit) {
        let bestCard = null;
        let lowestScore = Infinity;

        for (const card of playableCards) {
            let score = card.getStrength();

            // Adu kerülése
            if (card.suit === trumpSuit) {
                score += 20;
            }

            // Kezdőszín kerülése, ha nyernénk vele
            if (card.suit === leadSuit && this.wouldWinTrick(card, currentTrick, trumpSuit, leadSuit)) {
                score += 30;
            }

            if (score < lowestScore) {
                lowestScore = score;
                bestCard = card;
            }
        }

        return bestCard ? bestCard.id : playableCards[0].id;
    }

    /**
     * Közepes lap kiválasztása
     */
    chooseMediumCard(playableCards, currentTrick, trumpSuit, leadSuit) {
        // Rendezzük erősség szerint
        const sorted = [...playableCards].sort((a, b) => a.getStrength() - b.getStrength());
        // Középső lapot válasszuk
        const midIndex = Math.floor(sorted.length / 2);
        return sorted[midIndex].id;
    }

    /**
     * Nyernénk-e az ütést ezzel a lappal
     */
    wouldWinTrick(card, currentTrick, trumpSuit, leadSuit) {
        if (currentTrick.length === 0) {
            return true; // Első lap, biztosan "nyerünk" eddig
        }

        let currentWinner = currentTrick[0];

        for (let i = 1; i < currentTrick.length; i++) {
            const play = currentTrick[i];
            if (this.beats(play.card, currentWinner.card, trumpSuit, leadSuit)) {
                currentWinner = play;
            }
        }

        return this.beats(card, currentWinner.card, trumpSuit, leadSuit);
    }

    /**
     * Üti-e az egyik lap a másikat
     */
    beats(card, other, trumpSuit, leadSuit) {
        // Rekonstruáljuk a Card objektumokat ha szükséges
        const cardSuit = card.suit || card.suit;
        const cardStrength = typeof card.getStrength === 'function' ? card.getStrength() : Card.VALUES.indexOf(card.value);
        const otherSuit = other.suit || other.suit;
        const otherStrength = typeof other.getStrength === 'function' ? other.getStrength() : Card.VALUES.indexOf(other.value);

        // Adu üt mindent (kivéve erősebb adut)
        if (cardSuit === trumpSuit && otherSuit !== trumpSuit) {
            return true;
        }
        if (cardSuit !== trumpSuit && otherSuit === trumpSuit) {
            return false;
        }

        // Mindkettő adu
        if (cardSuit === trumpSuit && otherSuit === trumpSuit) {
            return cardStrength > otherStrength;
        }

        // Egyik sem adu
        if (cardSuit === otherSuit) {
            return cardStrength > otherStrength;
        }

        // Különböző szín, egyik sem adu - kezdőszín nyer
        if (cardSuit === leadSuit) {
            return true;
        }

        return false;
    }

    /**
     * Gondolkodási idő szimulálása
     */
    getThinkingTime() {
        const base = this.difficulty === 'easy' ? 500 : this.difficulty === 'hard' ? 2000 : 1000;
        return base + Math.random() * 1000;
    }
}

module.exports = AIPlayer;
