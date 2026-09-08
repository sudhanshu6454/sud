<?php
/**
 * Seeds the release calendar from data/calendar.json (the CALENDAR array of the reference UI,
 * with its source and read date). Idempotent: (title, release_date) is unique.
 *
 * @package ScreenstatPulse
 */
defined( 'ABSPATH' ) || exit;

final class SSPulse_Seed {
	const OPTION = 'sspulse_calendar_seeded';   // set to the data file's mtime once its rows are in

	/** Runs on every load but only does work until the current calendar.json has been imported once. */
	public static function maybe_calendar(): void {
		$file = SSPULSE_DIR . 'data/calendar.json';
		if ( ! is_readable( $file ) ) { return; }
		$stamp = (string) filemtime( $file );
		if ( get_option( self::OPTION ) === $stamp ) { return; }
		if ( self::calendar() >= 0 ) { update_option( self::OPTION, $stamp, false ); }
	}

	public static function calendar(): int {
		global $wpdb;
		$file = SSPULSE_DIR . 'data/calendar.json';
		if ( ! is_readable( $file ) ) { error_log( 'screenstat-pulse: data/calendar.json missing, calendar not seeded' ); return -1; }
		$rows = json_decode( (string) file_get_contents( $file ), true );
		if ( ! is_array( $rows ) ) { return -1; }
		$t = SSPulse_DB::table( 'calendar' ); $added = 0;
		foreach ( $rows as $r ) {
			$exists = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $t WHERE title = %s AND release_date = %s", $r['title'], $r['release_date'] ) ); // phpcs:ignore WordPress.DB
			if ( $exists ) { continue; }
			$wpdb->insert( $t, array( 'title' => $r['title'], 'release_date' => $r['release_date'], 'cast_line' => $r['cast_line'] ?? '', 'director' => $r['director'] ?? '', 'banner' => $r['banner'] ?? '', 'source' => $r['source'] ?? '', 'confidence' => $r['confidence'] ?? 'estimate', 'active' => 1 ) );
			$added++;
		}
		return $added;
	}
}
