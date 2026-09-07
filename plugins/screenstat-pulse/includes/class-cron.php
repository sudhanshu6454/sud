<?php
/**
 * Daily readings at 09:00 Asia/Kolkata (HANDOVER.md §7). The model runs in PHP (SSPulse_Model,
 * proven equal to the JS module by tests/model-equality.php) because the WordPress container has
 * no Node. One reading per film per day: the row is upserted, so a manual "Record today's reading"
 * after the cron replaces it rather than adding a second.
 *
 * @package ScreenstatPulse
 */
defined( 'ABSPATH' ) || exit;

final class SSPulse_Cron {
	const HOOK = 'sspulse_daily_reading';

	public static function init(): void {
		add_action( self::HOOK, array( __CLASS__, 'run' ) );
		add_action( 'init', array( __CLASS__, 'schedule' ) );   // self-heal if the event was lost
	}
	public static function next_nine_ist(): int {
		$tz = new DateTimeZone( 'Asia/Kolkata' ); $next = new DateTime( 'today 09:00', $tz );
		if ( $next->getTimestamp() <= time() ) { $next->modify( '+1 day' ); }
		return $next->getTimestamp();
	}
	public static function schedule(): void {
		if ( ! wp_next_scheduled( self::HOOK ) ) { wp_schedule_event( self::next_nine_ist(), 'daily', self::HOOK ); }
	}
	public static function unschedule(): void {
		$ts = wp_next_scheduled( self::HOOK ); if ( $ts ) { wp_unschedule_event( $ts, self::HOOK ); }
	}

	/** Records today's reading for every tracking, filled film. Returns the number written. */
	public static function run(): int {
		global $wpdb;
		$films = $wpdb->get_results( 'SELECT * FROM ' . SSPulse_DB::table( 'films' ) . " WHERE status = 'tracking' AND unfilled = 0", ARRAY_A ); // phpcs:ignore WordPress.DB
		$today = ( new DateTime( 'now', new DateTimeZone( 'Asia/Kolkata' ) ) )->format( 'Y-m-d' );
		$n = 0;
		foreach ( $films as $f ) {
			$signals = json_decode( $f['signals'], true ) ?: array();
			$samples = $wpdb->get_results( $wpdb->prepare( 'SELECT src, n, def_ct AS def, prob_ct AS prob, ott_ct AS ott, no_ct AS no FROM ' . SSPulse_DB::table( 'samples' ) . ' WHERE film_id = %d', $f['id'] ), ARRAY_A ); // phpcs:ignore WordPress.DB
			$r = SSPulse_Model::compute( $signals, $samples );
			SSPulse_Rest::upsert_reading( (int) $f['id'], array(
				'read_on' => $today, 'buzz' => $r['buzz'], 'intent' => $r['intent'], 'life_p50' => $r['mc']['life'][1], 'life_p10' => $r['mc']['life'][0], 'life_p90' => $r['mc']['life'][2],
				'd1_p10' => $r['mc']['d1'][0], 'd1_p50' => $r['mc']['d1'][1], 'd1_p90' => $r['mc']['d1'][2], 'signals' => $signals,
			), 'cron' );
			$n++;
		}
		return $n;
	}
}
