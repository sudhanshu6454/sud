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
	const INDUSTRY_OPTION = 'sspulse_industry_seeded';

	/** Runs on every load but only does work until the current calendar.json has been imported once. */
	public static function maybe_calendar(): void {
		$file = SSPULSE_DIR . 'data/calendar.json';
		if ( ! is_readable( $file ) ) { return; }
		$stamp = (string) filemtime( $file );
		if ( get_option( self::OPTION ) === $stamp ) { return; }
		if ( self::calendar() >= 0 ) { update_option( self::OPTION, $stamp, false ); }
	}

	/** Seeds the industry table once for a site that already existed before v1.7 (a fresh
	 *  activation already gets it via the activation hook). */
	public static function maybe_industry(): void {
		if ( get_option( self::INDUSTRY_OPTION ) ) { return; }
		self::industry();
		update_option( self::INDUSTRY_OPTION, '1', false );
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

	/** The six industries' constants (HANDOVER-WORLD.md §1), each with the provenance the model
	 *  carries: 'f' = fitted on the training data, 'd' = an editable default. Re-seeding never
	 *  overwrites a row an editor has already corrected in the table. */
	public static function industry(): int {
		global $wpdb;
		$rows = array(
			array( 'hindi', 'Hindi', 180, 4000, 190, 0.68, 'f', 1.00, 'f', 1.00, 'train', 'the fitted set: 270 releases, 2016–2025' ),
			array( 'telugu', 'Telugu', 150, 2400, 200, 0.65, 'f', 0.50, 'f', 1.35, 'telugu', '100 films from Wikipedia’s Telugu lists; worldwide gross' ),
			array( 'tamil', 'Tamil', 140, 2200, 200, 0.53, 'f', 0.52, 'f', 1.35, 'tamil', '87 films; worldwide gross' ),
			array( 'kannada', 'Kannada', 130, 1100, 190, 0.55, 'd', 0.12, 'f', 1.60, 'kannada', '60 films from 2018 on; fat-tailed — KGF and Kantara sit 20× the median' ),
			array( 'malayalam', 'Malayalam', 130, 900, 180, 0.50, 'f', 0.22, 'f', 1.50, 'malayalam', '38 films, dense only from 2023; highest return on budget in India' ),
			array( 'hollywood', 'Hollywood in India', 230, 2000, 190, 0.16, 'd', 0.45, 'd', 1.60, 'global', 'India nett for a global release; comps are the global top ten of each year' ),
		);
		$t = SSPulse_DB::table( 'industry' ); $added = 0;
		foreach ( $rows as $r ) {
			list( $key, $name, $atp, $screens, $seats, $nett, $nett_src, $scale, $scale_src, $sd, $comps, $note ) = $r;
			if ( $wpdb->get_var( $wpdb->prepare( "SELECT ind_key FROM $t WHERE ind_key = %s", $key ) ) ) { continue; } // phpcs:ignore WordPress.DB
			$wpdb->insert( $t, array( 'ind_key' => $key, 'name' => $name, 'atp' => $atp, 'screens' => $screens, 'seats' => $seats, 'nett_share' => $nett, 'nett_src' => $nett_src, 'scale' => $scale, 'scale_src' => $scale_src, 'sd_mult' => $sd, 'comps_pool' => $comps, 'note' => $note ) );
			$added++;
		}
		return $added;
	}
}
