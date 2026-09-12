<?php
/**
 * Schema. Custom tables (HANDOVER.md §4): rows are numeric and queried by film and date.
 * JSON columns are LONGTEXT and enums are VARCHAR so dbDelta stays portable (MariaDB and the
 * SQLite integration used in tests both accept them); values are validated in SSPulse_Validate.
 *
 * @package ScreenstatPulse
 */
defined( 'ABSPATH' ) || exit;

final class SSPulse_DB {
	public static function table( string $name ): string { global $wpdb; return $wpdb->prefix . 'sspulse_' . $name; }

	public static function install(): void {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$charset = $wpdb->get_charset_collate();
		$films = self::table( 'films' ); $readings = self::table( 'readings' ); $samples = self::table( 'samples' ); $calendar = self::table( 'calendar' );
		$ingest_log = self::table( 'ingest_log' ); $industry = self::table( 'industry' ); $trends = self::table( 'trends' );
		$imdb_list = self::table( 'imdb_list' ); $calls = self::table( 'calls' ); $events = self::table( 'events' );
		$post_film = self::table( 'post_film' ); $votes = self::table( 'votes' );
		dbDelta( "CREATE TABLE $films (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  title varchar(200) NOT NULL,
  slug varchar(200) NOT NULL,
  tag varchar(300) NOT NULL DEFAULT '',
  release_date date NULL,
  calendar_id bigint(20) unsigned NULL,
  industry varchar(16) NOT NULL DEFAULT 'hindi',
  is_example tinyint(1) NOT NULL DEFAULT 0,
  unfilled tinyint(1) NOT NULL DEFAULT 1,
  signals longtext NOT NULL,
  meta longtext NULL,
  trending longtext NULL,
  locked longtext NULL,
  actual longtext NULL,
  actual_days longtext NULL,
  live longtext NULL,
  status varchar(16) NOT NULL DEFAULT 'tracking',
  created_by bigint(20) unsigned NULL,
  created_at datetime NULL,
  updated_at datetime NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY slug (slug),
  KEY release_date (release_date),
  KEY status (status)
) $charset;" );
		dbDelta( "CREATE TABLE $readings (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  film_id bigint(20) unsigned NOT NULL,
  read_on date NOT NULL,
  buzz decimal(5,2) NOT NULL,
  intent bigint(20) unsigned NOT NULL,
  life_p50 decimal(10,2) NOT NULL,
  d1_p10 decimal(10,2) NULL,
  d1_p50 decimal(10,2) NULL,
  d1_p90 decimal(10,2) NULL,
  life_p10 decimal(10,2) NULL,
  life_p90 decimal(10,2) NULL,
  signals longtext NOT NULL,
  source varchar(8) NOT NULL DEFAULT 'manual',
  recorded_at datetime NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY film_day (film_id,read_on)
) $charset;" );
		dbDelta( "CREATE TABLE $samples (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  film_id bigint(20) unsigned NOT NULL,
  src varchar(16) NOT NULL,
  taken_on date NOT NULL,
  n int(10) unsigned NOT NULL,
  def_ct int(10) unsigned NOT NULL DEFAULT 0,
  prob_ct int(10) unsigned NOT NULL DEFAULT 0,
  ott_ct int(10) unsigned NOT NULL DEFAULT 0,
  no_ct int(10) unsigned NOT NULL DEFAULT 0,
  note varchar(300) NOT NULL DEFAULT '',
  created_by bigint(20) unsigned NULL,
  created_at datetime NULL,
  PRIMARY KEY  (id),
  KEY film_taken (film_id,taken_on)
) $charset;" );
		dbDelta( "CREATE TABLE $calendar (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  title varchar(200) NOT NULL,
  release_date date NOT NULL,
  cast_line varchar(300) NOT NULL DEFAULT '',
  director varchar(200) NOT NULL DEFAULT '',
  banner varchar(300) NOT NULL DEFAULT '',
  source varchar(300) NOT NULL,
  confidence varchar(12) NOT NULL DEFAULT 'estimate',
  active tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY  (id),
  UNIQUE KEY title_date (title,release_date)
) $charset;" );
		// v1.7 additions (HANDOVER-INGESTION.md, HANDOVER-WORLD.md): the ingestion audit trail, the
		// per-industry constant table, and the tabular data that outgrew a JSON column on films.
		dbDelta( "CREATE TABLE $ingest_log (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  film_id bigint(20) unsigned NOT NULL,
  field varchar(16) NOT NULL,
  value decimal(14,4) NOT NULL,
  source varchar(64) NOT NULL,
  fetched_at datetime NOT NULL,
  raw longtext NULL,
  PRIMARY KEY  (id),
  KEY film_field_at (film_id,field,fetched_at)
) $charset;" );
		dbDelta( "CREATE TABLE $industry (
  ind_key varchar(16) NOT NULL,
  name varchar(64) NOT NULL,
  atp decimal(6,2) NOT NULL,
  screens int(10) unsigned NOT NULL,
  seats int(10) unsigned NOT NULL,
  nett_share decimal(5,3) NOT NULL,
  nett_src varchar(4) NOT NULL DEFAULT 'd',
  scale decimal(5,3) NOT NULL,
  scale_src varchar(4) NOT NULL DEFAULT 'd',
  sd_mult decimal(4,2) NOT NULL DEFAULT 1.00,
  comps_pool varchar(16) NOT NULL,
  note varchar(300) NOT NULL DEFAULT '',
  PRIMARY KEY  (ind_key)
) $charset;" );
		dbDelta( "CREATE TABLE $trends (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  film_id bigint(20) unsigned NOT NULL,
  period date NOT NULL,
  film_value decimal(6,2) NOT NULL,
  bench_value decimal(6,2) NOT NULL,
  benchmark varchar(200) NOT NULL DEFAULT '',
  PRIMARY KEY  (id),
  UNIQUE KEY film_period (film_id,period)
) $charset;" );
		dbDelta( "CREATE TABLE $imdb_list (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  clipped_on date NOT NULL,
  rank int(10) unsigned NOT NULL,
  title varchar(200) NOT NULL,
  calendar_id bigint(20) unsigned NULL,
  PRIMARY KEY  (id),
  KEY clipped_on (clipped_on)
) $charset;" );
		dbDelta( "CREATE TABLE $calls (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  film_id bigint(20) unsigned NOT NULL,
  source varchar(120) NOT NULL,
  d1 decimal(8,2) NOT NULL,
  created_at datetime NULL,
  PRIMARY KEY  (id),
  KEY film_id (film_id)
) $charset;" );
		dbDelta( "CREATE TABLE $events (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  kind varchar(16) NOT NULL DEFAULT 'other',
  starts date NOT NULL,
  ends date NOT NULL,
  name varchar(200) NOT NULL DEFAULT '',
  confidence varchar(12) NOT NULL DEFAULT 'estimate',
  PRIMARY KEY  (id),
  KEY kind_starts (kind,starts)
) $charset;" );
		dbDelta( "CREATE TABLE $post_film (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  post_ref varchar(64) NOT NULL,
  film_id bigint(20) unsigned NOT NULL,
  platform varchar(16) NOT NULL DEFAULT '',
  created_by bigint(20) unsigned NULL,
  created_at datetime NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY post_ref (post_ref)
) $charset;" );
		dbDelta( "CREATE TABLE $votes (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  film_id bigint(20) unsigned NOT NULL,
  choice varchar(8) NOT NULL,
  day date NOT NULL,
  ip_hash varchar(64) NOT NULL DEFAULT '',
  PRIMARY KEY  (id),
  KEY film_day (film_id,day)
) $charset;" );
		update_option( 'sspulse_db_version', SSPULSE_DB_VERSION );
	}

	public static function maybe_upgrade(): void {
		if ( get_option( 'sspulse_db_version' ) !== SSPULSE_DB_VERSION ) { self::install(); }
	}

	public static function now(): string { return current_time( 'mysql', true ); }
}
