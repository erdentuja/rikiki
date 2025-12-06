/**
 * Rikiki játék kliens
 */
class RikikiGame {
    constructor(config) {
        this.userId = config.userId;
        this.userName = config.userName;
        this.wsUrl = config.wsUrl || 'ws://localhost:3002';

        this.ws = null;
        this.gameState = null;
        this.playerId = null;
        this.selectedCard = null;

        this.container = document.getElementById('rikiki-game');

        this.connect();
    }

    /**
     * WebSocket kapcsolat
     */
    connect() {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
            console.log('Kapcsolódva a szerverhez');
            this.authenticate();
        };

        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
        };

        this.ws.onclose = () => {
            console.log('Kapcsolat bontva');
            this.showToast('Kapcsolat megszakadt. Újracsatlakozás...', 'error');
            setTimeout(() => this.connect(), 3000);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket hiba:', error);
        };
    }

    /**
     * Azonosítás küldése
     */
    authenticate() {
        this.send({
            type: 'auth',
            userId: this.userId,
            userName: this.userName
        });
    }

    /**
     * Üzenet küldése
     */
    send(message) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    /**
     * Üzenet kezelése
     */
    handleMessage(message) {
        console.log('Üzenet:', message.type, message);

        switch (message.type) {
            case 'authSuccess':
                this.playerId = message.data.playerId;
                this.gameState = message.data.gameState;
                this.render();
                break;

            case 'playerJoined':
                this.showToast(`${message.data.playerName} csatlakozott!`);
                break;

            case 'gameStarted':
            case 'gameState':
                this.gameState = message.data;
                this.render();

                // Ha licitálás vége, mutassuk a modalt
                if (message.data.biddingEnd) {
                    this.showBiddingEnd(message.data.biddingEnd);
                }

                // Ha kör vége, mutassuk a modal-t
                if (message.data.roundEnd) {
                    this.showRoundEnd(message.data.roundEnd);
                }

                // Ha játék vége
                if (message.data.status === 'finished' && message.data.rankings) {
                    this.showGameEnd(message.data.rankings);
                }
                break;

            case 'error':
                this.showToast(message.message, 'error');
                break;

            case 'gameRestarted':
                // Admin újraindította a játékot
                this.showToast('A játék újraindult. Csatlakozz újra!', 'error');
                setTimeout(() => {
                    location.reload();
                }, 2000);
                break;

            default:
                console.log('Ismeretlen üzenet:', message);
        }
    }

    /**
     * Fő renderelés
     */
    render() {
        if (!this.gameState) {
            this.renderLoading();
            return;
        }

        switch (this.gameState.status) {
            case 'waiting':
                this.renderWaiting();
                break;
            case 'bidding':
                this.renderGame();
                this.renderBidding();
                break;
            case 'playing':
            case 'roundEnd':
                this.renderGame();
                break;
            default:
                this.renderGame();
        }
    }

    /**
     * Betöltő képernyő
     */
    renderLoading() {
        this.container.innerHTML = `
            <div class="waiting-screen">
                <div class="loading-spinner"></div>
                <p>Csatlakozás...</p>
            </div>
        `;
    }

    /**
     * Várakozó képernyő
     */
    renderWaiting() {
        const players = this.gameState.players || [];
        const maxPlayers = this.gameState.playerCount || 4;

        let playersHtml = '';
        for (let i = 0; i < maxPlayers; i++) {
            if (players[i]) {
                playersHtml += `
                    <div class="waiting-player ${players[i].isAI ? 'ai' : ''}">
                        ${players[i].isAI ? '🤖 ' : ''}${players[i].name}
                    </div>
                `;
            } else {
                playersHtml += `
                    <div class="waiting-player empty">
                        Várakozás...
                    </div>
                `;
            }
        }

        this.container.innerHTML = `
            <div class="waiting-screen">
                <h1 class="waiting-title">Rikiki</h1>
                <p>Szoba kód: <strong>${this.gameState.roomId}</strong></p>
                <div class="waiting-players">
                    ${playersHtml}
                </div>
                <p>${players.length} / ${maxPlayers} játékos</p>
                <button class="btn btn-primary" onclick="game.startGame()">
                    Játék indítása (AI-val kiegészítve)
                </button>
            </div>
        `;
    }

    /**
     * Játék képernyő
     */
    renderGame() {
        const state = this.gameState;
        const myIndex = state.players.findIndex(p => p.id === this.playerId);

        // Ellenfelek (mindenki, aki nem én vagyok)
        const opponents = state.players.filter((p, i) => i !== myIndex);

        // Ellenfelek HTML
        let opponentsHtml = opponents.map(p => this.renderOpponent(p, state)).join('');

        // Adu
        let trumpHtml = '';
        if (state.trumpCard) {
            trumpHtml = `
                <div class="trump-area">
                    <div class="trump-label">Adu</div>
                    ${this.renderCard(state.trumpCard, false, false, true)}
                </div>
            `;
        }

        // Lerakott lapok
        let playedCardsHtml = state.currentTrick.map(t => {
            const player = state.players.find(p => p.id === t.playerId);
            return `
                <div class="played-card-wrapper">
                    <div class="played-card-player">${player ? player.name : '?'}</div>
                    ${this.renderCard(t.card, false, false)}
                </div>
            `;
        }).join('');

        // Saját lapok
        const myHand = state.myHand || [];
        const playableCards = state.playableCards || [];
        const isMyTurn = state.isMyTurn && state.status === 'playing';

        let myCardsHtml = myHand.map(card => {
            const isPlayable = isMyTurn && playableCards.includes(card.id);
            const isSelected = this.selectedCard === card.id;
            return this.renderCard(card, isPlayable, isSelected);
        }).join('');

        // Saját info
        const me = state.players[myIndex];

        this.container.innerHTML = `
            <div class="game-header">
                <div class="game-title">Rikiki</div>
                <div class="game-info">
                    <span>Kör: ${state.currentRound} / ${state.totalRounds}</span>
                    <span>Lapok: ${state.cardsPerRound}</span>
                    <span>Adu: ${state.trumpCard ? state.trumpCard.suitName : '-'}</span>
                </div>
            </div>

            <div class="game-main-wrapper">
                <div class="game-content">
                    <div class="opponents-row">
                        ${opponentsHtml}
                    </div>

                    <div class="game-table trump-${state.trumpSuit || ''}">
                        ${trumpHtml}
                        <div class="played-cards">
                            ${playedCardsHtml || '<p style="color: #666;">Még nincs lerakott lap</p>'}
                        </div>
                    </div>

                    <div class="player-area">
                        <div class="player-info">
                            <div class="player-name">${me ? me.name : 'Te'}</div>
                            <div class="player-stats">
                                <span class="player-stat">Vállalás: ${me && me.bid !== null ? me.bid : '-'}</span>
                                <span class="player-stat">Ütések: ${me ? me.tricksWon : 0}</span>
                                <span class="player-stat">Összesen: ${me ? me.totalScore : 0}</span>
                            </div>
                        </div>
                        <div class="player-hand" id="player-hand">
                            ${myCardsHtml}
                        </div>
                        <div id="bidding-container"></div>
                    </div>
                </div>

                ${this.renderScoreTable()}
            </div>
        `;
    }

    /**
     * Ellenfél doboz renderelése
     */
    renderOpponent(player, state) {
        const isActive = state.currentPlayerId === player.id;
        const aiClass = player.isAI ? 'ai' : '';

        let cardsHtml = '';
        for (let i = 0; i < player.cardCount; i++) {
            cardsHtml += '<div class="card-back"></div>';
        }

        return `
            <div class="opponent-box ${isActive ? 'active' : ''} ${aiClass}">
                <div class="opponent-name">${player.name}</div>
                <div class="opponent-stats">
                    <span>V: ${player.bid !== null ? player.bid : '-'}</span>
                    <span>Ü: ${player.tricksWon}</span>
                    <span>P: ${player.totalScore}</span>
                </div>
                <div class="opponent-cards">
                    ${cardsHtml}
                </div>
            </div>
        `;
    }

    /**
     * Kártya renderelése
     */
    renderCard(card, isPlayable = false, isSelected = false, isTrump = false) {
        const classes = [
            'card',
            card.suit,
            isPlayable ? 'playable' : '',
            isSelected ? 'selected' : '',
            !isPlayable && !isTrump ? 'disabled' : ''
        ].filter(c => c).join(' ');

        const onclick = isPlayable ? `onclick="game.selectCard('${card.id}')"` : '';

        return `
            <div class="${classes}" ${onclick} data-card-id="${card.id}">
                <div class="card-corner">${card.value}${card.symbol}</div>
                <div class="card-center">${card.symbol}</div>
                <div class="card-corner bottom">${card.value}${card.symbol}</div>
            </div>
        `;
    }

    /**
     * Licitálás renderelése
     */
    renderBidding() {
        if (this.gameState.status !== 'bidding' || !this.gameState.isMyTurn) {
            return;
        }

        const maxBid = this.gameState.cardsPerRound;
        const forbiddenBid = this.gameState.forbiddenBid;

        let forbiddenHtml = '';
        if (forbiddenBid !== undefined) {
            forbiddenHtml = `<p class="bid-forbidden">Nem licitálhatsz ${forbiddenBid}-t!</p>`;
        }

        const biddingHtml = `
            <div class="bidding-area">
                <h3 class="bidding-title">Hány ütést vállalsz?</h3>
                ${forbiddenHtml}
                <div class="bid-slider-container">
                    <input type="range" class="bid-slider" id="bid-slider"
                           min="0" max="${maxBid}" value="0">
                    <div class="bid-value" id="bid-value">0</div>
                </div>
                <button class="btn btn-primary" id="bid-button">
                    Licit leadása
                </button>
            </div>
        `;

        const container = document.getElementById('bidding-container');
        container.innerHTML = biddingHtml;

        // Eseménykezelők hozzáadása
        const slider = document.getElementById('bid-slider');
        const bidValue = document.getElementById('bid-value');
        const bidButton = document.getElementById('bid-button');

        const self = this;

        slider.addEventListener('input', function() {
            bidValue.textContent = this.value;

            if (forbiddenBid !== undefined && parseInt(this.value) === forbiddenBid) {
                bidButton.disabled = true;
                bidButton.textContent = 'Ez a licit nem engedélyezett!';
            } else {
                bidButton.disabled = false;
                bidButton.textContent = 'Licit leadása';
            }
        });

        bidButton.addEventListener('click', function() {
            const bid = parseInt(slider.value);
            self.send({
                type: 'bid',
                bid: bid
            });
        });
    }

    /**
     * Licit érték frissítése
     */
    updateBidDisplay(value) {
        document.getElementById('bid-value').textContent = value;

        const forbiddenBid = this.gameState.forbiddenBid;
        const button = document.getElementById('bid-button');

        if (forbiddenBid !== undefined && parseInt(value) === forbiddenBid) {
            button.disabled = true;
            button.textContent = 'Ez a licit nem engedélyezett!';
        } else {
            button.disabled = false;
            button.textContent = 'Licit leadása';
        }
    }

    /**
     * Licit leadása
     */
    placeBid() {
        const bid = parseInt(document.getElementById('bid-slider').value);
        this.send({
            type: 'bid',
            bid: bid
        });
    }

    /**
     * Lap kiválasztása
     */
    selectCard(cardId) {
        if (this.selectedCard === cardId) {
            // Dupla klikk = kijátszás
            this.playCard(cardId);
        } else {
            this.selectedCard = cardId;
            this.highlightCard(cardId);
        }
    }

    /**
     * Lap kiemelése
     */
    highlightCard(cardId) {
        document.querySelectorAll('.card').forEach(el => {
            el.classList.remove('selected');
            if (el.dataset.cardId === cardId) {
                el.classList.add('selected');
            }
        });
    }

    /**
     * Lap kijátszása
     */
    playCard(cardId) {
        this.send({
            type: 'playCard',
            cardId: cardId
        });
        this.selectedCard = null;
    }

    /**
     * Játék indítása
     */
    startGame() {
        this.send({
            type: 'startGame'
        });
    }

    /**
     * Eredménytábla renderelése
     */
    renderScoreTable() {
        if (!this.gameState.scoreTable || this.gameState.scoreTable.length === 0) {
            return '';
        }

        const players = this.gameState.players;
        const scoreTable = this.gameState.scoreTable;
        const currentRound = this.gameState.currentRound;

        let headerHtml = '<th>Kör</th>';
        players.forEach(p => {
            headerHtml += `<th>${p.name.substring(0, 6)}</th>`;
        });

        let rowsHtml = '';
        scoreTable.forEach((round, index) => {
            const isCurrent = index + 1 === currentRound;
            rowsHtml += `<tr class="${isCurrent ? 'current-round' : ''}">`;
            rowsHtml += `<td>${round.cardCount}</td>`;

            round.players.forEach(ps => {
                let cellContent = '';
                if (ps.bid !== null) {
                    cellContent = `${ps.bid}`;
                    if (ps.tricks !== null) {
                        cellContent += `/${ps.tricks}`;
                        if (ps.score !== null) {
                            const scoreClass = ps.score >= 0 ? 'score-positive' : 'score-negative';
                            cellContent += ` <span class="${scoreClass}">(${ps.score > 0 ? '+' : ''}${ps.score})</span>`;
                        }
                    }
                } else {
                    cellContent = '-';
                }
                rowsHtml += `<td>${cellContent}</td>`;
            });

            rowsHtml += '</tr>';
        });

        // Összesen sor
        rowsHtml += '<tr style="font-weight: bold; background: rgba(212, 175, 55, 0.2);">';
        rowsHtml += '<td>Össz</td>';
        players.forEach(p => {
            rowsHtml += `<td>${p.totalScore}</td>`;
        });
        rowsHtml += '</tr>';

        return `
            <div class="score-table-container">
                <table class="score-table">
                    <thead>
                        <tr>${headerHtml}</tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `;
    }

    /**
     * Licitálás vége modal
     */
    showBiddingEnd(biddingEnd) {
        const { totalBids, cardCount, players } = biddingEnd;
        const diff = totalBids - cardCount;

        let title, message, emoji;

        if (totalBids < cardCount) {
            title = 'Harc lesz az ütésekért!';
            message = `Ja nem! 😄`;
            emoji = '😌';
        } else if (totalBids > cardCount) {
            title = 'Harc lesz az ütésekért!';
            message = `Ja de! 😄`;
            emoji = '😬';
        } else {
            title = 'Pontosan kijön!';
            message = 'Érdekes lesz! 🤔';
            emoji = '🎯';
        }

        // Játékosok vállalásai
        let bidsHtml = players.map(p => `
            <div class="bid-summary-row">
                <span>${p.name}</span>
                <span class="bid-amount">${p.bid}</span>
            </div>
        `).join('');

        const modal = document.createElement('div');
        modal.className = 'bidding-end-modal';
        modal.innerHTML = `
            <div class="bidding-end-content">
                <div class="bidding-end-emoji">${emoji}</div>
                <h2 class="bidding-end-title">${title}</h2>
                <p class="bidding-end-message">${message}</p>
                <div class="bid-summary">
                    ${bidsHtml}
                    <div class="bid-summary-total">
                        <span>Összesen: ${totalBids} / ${cardCount} lap</span>
                    </div>
                </div>
            </div>
        `;

        this.container.appendChild(modal);

        setTimeout(() => {
            modal.remove();
        }, 2500);
    }

    /**
     * Kör vége modal
     */
    showRoundEnd(roundEnd) {
        let resultsHtml = roundEnd.results.map(r => {
            const scoreClass = r.score >= 0 ? 'score-positive' : 'score-negative';
            return `
                <div class="round-result-row">
                    <span>${r.name}</span>
                    <span>V: ${r.bid} / Ü: ${r.tricks}</span>
                    <span class="${scoreClass}">${r.score > 0 ? '+' : ''}${r.score}</span>
                </div>
            `;
        }).join('');

        const modal = document.createElement('div');
        modal.className = 'round-end-modal';
        modal.innerHTML = `
            <div class="round-end-content">
                <h2 class="round-end-title">${roundEnd.round}. kör vége!</h2>
                <div class="round-results">
                    ${resultsHtml}
                </div>
                <p>Következő kör indul...</p>
            </div>
        `;

        this.container.appendChild(modal);

        setTimeout(() => {
            modal.remove();
        }, 2500);
    }

    /**
     * Játék vége modal
     */
    showGameEnd(rankings) {
        let rankingsHtml = rankings.map((r, i) => {
            const isFirst = i === 0;
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
            return `
                <div class="ranking-row ${isFirst ? 'first' : ''}">
                    <span class="ranking-position">${medal || (i + 1) + '.'}</span>
                    <span class="ranking-name">${r.name} ${r.isAI ? '🤖' : ''}</span>
                    <span class="ranking-score">${r.totalScore} pont</span>
                </div>
            `;
        }).join('');

        const modal = document.createElement('div');
        modal.className = 'game-end-modal';
        modal.innerHTML = `
            <div class="game-end-content">
                <h2 class="game-end-title">Játék vége!</h2>
                <div class="rankings">
                    ${rankingsHtml}
                </div>
                <button class="btn btn-primary" onclick="location.reload()">
                    Új játék
                </button>
            </div>
        `;

        this.container.appendChild(modal);
    }

    /**
     * Toast üzenet
     */
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.style.borderColor = type === 'error' ? 'var(--danger)' : 'var(--accent-color)';
        toast.textContent = message;

        this.container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}

// Globális változó az inicializáláshoz
let game = null;

function initRikikiGame(config) {
    game = new RikikiGame(config);
}
