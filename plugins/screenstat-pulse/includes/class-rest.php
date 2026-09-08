<?php
/**
 * REST API, namespace sspulse/v1 (HANDOVER.md §6). Every write validates through SSPulse_Validate
 * and requires edit_pulse; deletes and the calendar require manage_pulse; the public route is
 * unauthenticated and returns only the whitelisted figure fields.
 *
 * @package ScreenstatPulse
 */
defined( 'ABSPATH' ) || exit;

final class SSPulse_Rest {
	const NS = 'sspulse/v1';

	public static function init(): void { add_action( 'rest_api_init', array( __CLASS__, 'routes' ) ); }

	public static function routes(): void {
		$edit   = static fn() => current_user_can( SSPulse_Caps::EDIT );
		$manage = static fn() => current_user_can( SSPulse_Caps::MANAGE );
		$id     = array( 'id' => array( 'type' => 'integer', 'required' => true, 'minimum' => 1 ) );
		register_rest_route( self::NS, '/films', array(
			array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'list_films' ), 'permission_callback' => $edit ),
			array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'create_film' ), 'permission_callback' => $edit ),
		) );
		register_rest_route( self::NS, '/films/(?P<id>\d+)', array(
			array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'get_film' ), 'permission_callback' => $edit, 'args' => $id ),
			array( 'methods' => 'PATCH', 'callback' => array( __CLASS__, 'patch_film' ), 'permission_callback' => $edit, 'args' => $id ),
			array( 'methods' => 'DELETE', 'callback' => array( __CLASS__, 'archive_film' ), 'permission_callback' => $manage, 'args' => $id ),
		) );
		register_rest_route( self::NS, '/films/(?P<id>\d+)/readings', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'post_reading' ), 'permission_callback' => $edit, 'args' => $id ) );
		register_rest_route( self::NS, '/films/(?P<id>\d+)/samples', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'post_sample' ), 'permission_callback' => $edit, 'args' => $id ) );
		register_rest_route( self::NS, '/films/(?P<id>\d+)/samples/(?P<sid>\d+)', array( 'methods' => 'DELETE', 'callback' => array( __CLASS__, 'delete_sample' ), 'permission_callback' => $edit ) );
		register_rest_route( self::NS, '/films/(?P<id>\d+)/actuals', array( 'methods' => 'PUT', 'callback' => array( __CLASS__, 'put_actuals' ), 'permission_callback' => $edit, 'args' => $id ) );
		register_rest_route( self::NS, '/films/examples', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'load_examples' ), 'permission_callback' => $edit ) );
		register_rest_route( self::NS, '/calendar', array(
			array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'list_calendar' ), 'permission_callback' => $edit ),
			array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'create_calendar' ), 'permission_callback' => $manage ),
		) );
		register_rest_route( self::NS, '/calendar/(?P<id>\d+)', array(
			array( 'methods' => 'PATCH', 'callback' => array( __CLASS__, 'patch_calendar' ), 'permission_callback' => $manage, 'args' => $id ),
			array( 'methods' => 'DELETE', 'callback' => array( __CLASS__, 'delete_calendar' ), 'permission_callback' => $manage, 'args' => $id ),
		) );
		register_rest_route( self::NS, '/public/films/(?P<slug>[a-z0-9-]+)', array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'public_film' ), 'permission_callback' => '__return_true' ) );
	}

	/* ---------------------------------------------------------------- helpers */

	private static function err( string $msg, int $code = 400 ): WP_Error { return new WP_Error( 'sspulse_' . $code, $msg, array( 'status' => $code ) ); }
	private static function json( $v ) { return $v === null || $v === '' ? null : json_decode( $v, true ); }

	private static function row_to_film( array $r, bool $full = false ): array {
		global $wpdb;
		$out = array(
			'id' => (int) $r['id'], 'title' => $r['title'], 'slug' => $r['slug'], 'tag' => $r['tag'], 'release_date' => $r['release_date'],
			'calendar_id' => $r['calendar_id'] ? (int) $r['calendar_id'] : null, 'calendar_title' => $r['calendar_title'] ?? null,
			'is_example' => (bool) $r['is_example'], 'unfilled' => (bool) $r['unfilled'], 'signals' => self::json( $r['signals'] ) ?: array(),
			'locked' => self::json( $r['locked'] ), 'actual' => self::json( $r['actual'] ), 'status' => $r['status'], 'updated_at' => $r['updated_at'],
		);
		if ( $full ) {
			$out['samples']  = array_map( array( __CLASS__, 'row_to_sample' ), $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . SSPulse_DB::table( 'samples' ) . ' WHERE film_id = %d ORDER BY taken_on, id', $r['id'] ), ARRAY_A ) ); // phpcs:ignore WordPress.DB
			$out['readings'] = array_map( array( __CLASS__, 'row_to_reading' ), $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . SSPulse_DB::table( 'readings' ) . ' WHERE film_id = %d ORDER BY read_on', $r['id'] ), ARRAY_A ) ); // phpcs:ignore WordPress.DB
		}
		return $out;
	}
	private static function row_to_sample( array $r ): array {
		return array( 'id' => (int) $r['id'], 'src' => $r['src'], 'taken_on' => $r['taken_on'], 'n' => (int) $r['n'], 'def_ct' => (int) $r['def_ct'], 'prob_ct' => (int) $r['prob_ct'], 'ott_ct' => (int) $r['ott_ct'], 'no_ct' => (int) $r['no_ct'], 'note' => $r['note'] );
	}
	private static function row_to_reading( array $r ): array {
		$f = static fn( $v ) => $v === null ? null : (float) $v;
		return array( 'read_on' => $r['read_on'], 'recorded_at' => $r['recorded_at'], 'buzz' => (float) $r['buzz'], 'intent' => (int) $r['intent'], 'life_p50' => (float) $r['life_p50'], 'life_p10' => $f( $r['life_p10'] ), 'life_p90' => $f( $r['life_p90'] ),
			'd1_p10' => $f( $r['d1_p10'] ), 'd1_p50' => $f( $r['d1_p50'] ), 'd1_p90' => $f( $r['d1_p90'] ), 'source' => $r['source'] );
	}
	private static function film_row( int $id ): ?array {
		global $wpdb;
		$r = $wpdb->get_row( $wpdb->prepare( 'SELECT f.*, c.title AS calendar_title FROM ' . SSPulse_DB::table( 'films' ) . ' f LEFT JOIN ' . SSPulse_DB::table( 'calendar' ) . ' c ON c.id = f.calendar_id WHERE f.id = %d', $id ), ARRAY_A ); // phpcs:ignore WordPress.DB
		return $r ?: null;
	}
	public static function unique_slug( string $title, int $exclude_id = 0 ): string {
		global $wpdb;
		$base = sanitize_title( $title ) ?: 'film';
		$slug = $base; $n = 2; $t = SSPulse_DB::table( 'films' );
		while ( $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $t WHERE slug = %s AND id <> %d", $slug, $exclude_id ) ) ) { $slug = "$base-$n"; $n++; } // phpcs:ignore WordPress.DB
		return $slug;
	}
	/** Default signal set for a newly tracked film (the reference UI's "Track" defaults). */
	public static function default_signals( ?string $release ): array {
		$s = array( 'tr24' => 0, 'trTotal' => 0, 'likeRatio' => 35, 'search' => 0, 'posts' => 0, 'sentiment' => 60, 'bms' => 0, 'song' => 0, 'star' => 50, 'screens' => 2000, 'shows' => 4, 'seats' => 190, 'atp' => 190, 'budget' => 60, 'days' => 30, 'release' => $release ?: '', 'holiday' => '0', 'comp' => 'none', 'kInt' => 3.8, 'bias' => 0.25 );
		if ( $release ) { $s['days'] = max( 0, SSPulse_Model::days_until( $release ) ); }
		return $s;
	}

	/* ---------------------------------------------------------------- films */

	public static function list_films(): array {
		global $wpdb;
		$rows = $wpdb->get_results( 'SELECT f.*, c.title AS calendar_title FROM ' . SSPulse_DB::table( 'films' ) . ' f LEFT JOIN ' . SSPulse_DB::table( 'calendar' ) . " c ON c.id = f.calendar_id WHERE f.status <> 'archived' ORDER BY f.created_at, f.id", ARRAY_A ); // phpcs:ignore WordPress.DB
		return array_map( static fn( $r ) => self::row_to_film( $r, true ), $rows );
	}
	public static function get_film( WP_REST_Request $req ) {
		$r = self::film_row( (int) $req['id'] );
		return $r ? self::row_to_film( $r, true ) : self::err( 'film not found', 404 );
	}
	public static function create_film( WP_REST_Request $req ) {
		global $wpdb;
		$b = $req->get_json_params() ?: array();
		$title = trim( (string) ( $b['title'] ?? '' ) );
		if ( mb_strlen( $title ) > 200 ) { return self::err( 'title too long' ); }
		$release = $b['release_date'] ?? null;
		if ( $release !== null && $release !== '' && ! SSPulse_Validate::is_date( $release ) ) { return self::err( 'release_date must be YYYY-MM-DD' ); }
		$signals = $b['signals'] ?? self::default_signals( $release ?: null );
		$e = SSPulse_Validate::signals( $signals, false ); if ( $e ) { return self::err( $e ); }
		$cal_id = isset( $b['calendar_id'] ) ? (int) $b['calendar_id'] : null;
		$now = SSPulse_DB::now();
		$ok = $wpdb->insert( SSPulse_DB::table( 'films' ), array(
			'title' => $title, 'slug' => 'pending', 'tag' => mb_substr( (string) ( $b['tag'] ?? '' ), 0, 300 ), 'release_date' => $release ?: null, 'calendar_id' => $cal_id ?: null,
			'is_example' => ! empty( $b['is_example'] ) ? 1 : 0, 'unfilled' => ! empty( $b['unfilled'] ) ? 1 : 0, 'signals' => wp_json_encode( $signals ), 'status' => 'tracking',
			'created_by' => get_current_user_id(), 'created_at' => $now, 'updated_at' => $now,
		) );
		if ( ! $ok ) { return self::err( 'could not create film', 500 ); }
		$id = (int) $wpdb->insert_id;
		$wpdb->update( SSPulse_DB::table( 'films' ), array( 'slug' => $title ? self::unique_slug( $title, $id ) : "film-$id" ), array( 'id' => $id ) );
		return new WP_REST_Response( self::row_to_film( self::film_row( $id ), true ), 201 );
	}
	public static function patch_film( WP_REST_Request $req ) {
		global $wpdb;
		$id = (int) $req['id']; $cur = self::film_row( $id );
		if ( ! $cur ) { return self::err( 'film not found', 404 ); }
		$b = $req->get_json_params() ?: array(); $upd = array();
		if ( array_key_exists( 'title', $b ) ) {
			$title = trim( (string) $b['title'] ); if ( mb_strlen( $title ) > 200 ) { return self::err( 'title too long' ); }
			$upd['title'] = $title;
			if ( $title && preg_match( '/^(film-\d+|pending)$/', $cur['slug'] ) ) { $upd['slug'] = self::unique_slug( $title, $id ); }
		}
		if ( array_key_exists( 'slug', $b ) ) { $slug = sanitize_title( (string) $b['slug'] ); if ( ! $slug ) { return self::err( 'slug invalid' ); } $upd['slug'] = self::unique_slug( $slug, $id ); }
		if ( array_key_exists( 'tag', $b ) ) { $upd['tag'] = mb_substr( (string) $b['tag'], 0, 300 ); }
		if ( array_key_exists( 'release_date', $b ) ) { $rd = $b['release_date']; if ( $rd && ! SSPulse_Validate::is_date( $rd ) ) { return self::err( 'release_date must be YYYY-MM-DD' ); } $upd['release_date'] = $rd ?: null; }
		if ( array_key_exists( 'status', $b ) ) { $e = SSPulse_Validate::status( $b['status'] ); if ( $e ) { return self::err( $e ); } if ( $b['status'] === 'archived' && ! current_user_can( SSPulse_Caps::MANAGE ) ) { return self::err( 'archiving needs manage_pulse', 403 ); } $upd['status'] = $b['status']; }
		if ( array_key_exists( 'signals', $b ) ) {
			$e = SSPulse_Validate::signals( $b['signals'], true ); if ( $e ) { return self::err( $e ); }
			$merged = array_merge( self::json( $cur['signals'] ) ?: array(), $b['signals'] );   // partial: never a full overwrite
			$upd['signals'] = wp_json_encode( $merged );
			foreach ( $b['signals'] as $k => $v ) { if ( $k !== 'release' && $k !== 'days' ) { $upd['unfilled'] = 0; } }
			if ( ! empty( $b['signals']['release'] ) ) { $upd['release_date'] = $b['signals']['release']; }
		}
		if ( ! $upd ) { return self::row_to_film( $cur, true ); }
		$upd['updated_at'] = SSPulse_DB::now();
		$wpdb->update( SSPulse_DB::table( 'films' ), $upd, array( 'id' => $id ) );
		return self::row_to_film( self::film_row( $id ), true );
	}
	public static function archive_film( WP_REST_Request $req ) {
		global $wpdb;
		$id = (int) $req['id']; if ( ! self::film_row( $id ) ) { return self::err( 'film not found', 404 ); }
		$wpdb->update( SSPulse_DB::table( 'films' ), array( 'status' => 'archived', 'updated_at' => SSPulse_DB::now() ), array( 'id' => $id ) );
		return array( 'id' => $id, 'status' => 'archived' );
	}

	/* ---------------------------------------------------------------- readings / samples / actuals */

	public static function upsert_reading( int $film_id, array $r, string $source ): void {
		global $wpdb; $t = SSPulse_DB::table( 'readings' );
		$data = array( 'film_id' => $film_id, 'read_on' => $r['read_on'], 'buzz' => round( (float) $r['buzz'], 2 ), 'intent' => (int) round( (float) $r['intent'] ), 'life_p50' => round( (float) $r['life_p50'], 2 ),
			'life_p10' => isset( $r['life_p10'] ) ? round( (float) $r['life_p10'], 2 ) : null, 'life_p90' => isset( $r['life_p90'] ) ? round( (float) $r['life_p90'], 2 ) : null,
			'd1_p10' => isset( $r['d1_p10'] ) ? round( (float) $r['d1_p10'], 2 ) : null, 'd1_p50' => isset( $r['d1_p50'] ) ? round( (float) $r['d1_p50'], 2 ) : null, 'd1_p90' => isset( $r['d1_p90'] ) ? round( (float) $r['d1_p90'], 2 ) : null,
			'signals' => wp_json_encode( $r['signals'] ?? array() ), 'source' => $source, 'recorded_at' => SSPulse_DB::now() );
		$existing = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $t WHERE film_id = %d AND read_on = %s", $film_id, $r['read_on'] ) ); // phpcs:ignore WordPress.DB
		if ( $existing ) { $wpdb->update( $t, $data, array( 'id' => (int) $existing ) ); } else { $wpdb->insert( $t, $data ); }
	}
	public static function post_reading( WP_REST_Request $req ) {
		$id = (int) $req['id']; if ( ! self::film_row( $id ) ) { return self::err( 'film not found', 404 ); }
		$b = $req->get_json_params() ?: array();
		$e = SSPulse_Validate::reading( $b ); if ( $e ) { return self::err( $e ); }
		self::upsert_reading( $id, $b, 'manual' );
		return new WP_REST_Response( self::row_to_film( self::film_row( $id ), true ), 201 );
	}
	public static function post_sample( WP_REST_Request $req ) {
		global $wpdb;
		$id = (int) $req['id']; if ( ! self::film_row( $id ) ) { return self::err( 'film not found', 404 ); }
		$b = $req->get_json_params() ?: array();
		$e = SSPulse_Validate::sample( $b ); if ( $e ) { return self::err( $e ); }
		$wpdb->insert( SSPulse_DB::table( 'samples' ), array( 'film_id' => $id, 'src' => $b['src'], 'taken_on' => $b['taken_on'], 'n' => (int) $b['n'], 'def_ct' => (int) ( $b['def_ct'] ?? 0 ), 'prob_ct' => (int) ( $b['prob_ct'] ?? 0 ), 'ott_ct' => (int) ( $b['ott_ct'] ?? 0 ), 'no_ct' => (int) ( $b['no_ct'] ?? 0 ), 'note' => (string) ( $b['note'] ?? '' ), 'created_by' => get_current_user_id(), 'created_at' => SSPulse_DB::now() ) );
		$sid = (int) $wpdb->insert_id;
		return new WP_REST_Response( self::row_to_sample( $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . SSPulse_DB::table( 'samples' ) . ' WHERE id = %d', $sid ), ARRAY_A ) ), 201 ); // phpcs:ignore WordPress.DB
	}
	public static function delete_sample( WP_REST_Request $req ) {
		global $wpdb;
		$n = $wpdb->delete( SSPulse_DB::table( 'samples' ), array( 'id' => (int) $req['sid'], 'film_id' => (int) $req['id'] ) );
		return $n ? array( 'deleted' => (int) $req['sid'] ) : self::err( 'sample not found', 404 );
	}
	public static function put_actuals( WP_REST_Request $req ) {
		global $wpdb;
		$id = (int) $req['id']; $cur = self::film_row( $id ); if ( ! $cur ) { return self::err( 'film not found', 404 ); }
		$b = $req->get_json_params() ?: array();
		$e = SSPulse_Validate::actuals( $b ); if ( $e ) { return self::err( $e ); }
		$upd = array( 'actual' => wp_json_encode( array( 'd1' => (float) ( $b['d1'] ?? 0 ), 'we' => (float) ( $b['we'] ?? 0 ), 'wk' => (float) ( $b['wk'] ?? 0 ), 'life' => (float) ( $b['life'] ?? 0 ) ) ), 'updated_at' => SSPulse_DB::now() );
		if ( ! self::json( $cur['locked'] ) ) {   // first save freezes the projection the client sends; later saves touch actual only
			$p = is_array( $b['projection'] ?? null ) ? $b['projection'] : array();
			$locked = array( 't' => round( microtime( true ) * 1000 ) );
			foreach ( array( 'd1', 'we', 'wk', 'life', 'bms', 'atp', 'buzz', 'd1lo', 'd1hi' ) as $k ) { $locked[ $k ] = isset( $p[ $k ] ) && is_numeric( $p[ $k ] ) ? (float) $p[ $k ] : 0; }
			$upd['locked'] = wp_json_encode( $locked );
			if ( $cur['status'] === 'tracking' ) { $upd['status'] = 'released'; }
		}
		$wpdb->update( SSPulse_DB::table( 'films' ), $upd, array( 'id' => $id ) );
		return self::row_to_film( self::film_row( $id ), true );
	}

	/** The three fictional example films, for onboarding (HANDOVER.md §10 step 4). Skipped if already present. */
	public static function load_examples() {
		global $wpdb;
		$file = SSPULSE_DIR . 'data/examples.json';
		$examples = is_readable( $file ) ? json_decode( (string) file_get_contents( $file ), true ) : null;
		if ( ! is_array( $examples ) ) { return new WP_Error( 'sspulse_no_examples', 'data/examples.json is missing or unreadable in the plugin directory', array( 'status' => 500 ) ); }
		$made = array();
		foreach ( $examples as $ex ) {
			if ( $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . SSPulse_DB::table( 'films' ) . ' WHERE is_example = 1 AND title = %s', $ex['title'] ) ) ) { continue; } // phpcs:ignore WordPress.DB
			$req = new WP_REST_Request( 'POST' ); $req->set_body( wp_json_encode( array( 'title' => $ex['title'], 'tag' => $ex['tag'], 'signals' => $ex['s'], 'is_example' => true ) ) ); $req->set_header( 'content-type', 'application/json' );
			$res = self::create_film( $req ); if ( is_wp_error( $res ) ) { return $res; }
			$film = $res->get_data(); $id = $film['id'];
			foreach ( $ex['samples'] as $smp ) {
				$wpdb->insert( SSPulse_DB::table( 'samples' ), array( 'film_id' => $id, 'src' => $smp['src'], 'taken_on' => gmdate( 'Y-m-d', time() + $smp['t'] * 86400 ), 'n' => $smp['n'], 'def_ct' => $smp['def'], 'prob_ct' => $smp['prob'], 'ott_ct' => $smp['ott'], 'no_ct' => $smp['no'], 'created_by' => get_current_user_id(), 'created_at' => SSPulse_DB::now() ) );
			}
			foreach ( $ex['hist'] as $h ) {   // [daysAgo, buzz, intent, life]
				self::upsert_reading( $id, array( 'read_on' => gmdate( 'Y-m-d', time() + $h[0] * 86400 ), 'buzz' => $h[1], 'intent' => $h[2], 'life_p50' => $h[3], 'signals' => $ex['s'] ), 'manual' );
			}
			$made[] = $id;
		}
		return array( 'created' => $made, 'films' => self::list_films() );
	}

	/* ---------------------------------------------------------------- calendar */

	public static function list_calendar( WP_REST_Request $req ): array {
		global $wpdb; $t = SSPulse_DB::table( 'calendar' );
		$from = $req->get_param( 'from' ); $to = $req->get_param( 'to' ); $where = 'WHERE active = 1'; $args = array();
		if ( $from && SSPulse_Validate::is_date( $from ) ) { $where .= ' AND release_date >= %s'; $args[] = $from; }
		if ( $to && SSPulse_Validate::is_date( $to ) ) { $where .= ' AND release_date <= %s'; $args[] = $to; }
		$sql = "SELECT * FROM $t $where ORDER BY release_date, title";
		$rows = $wpdb->get_results( $args ? $wpdb->prepare( $sql, ...$args ) : $sql, ARRAY_A ); // phpcs:ignore WordPress.DB
		return array_map( static fn( $r ) => array( 'id' => (int) $r['id'], 'title' => $r['title'], 'release_date' => $r['release_date'], 'cast_line' => $r['cast_line'], 'director' => $r['director'], 'banner' => $r['banner'], 'source' => $r['source'], 'confidence' => $r['confidence'] ), $rows );
	}
	public static function create_calendar( WP_REST_Request $req ) {
		global $wpdb; $b = $req->get_json_params() ?: array();
		$e = SSPulse_Validate::calendar_row( $b ); if ( $e ) { return self::err( $e ); }
		$ok = $wpdb->insert( SSPulse_DB::table( 'calendar' ), array( 'title' => $b['title'], 'release_date' => $b['release_date'], 'cast_line' => (string) ( $b['cast_line'] ?? '' ), 'director' => (string) ( $b['director'] ?? '' ), 'banner' => (string) ( $b['banner'] ?? '' ), 'source' => $b['source'], 'confidence' => $b['confidence'] ?? 'estimate', 'active' => 1 ) );
		return $ok ? new WP_REST_Response( array( 'id' => (int) $wpdb->insert_id ), 201 ) : self::err( 'a row with that title and date exists', 409 );
	}
	public static function patch_calendar( WP_REST_Request $req ) {
		global $wpdb; $b = $req->get_json_params() ?: array();
		$e = SSPulse_Validate::calendar_row( $b, true ); if ( $e ) { return self::err( $e ); }
		$upd = array_intersect_key( $b, array_flip( array( 'title', 'release_date', 'cast_line', 'director', 'banner', 'source', 'confidence', 'active' ) ) );
		if ( ! $upd ) { return self::err( 'nothing to update' ); }
		$wpdb->update( SSPulse_DB::table( 'calendar' ), $upd, array( 'id' => (int) $req['id'] ) );
		return array( 'id' => (int) $req['id'] );
	}
	public static function delete_calendar( WP_REST_Request $req ) {
		global $wpdb;
		$wpdb->update( SSPulse_DB::table( 'calendar' ), array( 'active' => 0 ), array( 'id' => (int) $req['id'] ) );
		return array( 'id' => (int) $req['id'], 'active' => false );
	}

	/* ---------------------------------------------------------------- public */

	/**
	 * Read-only figure data. Only the fields the public figure needs. Unfilled films 404. Archived
	 * films 404 unless they carry a frozen projection, in which case the projection is returned
	 * beside the actuals (HANDOVER.md §13 Q3, recommended option).
	 */
	public static function public_payload( string $slug ): ?array {
		global $wpdb;
		$f = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . SSPulse_DB::table( 'films' ) . ' WHERE slug = %s', $slug ), ARRAY_A ); // phpcs:ignore WordPress.DB
		if ( ! $f || (int) $f['unfilled'] === 1 ) { return null; }
		$locked = self::json( $f['locked'] ); $actual = self::json( $f['actual'] );
		if ( $f['status'] === 'archived' && ! $locked ) { return null; }
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . SSPulse_DB::table( 'readings' ) . ' WHERE film_id = %d ORDER BY read_on DESC LIMIT 2', $f['id'] ), ARRAY_A ); // phpcs:ignore WordPress.DB
		if ( ! $rows && ! $locked ) { return null; }
		$pick = static fn( array $r ) => array( 'read_on' => $r['read_on'], 'recorded_at' => $r['recorded_at'], 'buzz' => (float) $r['buzz'], 'intent' => (int) $r['intent'], 'life_p10' => $r['life_p10'] === null ? null : (float) $r['life_p10'], 'life_p50' => (float) $r['life_p50'], 'life_p90' => $r['life_p90'] === null ? null : (float) $r['life_p90'], 'd1_p50' => $r['d1_p50'] === null ? null : (float) $r['d1_p50'] );
		return array(
			'title' => $f['title'], 'slug' => $f['slug'], 'release_date' => $f['release_date'], 'status' => $f['status'],
			'reading' => $rows ? $pick( $rows[0] ) : null, 'previous' => isset( $rows[1] ) ? $pick( $rows[1] ) : null,
			'locked' => $locked ? array_intersect_key( $locked, array_flip( array( 't', 'd1', 'we', 'wk', 'life', 'buzz', 'd1lo', 'd1hi' ) ) ) : null,
			'actual' => $actual, 'basis' => 'india_nett', 'confidence' => 'estimate', 'source' => 'Screenstat Pulse model',
		);
	}
	public static function public_film( WP_REST_Request $req ) {
		$p = self::public_payload( (string) $req['slug'] );
		if ( ! $p ) { return self::err( 'not found', 404 ); }
		$res = new WP_REST_Response( $p ); $res->header( 'Cache-Control', 'public, max-age=300' );
		return $res;
	}
}
