<?php
/**
 * Server-side validation (HANDOVER.md §4). Pure functions returning null when valid or an error
 * string; the REST layer turns those into 400s. No WordPress dependency, so tests/ValidateTest.php
 * runs without a WordPress install.
 *
 * @package ScreenstatPulse
 */
defined( 'ABSPATH' ) || define( 'ABSPATH', __DIR__ . '/' );

final class SSPulse_Validate {
	const HOLIDAY = array( '0', '1' );          // legacy alias; validation now accepts 'auto' too (see ENUMS)
	const COMP    = array( 'none', 'moderate', 'heavy' );
	const STATUS  = array( 'tracking', 'released', 'archived' );
	const CONFIDENCE = array( 'confirmed', 'estimate', 'disputed' );

	/** Non-numeric signal fields v1.7 added, each with its own small enum or free-form rule. */
	const ENUMS = array(
		'holiday' => null,   // SSPulse_Model::HOLIDAY_AUTO
		'comp'    => null,   // SSPulse_Model::COMP_AUTO
		'franchise' => null, 'remake' => null, 'dubbed' => null,   // SSPulse_Model::BOOL01
		'genre' => null, 'cert' => null, 'event' => null,
	);

	/** Validates a (possibly partial) signals object. Unknown keys are rejected: a puller adding a field must declare it. */
	public static function signals( $s, bool $partial = false ): ?string {
		if ( ! is_array( $s ) ) { return 'signals must be an object'; }
		$enum_keys = array_keys( self::ENUMS );
		$known = array_merge( array_keys( SSPulse_Model::RANGES ), array( 'release', 'industry' ), $enum_keys );
		foreach ( $s as $k => $v ) {
			if ( ! in_array( $k, $known, true ) ) { return "unknown signal '$k'"; }
			if ( $k === 'release' ) { if ( $v !== '' && $v !== null && ! self::is_date( $v ) ) { return 'release must be YYYY-MM-DD'; } continue; }
			if ( $k === 'industry' ) { if ( ! in_array( $v, SSPulse_Model::INDKEYS, true ) ) { return 'industry must be one of ' . implode( ', ', SSPulse_Model::INDKEYS ); } continue; }
			if ( $k === 'holiday' ) { if ( ! in_array( (string) $v, SSPulse_Model::HOLIDAY_AUTO, true ) ) { return "holiday must be '0', '1' or 'auto'"; } continue; }
			if ( $k === 'comp' ) { if ( ! in_array( $v, SSPulse_Model::COMP_AUTO, true ) ) { return 'comp must be none, moderate, heavy or auto'; } continue; }
			if ( in_array( $k, array( 'franchise', 'remake', 'dubbed' ), true ) ) { if ( ! in_array( (string) $v, SSPulse_Model::BOOL01, true ) ) { return "$k must be '0' or '1'"; } continue; }
			if ( $k === 'genre' ) { if ( ! in_array( $v, SSPulse_Model::GENRE, true ) ) { return 'genre must be one of ' . implode( ', ', SSPulse_Model::GENRE ); } continue; }
			if ( $k === 'cert' ) { if ( ! in_array( $v, SSPulse_Model::CERT, true ) ) { return 'cert must be UA or A'; } continue; }
			if ( $k === 'event' ) { if ( ! in_array( $v, SSPulse_Model::EVENT, true ) ) { return 'event must be one of ' . implode( ', ', SSPulse_Model::EVENT ); } continue; }
			if ( ! is_numeric( $v ) ) { return "$k must be numeric"; }
			list( $lo, $hi ) = SSPulse_Model::RANGES[ $k ];
			if ( (float) $v < $lo || (float) $v > $hi ) { return "$k must be between $lo and $hi"; }
		}
		if ( ! $partial ) {
			foreach ( array_keys( SSPulse_Model::RANGES ) as $k ) { if ( $k !== 'days' && ! array_key_exists( $k, $s ) ) { return "missing signal '$k'"; } }
			foreach ( $enum_keys as $k ) { if ( ! array_key_exists( $k, $s ) ) { return "missing signal '$k'"; } }
		}
		return null;
	}

