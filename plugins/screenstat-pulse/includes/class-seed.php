<?php
/**
 * Seeds the release calendar from data/calendar.json (the CALENDAR array of the reference UI,
 * with its source and read date). Idempotent: (title, release_date) is unique.
 *
 * @package ScreenstatPulse
 */
defined( 'ABSPATH' ) || exit;

final class SSPulse_Seed {
	public static function calendar(): int {
		global $wpdb;
		$rows = json_decode( (string) file_get_contents( SSPULSE_DIR . 'data/calendar.json' ), true );
		if ( ! is_array( $rows ) ) { return 0; }
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
