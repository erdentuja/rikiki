/**
 * Francia kártya osztály
 */
class Card {
    static SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
    static SUIT_SYMBOLS = {
        hearts: '♥',
        diamonds: '♦',
        clubs: '♣',
        spades: '♠'
    };
    static SUIT_NAMES = {
        hearts: 'Kőr',
        diamonds: 'Káró',
        clubs: 'Treff',
        spades: 'Pikk'
    };
    static VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    static VALUE_NAMES = {
        '2': 'Kettes',
        '3': 'Hármas',
        '4': 'Négyes',
        '5': 'Ötös',
        '6': 'Hatos',
        '7': 'Hetes',
        '8': 'Nyolcas',
        '9': 'Kilences',
        '10': 'Tízes',
        'J': 'Bubi',
        'Q': 'Dáma',
        'K': 'Király',
        'A': 'Ász'
    };

    constructor(suit, value) {
        this.suit = suit;
        this.value = value;
        this.id = `${suit}_${value}`;
    }

    /**
     * Kártya erősségének lekérdezése (0-12)
     */
    getStrength() {
        return Card.VALUES.indexOf(this.value);
    }

    /**
     * Kártya összehasonlítása másikkal (ugyanazon szín esetén)
     */
    compareTo(other) {
        return this.getStrength() - other.getStrength();
    }

    /**
     * Kártya JSON reprezentációja
     */
    toJSON() {
        return {
            id: this.id,
            suit: this.suit,
            value: this.value,
            symbol: Card.SUIT_SYMBOLS[this.suit],
            suitName: Card.SUIT_NAMES[this.suit],
            valueName: Card.VALUE_NAMES[this.value],
            strength: this.getStrength()
        };
    }

    /**
     * Kártya megjelenítési neve
     */
    toString() {
        return `${Card.SUIT_SYMBOLS[this.suit]}${this.value}`;
    }
}

/**
 * Pakli osztály
 */
class Deck {
    constructor() {
        this.cards = [];
        this.reset();
    }

    /**
     * Pakli visszaállítása és keverés
     */
    reset() {
        this.cards = [];
        for (const suit of Card.SUITS) {
            for (const value of Card.VALUES) {
                this.cards.push(new Card(suit, value));
            }
        }
        this.shuffle();
    }

    /**
     * Pakli keverése (Fisher-Yates algoritmus)
     */
    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    /**
     * Megadott számú lap osztása
     */
    deal(count) {
        return this.cards.splice(0, count);
    }

    /**
     * Egy lap húzása (adu meghatározáshoz)
     */
    drawOne() {
        return this.cards.shift();
    }

    /**
     * Maradt lapok száma
     */
    remaining() {
        return this.cards.length;
    }
}

module.exports = { Card, Deck };
