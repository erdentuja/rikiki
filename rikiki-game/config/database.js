const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// WordPress prefix
const WP_PREFIX = 'wp_';

// Adatbázis táblák létrehozása
async function initDatabase() {
    const connection = await pool.getConnection();

    try {
        // Játék beállítások tábla (WordPress kezeli, itt csak ellenőrizzük)
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS ${WP_PREFIX}rikiki_settings (
                id INT PRIMARY KEY AUTO_INCREMENT,
                setting_key VARCHAR(50) UNIQUE NOT NULL,
                setting_value VARCHAR(255) NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Alapértelmezett beállítások beszúrása
        const defaultSettings = [
            ['player_count', '4'],
            ['max_rounds', '10'],
            ['thinking_time', '30'],
            ['allow_equal_bids', '0']
        ];

        for (const [key, value] of defaultSettings) {
            await connection.execute(`
                INSERT IGNORE INTO ${WP_PREFIX}rikiki_settings (setting_key, setting_value)
                VALUES (?, ?)
            `, [key, value]);
        }

        // Játék szobák tábla
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS ${WP_PREFIX}rikiki_rooms (
                id INT PRIMARY KEY AUTO_INCREMENT,
                room_code VARCHAR(10) UNIQUE NOT NULL,
                status ENUM('waiting', 'playing', 'finished') DEFAULT 'waiting',
                player_count INT DEFAULT 4,
                current_round INT DEFAULT 0,
                max_rounds INT DEFAULT 10,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Játékosok a szobában
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS ${WP_PREFIX}rikiki_room_players (
                id INT PRIMARY KEY AUTO_INCREMENT,
                room_id INT NOT NULL,
                user_id BIGINT,
                player_name VARCHAR(100) NOT NULL,
                is_ai BOOLEAN DEFAULT FALSE,
                seat_position INT NOT NULL,
                is_ready BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Játék körök táblázat (vállalások és ütések)
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS ${WP_PREFIX}rikiki_rounds (
                id INT PRIMARY KEY AUTO_INCREMENT,
                room_id INT NOT NULL,
                round_number INT NOT NULL,
                card_count INT NOT NULL,
                trump_suit VARCHAR(10),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Játékos körönkénti adatok
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS ${WP_PREFIX}rikiki_player_rounds (
                id INT PRIMARY KEY AUTO_INCREMENT,
                round_id INT NOT NULL,
                player_id INT NOT NULL,
                bid INT DEFAULT NULL,
                tricks_won INT DEFAULT 0,
                score INT DEFAULT 0
            )
        `);

        // Felhasználói statisztikák
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS ${WP_PREFIX}rikiki_user_stats (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id BIGINT UNIQUE NOT NULL,
                games_played INT DEFAULT 0,
                games_won INT DEFAULT 0,
                total_score INT DEFAULT 0,
                highest_score INT DEFAULT 0,
                rank_points INT DEFAULT 1000,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Játék történet
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS ${WP_PREFIX}rikiki_game_history (
                id INT PRIMARY KEY AUTO_INCREMENT,
                room_id INT NOT NULL,
                user_id BIGINT,
                final_score INT NOT NULL,
                position INT NOT NULL,
                played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('Adatbázis táblák sikeresen létrehozva/ellenőrizve!');
    } catch (error) {
        console.error('Adatbázis hiba:', error);
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = { pool, initDatabase, WP_PREFIX };