	public static function sample( $x ): ?string {
		if ( ! is_array( $x ) ) { return 'sample must be an object'; }
		if ( ! isset( SSPulse_Model::SOURCES[ $x['src'] ?? '' ] ) ) { return 'src must be one of ' . implode( ', ', array_keys( SSPulse_Model::SOURCES ) ); }
		if ( ! self::is_date( $x['taken_on'] ?? '' ) ) { return 'taken_on must be YYYY-MM-DD'; }
		$n = $x['n'] ?? null;
		if ( ! self::is_uint( $n ) || (int) $n < 1 ) { return 'n must be an integer >= 1'; }
		$sum = 0;
		foreach ( array( 'def_ct', 'prob_ct', 'ott_ct', 'no_ct' ) as $k ) { $v = $x[ $k ] ?? 0; if ( ! self::is_uint( $v ) ) { return "$k must be a non-negative integer"; } $sum += (int) $v; }
		if ( $sum > (int) $n ) { return 'option counts exceed n'; }
		if ( isset( $x['note'] ) && ( ! is_string( $x['note'] ) || mb_strlen( $x['note'] ) > 300 ) ) { return 'note must be a string of at most 300 characters'; }
		return null;
	}

	public static function reading( $r ): ?string {
		if ( ! is_array( $r ) ) { return 'reading must be an object'; }
		if ( ! self::is_date( $r['read_on'] ?? '' ) ) { return 'read_on must be YYYY-MM-DD'; }
		foreach ( array( 'buzz', 'intent', 'life_p50' ) as $k ) { if ( ! isset( $r[ $k ] ) || ! is_numeric( $r[ $k ] ) || (float) $r[ $k ] < 0 ) { return "$k must be a non-negative number"; } }
		if ( (float) $r['buzz'] > 100 ) { return 'buzz must be 0-100'; }
		foreach ( array( 'd1_p10', 'd1_p50', 'd1_p90', 'life_p10', 'life_p90' ) as $k ) { if ( isset( $r[ $k ] ) && ( ! is_numeric( $r[ $k ] ) || (float) $r[ $k ] < 0 ) ) { return "$k must be a non-negative number"; } }
		if ( isset( $r['signals'] ) ) { $e = self::signals( $r['signals'], true ); if ( $e ) { return $e; } }
		return null;
	}

	public static function actuals( $a ): ?string {
		if ( ! is_array( $a ) ) { return 'actuals must be an object'; }
		$any = false;
		foreach ( array( 'd1', 'we', 'wk', 'life' ) as $k ) { $v = $a[ $k ] ?? 0; if ( ! is_numeric( $v ) || (float) $v < 0 ) { return "$k must be a non-negative number (crore, India nett)"; } if ( (float) $v > 0 ) { $any = true; } }
		return $any ? null : 'enter at least one actual figure';
	}

	public static function calendar_row( $c, bool $partial = false ): ?string {
		if ( ! is_array( $c ) ) { return 'calendar row must be an object'; }
		if ( ! $partial || isset( $c['title'] ) ) { if ( ! is_string( $c['title'] ?? null ) || trim( $c['title'] ) === '' || mb_strlen( $c['title'] ) > 200 ) { return 'title is required (max 200 chars)'; } }
		if ( ! $partial || isset( $c['release_date'] ) ) { if ( ! self::is_date( $c['release_date'] ?? '' ) ) { return 'release_date must be YYYY-MM-DD'; } }
		if ( ! $partial || isset( $c['source'] ) ) { if ( ! is_string( $c['source'] ?? null ) || trim( $c['source'] ) === '' ) { return 'source is required: every calendar row names where its date came from'; } }
		if ( isset( $c['confidence'] ) && ! in_array( $c['confidence'], self::CONFIDENCE, true ) ) { return 'confidence must be confirmed, estimate or disputed'; }
		return null;
	}

	public static function status( $v ): ?string { return in_array( $v, self::STATUS, true ) ? null : 'status must be tracking, released or archived'; }
	public static function is_date( $v ): bool { return is_string( $v ) && (bool) preg_match( '/^\d{4}-\d{2}-\d{2}$/', $v ) && checkdate( (int) substr( $v, 5, 2 ), (int) substr( $v, 8, 2 ), (int) substr( $v, 0, 4 ) ); }
	public static function is_uint( $v ): bool { return ( is_int( $v ) && $v >= 0 ) || ( is_string( $v ) && ctype_digit( $v ) ) || ( is_float( $v ) && $v >= 0 && floor( $v ) === $v ); }
	/** ISO 8601 with an offset, e.g. 2026-09-08T09:00:12+05:30 - the worker's `fetched_at` (HANDOVER-INGESTION.md §2). */
	public static function is_datetime( $v ): bool { return is_string( $v ) && ( DateTime::createFromFormat( DateTime::ATOM, $v ) !== false || DateTime::createFromFormat( 'Y-m-d\TH:i:s', $v ) !== false ); }
}
