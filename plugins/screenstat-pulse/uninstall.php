<?php
// Tables are kept unless the operator opts in: readings are the calibration history and are not recoverable.
defined( 'WP_UNINSTALL_PLUGIN' ) || exit;
if ( defined( 'SSPULSE_DROP_ON_UNINSTALL' ) && SSPULSE_DROP_ON_UNINSTALL ) {
	global $wpdb;
	foreach ( array( 'sspulse_films', 'sspulse_readings', 'sspulse_samples', 'sspulse_calendar' ) as $t ) {
		$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}$t" ); // phpcs:ignore WordPress.DB
	}
	delete_option( 'sspulse_db_version' );
}
