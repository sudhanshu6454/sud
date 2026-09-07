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
		dbDelta( "CREATE TABLE $films (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  title varchar(200) NOT NULL,
  slug varchar(200) NOT NULL,
  tag varchar(300) NOT NULL DEFAULT '',
  release_date date NULL,
  calendar_id bigint(20) unsigned NULL,
  is_example tinyint(1) NOT NULL DEFAULT 0,
  unfilled tinyint(1) NOT NULL DEFAULT 1,
  signals longtext NOT NULL,
  locked longtext NULL,
  actual longtext NULL,
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
		update_option( 'sspulse_db_version', SSPULSE_DB_VERSION );
	}

	public static function maybe_upgrade(): void {
		if ( get_option( 'sspulse_db_version' ) !== SSPULSE_DB_VERSION ) { self::install(); }
	}

	public static function now(): string { return current_time( 'mysql', true ); }
}
