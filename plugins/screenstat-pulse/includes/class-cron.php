<?php
/**
 * Daily readings, 09:00 Asia/Kolkata (HANDOVER.md §7). v1.0's compute() ran in PHP because the
 * WordPress container has no Node; v1.7's compute() grew a stochastic core, an industry table, an
 * event-calendar leg and post-release inference, and a hand port of that size is exactly the risk
 * the handover warns against ("do not let the PHP port drift"). Readings are now recorded by
 * pulse-worker (Node, imports pulse-model.js unchanged) via POST /films/{id}/readings with
 * source='cron', on its own schedule - see pulse-worker/scripts/daily-reading.js.
 *
 * What WP-Cron still does: a watchdog. If a tracked, filled film has no reading for today by
 * 10:00 IST, the worker did not run (or is not deployed yet) - this surfaces that as an admin
 * notice rather than silently producing a stale "Buzz over time" chart with no explanation.
 *
 * @package ScreenstatPulse
 */
defined( 'ABSPATH' ) || exit;

final class SSPulse_Cron {
	const HOOK = 'sspulse_reading_watchdog';
	const NOTICE_OPTION = 'sspulse_missing_readings';

	public static function init(): void {
		add_action( self::HOOK, array( __CLASS__, 'run' ) );
		add_action( 'init', array( __CLASS__, 'schedule' ) );   // self-heal if the event was lost
		add_action( 'admin_notices', array( __CLASS__, 'admin_notice' ) );
	}
	public static function next_ten_ist(): int {
		$tz = new DateTimeZone( 'Asia/Kolkata' ); $next = new DateTime( 'today 10:00', $tz );
		if ( $next->getTimestamp() <= time() ) { $next->modify( '+1 day' ); }
		return $next->getTimestamp();
	}
	public static function schedule(): void {
		if ( ! wp_next_scheduled( self::HOOK ) ) { wp_schedule_event( self::next_ten_ist(), 'daily', self::HOOK ); }
	}
	public static function unschedule(): void {
		$ts = wp_next_scheduled( self::HOOK ); if ( $ts ) { wp_unschedule_event( $ts, self::HOOK ); }
	}

	/** Lists tracked, filled films with no reading recorded today. Returns their titles. */
	public static function run(): array {
		global $wpdb;
		$today = ( new DateTime( 'now', new DateTimeZone( 'Asia/Kolkata' ) ) )->format( 'Y-m-d' );
		$missing = $wpdb->get_col( $wpdb->prepare(
			'SELECT f.title FROM ' . SSPulse_DB::table( 'films' ) . ' f
			 WHERE f.status = %s AND f.unfilled = 0
			 AND NOT EXISTS ( SELECT 1 FROM ' . SSPulse_DB::table( 'readings' ) . ' r WHERE r.film_id = f.id AND r.read_on = %s )',
			'tracking', $today
		) ); // phpcs:ignore WordPress.DB
		if ( $missing ) { update_option( self::NOTICE_OPTION, array( 'date' => $today, 'titles' => $missing ), false ); }
		else { delete_option( self::NOTICE_OPTION ); }
		return $missing;
	}

	public static function admin_notice(): void {
		if ( ! function_exists( 'get_current_screen' ) ) { return; }
		$screen = get_current_screen();
		if ( ! $screen || strpos( (string) $screen->id, 'screenstat-pulse' ) === false ) { return; }
		$state = get_option( self::NOTICE_OPTION );
		if ( ! is_array( $state ) || empty( $state['titles'] ) ) { return; }
		$today = ( new DateTime( 'now', new DateTimeZone( 'Asia/Kolkata' ) ) )->format( 'Y-m-d' );
		if ( $state['date'] !== $today ) { return; }   // yesterday's notice, waiting for today's 10:00 run
		printf(
			'<div class="notice notice-warning"><p><strong>Pulse:</strong> no reading recorded today for %s. The daily reading now comes from pulse-worker, not WordPress - check it is deployed and its cron is running (see the plugin README).</p></div>',
			esc_html( implode( ', ', $state['titles'] ) )
		);
	}
}
