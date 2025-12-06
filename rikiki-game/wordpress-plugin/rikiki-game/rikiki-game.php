<?php
/**
 * Plugin Name: Rikiki Kártyajáték
 * Plugin URI: https://rikiki.test
 * Description: Rikiki (Oh Hell) kártyajáték WordPress-hez WebSocket alapokon
 * Version: 1.0.0
 * Author: Rikiki Dev
 * License: GPL v2 or later
 * Text Domain: rikiki-game
 */

if (!defined('ABSPATH')) {
    exit;
}

// Konstansok
define('RIKIKI_VERSION', '1.0.0');
define('RIKIKI_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('RIKIKI_PLUGIN_URL', plugin_dir_url(__FILE__));
define('RIKIKI_WS_PORT', 3002);

/**
 * Rikiki Játék fő osztály
 */
class RikikiGame {

    private static $instance = null;

    public static function getInstance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        add_action('init', array($this, 'init'));
        add_action('admin_menu', array($this, 'addAdminMenu'));
        add_action('admin_init', array($this, 'registerSettings'));
        add_action('wp_enqueue_scripts', array($this, 'enqueueScripts'));

        // Shortcode regisztráció
        add_shortcode('rikiki_game', array($this, 'gameShortcode'));
        add_shortcode('rikiki_leaderboard', array($this, 'leaderboardShortcode'));
        add_shortcode('rikiki_stats', array($this, 'statsShortcode'));

        // AJAX kezelők
        add_action('wp_ajax_rikiki_get_user_data', array($this, 'ajaxGetUserData'));
    }

    public function init() {
        // Plugin aktiváláskor táblák létrehozása
        if (get_option('rikiki_db_version') !== RIKIKI_VERSION) {
            $this->createTables();
            update_option('rikiki_db_version', RIKIKI_VERSION);
        }
    }

    /**
     * Adatbázis táblák létrehozása
     */
    private function createTables() {
        global $wpdb;

        $charset_collate = $wpdb->get_charset_collate();

        // Beállítások tábla
        $sql = "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}rikiki_settings (
            id INT PRIMARY KEY AUTO_INCREMENT,
            setting_key VARCHAR(50) UNIQUE NOT NULL,
            setting_value VARCHAR(255) NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) $charset_collate;";

        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);

        // Alapértelmezett beállítások
        $defaults = array(
            'player_count' => '4',
            'max_rounds' => '10',
            'thinking_time' => '30',
            'allow_equal_bids' => '0'
        );

        foreach ($defaults as $key => $value) {
            $wpdb->query($wpdb->prepare(
                "INSERT IGNORE INTO {$wpdb->prefix}rikiki_settings (setting_key, setting_value) VALUES (%s, %s)",
                $key, $value
            ));
        }

        // Felhasználói statisztikák
        $sql = "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}rikiki_user_stats (
            id INT PRIMARY KEY AUTO_INCREMENT,
            user_id BIGINT UNIQUE NOT NULL,
            games_played INT DEFAULT 0,
            games_won INT DEFAULT 0,
            total_score INT DEFAULT 0,
            highest_score INT DEFAULT 0,
            rank_points INT DEFAULT 1000,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) $charset_collate;";

        dbDelta($sql);
    }

    /**
     * Admin menü hozzáadása
     */
    public function addAdminMenu() {
        add_menu_page(
            'Rikiki Játék',
            'Rikiki',
            'manage_options',
            'rikiki-settings',
            array($this, 'adminPage'),
            'dashicons-games',
            30
        );

        add_submenu_page(
            'rikiki-settings',
            'Beállítások',
            'Beállítások',
            'manage_options',
            'rikiki-settings',
            array($this, 'adminPage')
        );

        add_submenu_page(
            'rikiki-settings',
            'Ranglista',
            'Ranglista',
            'manage_options',
            'rikiki-leaderboard',
            array($this, 'leaderboardPage')
        );
    }

    /**
     * Beállítások regisztrálása
     */
    public function registerSettings() {
        register_setting('rikiki_settings_group', 'rikiki_player_count');
        register_setting('rikiki_settings_group', 'rikiki_max_rounds');
        register_setting('rikiki_settings_group', 'rikiki_thinking_time');
        register_setting('rikiki_settings_group', 'rikiki_allow_equal_bids');
        register_setting('rikiki_settings_group', 'rikiki_ws_host');
    }

    /**
     * Admin beállítások oldal
     */
    public function adminPage() {
        global $wpdb;

        // Beállítások mentése
        if (isset($_POST['rikiki_save_settings']) && wp_verify_nonce($_POST['rikiki_nonce'], 'rikiki_settings')) {
            $settings = array(
                'player_count' => intval($_POST['player_count']),
                'max_rounds' => intval($_POST['max_rounds']),
                'thinking_time' => intval($_POST['thinking_time']),
                'allow_equal_bids' => isset($_POST['allow_equal_bids']) ? '1' : '0'
            );

            foreach ($settings as $key => $value) {
                $wpdb->query($wpdb->prepare(
                    "INSERT INTO {$wpdb->prefix}rikiki_settings (setting_key, setting_value)
                     VALUES (%s, %s)
                     ON DUPLICATE KEY UPDATE setting_value = %s",
                    $key, $value, $value
                ));
            }

            echo '<div class="notice notice-success"><p>Beállítások mentve!</p></div>';
        }

        // Aktuális beállítások lekérdezése
        $settings = $this->getSettings();
        ?>
        <div class="wrap">
            <h1>Rikiki Játék Beállítások</h1>

            <form method="post" action="">
                <?php wp_nonce_field('rikiki_settings', 'rikiki_nonce'); ?>

                <table class="form-table">
                    <tr>
                        <th scope="row">
                            <label for="player_count">Játékosok száma</label>
                        </th>
                        <td>
                            <select name="player_count" id="player_count">
                                <?php for ($i = 3; $i <= 6; $i++): ?>
                                    <option value="<?php echo $i; ?>" <?php selected($settings['player_count'], $i); ?>>
                                        <?php echo $i; ?> játékos
                                    </option>
                                <?php endfor; ?>
                            </select>
                            <p class="description">Egy játékban résztvevő játékosok száma (AI-val kiegészítve)</p>
                        </td>
                    </tr>

                    <tr>
                        <th scope="row">
                            <label for="max_rounds">Maximum körök száma</label>
                        </th>
                        <td>
                            <input type="number" name="max_rounds" id="max_rounds"
                                   value="<?php echo esc_attr($settings['max_rounds']); ?>"
                                   min="1" max="13" class="small-text">
                            <p class="description">Lapok száma felfutáskor (1-től eddig, majd vissza)</p>
                        </td>
                    </tr>

                    <tr>
                        <th scope="row">
                            <label for="thinking_time">Gondolkodási idő (mp)</label>
                        </th>
                        <td>
                            <input type="number" name="thinking_time" id="thinking_time"
                                   value="<?php echo esc_attr($settings['thinking_time']); ?>"
                                   min="10" max="120" class="small-text">
                            <p class="description">Maximum gondolkodási idő másodpercben</p>
                        </td>
                    </tr>

                    <tr>
                        <th scope="row">
                            <label for="allow_equal_bids">Vállalások összege</label>
                        </th>
                        <td>
                            <label>
                                <input type="checkbox" name="allow_equal_bids" id="allow_equal_bids"
                                       value="1" <?php checked($settings['allow_equal_bids'], '1'); ?>>
                                Engedélyezze, hogy a vállalások összege egyenlő legyen a lapok számával
                            </label>
                            <p class="description">Ha nincs bejelölve, az utolsó játékos nem licitálhat úgy, hogy kijöjjön</p>
                        </td>
                    </tr>
                </table>

                <h2>WebSocket szerver</h2>
                <table class="form-table">
                    <tr>
                        <th scope="row">Szerver állapot</th>
                        <td>
                            <span id="ws-status" style="padding: 5px 15px; border-radius: 20px; background: #ccc;">
                                Ellenőrzés...
                            </span>
                            <script>
                                (function() {
                                    var ws = new WebSocket('ws://localhost:<?php echo RIKIKI_WS_PORT; ?>');
                                    var status = document.getElementById('ws-status');
                                    ws.onopen = function() {
                                        status.style.background = '#46b450';
                                        status.style.color = 'white';
                                        status.textContent = 'Fut';
                                        ws.close();
                                    };
                                    ws.onerror = function() {
                                        status.style.background = '#dc3232';
                                        status.style.color = 'white';
                                        status.textContent = 'Nem fut';
                                    };
                                })();
                            </script>
                            <p class="description">
                                WebSocket szerver: <code>ws://localhost:<?php echo RIKIKI_WS_PORT; ?></code><br>
                                Indítás: <code>cd rikiki-game && npm start</code>
                            </p>
                        </td>
                    </tr>
                </table>

                <h2>Shortcode-ok</h2>
                <table class="form-table">
                    <tr>
                        <th scope="row">Játék</th>
                        <td><code>[rikiki_game]</code> - A játék megjelenítése</td>
                    </tr>
                    <tr>
                        <th scope="row">Ranglista</th>
                        <td><code>[rikiki_leaderboard]</code> - Top játékosok listája</td>
                    </tr>
                    <tr>
                        <th scope="row">Statisztikák</th>
                        <td><code>[rikiki_stats]</code> - Bejelentkezett felhasználó statisztikái</td>
                    </tr>
                </table>

                <p class="submit">
                    <input type="submit" name="rikiki_save_settings" class="button-primary" value="Beállítások mentése">
                </p>
            </form>
        </div>
        <?php
    }

    /**
     * Ranglista admin oldal
     */
    public function leaderboardPage() {
        global $wpdb;

        $leaders = $wpdb->get_results("
            SELECT
                rus.*,
                u.display_name,
                u.user_email
            FROM {$wpdb->prefix}rikiki_user_stats rus
            LEFT JOIN {$wpdb->users} u ON rus.user_id = u.ID
            ORDER BY rus.rank_points DESC
            LIMIT 100
        ");
        ?>
        <div class="wrap">
            <h1>Rikiki Ranglista</h1>

            <table class="wp-list-table widefat fixed striped">
                <thead>
                    <tr>
                        <th style="width: 50px;">#</th>
                        <th>Játékos</th>
                        <th>Játékok</th>
                        <th>Győzelmek</th>
                        <th>Össz. pont</th>
                        <th>Legjobb</th>
                        <th>Rang pont</th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($leaders)): ?>
                        <tr>
                            <td colspan="7">Még nincsenek játékosok.</td>
                        </tr>
                    <?php else: ?>
                        <?php foreach ($leaders as $i => $player): ?>
                            <tr>
                                <td><?php echo $i + 1; ?></td>
                                <td>
                                    <?php echo esc_html($player->display_name ?: 'Ismeretlen'); ?>
                                    <br><small><?php echo esc_html($player->user_email); ?></small>
                                </td>
                                <td><?php echo intval($player->games_played); ?></td>
                                <td><?php echo intval($player->games_won); ?></td>
                                <td><?php echo intval($player->total_score); ?></td>
                                <td><?php echo intval($player->highest_score); ?></td>
                                <td><strong><?php echo intval($player->rank_points); ?></strong></td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </tbody>
            </table>
        </div>
        <?php
    }

    /**
     * Beállítások lekérdezése
     */
    public function getSettings() {
        global $wpdb;

        $rows = $wpdb->get_results(
            "SELECT setting_key, setting_value FROM {$wpdb->prefix}rikiki_settings",
            ARRAY_A
        );

        $settings = array(
            'player_count' => '4',
            'max_rounds' => '10',
            'thinking_time' => '30',
            'allow_equal_bids' => '0'
        );

        if ($rows) {
            foreach ($rows as $row) {
                $settings[$row['setting_key']] = $row['setting_value'];
            }
        }

        return $settings;
    }

    /**
     * Scriptek és stílusok betöltése
     */
    public function enqueueScripts() {
        if (!is_user_logged_in()) {
            return;
        }

        // CSS
        wp_enqueue_style(
            'rikiki-game-style',
            RIKIKI_PLUGIN_URL . 'assets/css/style.css',
            array(),
            RIKIKI_VERSION
        );

        // JavaScript
        wp_enqueue_script(
            'rikiki-game-script',
            RIKIKI_PLUGIN_URL . 'assets/js/game.js',
            array(),
            RIKIKI_VERSION,
            true
        );

        // Felhasználó adatok átadása
        $user = wp_get_current_user();
        wp_localize_script('rikiki-game-script', 'rikikiConfig', array(
            'userId' => $user->ID,
            'userName' => $user->display_name,
            'wsUrl' => 'ws://' . $_SERVER['HTTP_HOST'] . ':' . RIKIKI_WS_PORT,
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('rikiki_ajax')
        ));
    }

    /**
     * Játék shortcode
     */
    public function gameShortcode($atts) {
        if (!is_user_logged_in()) {
            return '<div class="rikiki-login-required">
                <p>A játékhoz be kell jelentkezned!</p>
                <a href="' . wp_login_url(get_permalink()) . '" class="button">Bejelentkezés</a>
            </div>';
        }

        $user = wp_get_current_user();

        ob_start();
        ?>
        <div id="rikiki-game" class="rikiki-game">
            <div class="waiting-screen">
                <div class="loading-spinner"></div>
                <p>Csatlakozás a szerverhez...</p>
            </div>
        </div>

        <script>
            document.addEventListener('DOMContentLoaded', function() {
                if (typeof initRikikiGame === 'function') {
                    initRikikiGame({
                        userId: <?php echo $user->ID; ?>,
                        userName: '<?php echo esc_js($user->display_name); ?>',
                        wsUrl: 'ws://<?php echo $_SERVER['HTTP_HOST']; ?>:<?php echo RIKIKI_WS_PORT; ?>'
                    });
                }
            });
        </script>
        <?php
        return ob_get_clean();
    }

    /**
     * Ranglista shortcode
     */
    public function leaderboardShortcode($atts) {
        global $wpdb;

        $atts = shortcode_atts(array(
            'limit' => 10
        ), $atts);

        $leaders = $wpdb->get_results($wpdb->prepare("
            SELECT
                rus.*,
                u.display_name
            FROM {$wpdb->prefix}rikiki_user_stats rus
            LEFT JOIN {$wpdb->users} u ON rus.user_id = u.ID
            ORDER BY rus.rank_points DESC
            LIMIT %d
        ", intval($atts['limit'])));

        ob_start();
        ?>
        <div class="rikiki-leaderboard">
            <h3>Ranglista</h3>
            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Játékos</th>
                        <th>Pontok</th>
                        <th>Győzelmek</th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($leaders)): ?>
                        <tr><td colspan="4">Még nincsenek játékosok.</td></tr>
                    <?php else: ?>
                        <?php foreach ($leaders as $i => $player): ?>
                            <tr>
                                <td><?php echo $i + 1; ?></td>
                                <td><?php echo esc_html($player->display_name ?: 'Névtelen'); ?></td>
                                <td><?php echo intval($player->rank_points); ?></td>
                                <td><?php echo intval($player->games_won); ?></td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </tbody>
            </table>
        </div>
        <?php
        return ob_get_clean();
    }

    /**
     * Statisztikák shortcode
     */
    public function statsShortcode($atts) {
        if (!is_user_logged_in()) {
            return '<p>Jelentkezz be a statisztikáid megtekintéséhez!</p>';
        }

        global $wpdb;
        $user_id = get_current_user_id();

        $stats = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$wpdb->prefix}rikiki_user_stats WHERE user_id = %d",
            $user_id
        ));

        if (!$stats) {
            $stats = (object) array(
                'games_played' => 0,
                'games_won' => 0,
                'total_score' => 0,
                'highest_score' => 0,
                'rank_points' => 1000
            );
        }

        ob_start();
        ?>
        <div class="rikiki-stats">
            <h3>Statisztikáid</h3>
            <div class="stats-grid">
                <div class="stat-box">
                    <span class="stat-value"><?php echo intval($stats->games_played); ?></span>
                    <span class="stat-label">Játék</span>
                </div>
                <div class="stat-box">
                    <span class="stat-value"><?php echo intval($stats->games_won); ?></span>
                    <span class="stat-label">Győzelem</span>
                </div>
                <div class="stat-box">
                    <span class="stat-value"><?php echo intval($stats->total_score); ?></span>
                    <span class="stat-label">Össz. pont</span>
                </div>
                <div class="stat-box">
                    <span class="stat-value"><?php echo intval($stats->highest_score); ?></span>
                    <span class="stat-label">Legjobb</span>
                </div>
                <div class="stat-box featured">
                    <span class="stat-value"><?php echo intval($stats->rank_points); ?></span>
                    <span class="stat-label">Rang</span>
                </div>
            </div>
        </div>
        <?php
        return ob_get_clean();
    }

    /**
     * AJAX: Felhasználó adatok
     */
    public function ajaxGetUserData() {
        check_ajax_referer('rikiki_ajax', 'nonce');

        if (!is_user_logged_in()) {
            wp_send_json_error('Nem vagy bejelentkezve');
        }

        $user = wp_get_current_user();

        wp_send_json_success(array(
            'userId' => $user->ID,
            'userName' => $user->display_name,
            'userEmail' => $user->user_email
        ));
    }
}

// Plugin inicializálás
RikikiGame::getInstance();

// Aktiváláskor
register_activation_hook(__FILE__, function() {
    RikikiGame::getInstance();
    flush_rewrite_rules();
});

// Deaktiváláskor
register_deactivation_hook(__FILE__, function() {
    flush_rewrite_rules();
});
