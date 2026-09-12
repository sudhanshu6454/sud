<?php
/**
 * Plugin Name: Screenstat Pulse
 * Description: Pre-release intelligence for Indian films across six industries - Buzz Index, ticket intent and projected collection with uncertainty bands. Private admin app for the Screenstat desk, read-only figures for the site via [pulse] and the Pulse Figure block.
 * Version: 1.7.0
 * Requires at least: 6.4
 * Requires PHP: 8.0
 * Author: Screenstat
 * License: GPL-2.0-or-later
 * Text Domain: screenstat-pulse
 */

defined( 'ABSPATH' ) || exit;

define( 'SSPULSE_VERSION', '1.7.0' );
define( 'SSPULSE_DB_VERSION', '2' );
define( 'SSPULSE_FILE', __FILE__ );
define( 'SSPULSE_DIR', plugin_dir_path( __FILE__ ) );
define( 'SSPULSE_URL', plugin_dir_url( __FILE__ ) );

foreach ( array( 'model', 'validate', 'db', 'caps', 'seed', 'cron', 'rest', 'admin', 'shortcode' ) as $inc ) {
	require_once SSPULSE_DIR . "includes/class-$inc.php";
}

register_activation_hook( __FILE__, static function () {
	SSPulse_DB::install();
	SSPulse_Caps::add();
	SSPulse_Seed::calendar();
	SSPulse_Seed::industry();
	SSPulse_Cron::schedule();
} );
register_deactivation_hook( __FILE__, array( 'SSPulse_Cron', 'unschedule' ) );

add_action( 'plugins_loaded', static function () {
	SSPulse_DB::maybe_upgrade();
	SSPulse_Caps::ensure();            // idempotent: roles created after activation still get the caps
	SSPulse_Seed::maybe_calendar();    // one option read per request; imports calendar.json once per version of the file
	SSPulse_Seed::maybe_industry();    // one option read per request; seeds the industry table once
	SSPulse_Cron::init();
	SSPulse_Rest::init();
	SSPulse_Admin::init();
	SSPulse_Shortcode::init();
} );
