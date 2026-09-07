<?php
/**
 * Capabilities: edit_pulse (Editor and above: films, signals, samples, readings, actuals) and
 * manage_pulse (Administrator: delete/archive films, edit the calendar). HANDOVER.md §13 Q1.
 *
 * @package ScreenstatPulse
 */
defined( 'ABSPATH' ) || exit;

final class SSPulse_Caps {
	const EDIT = 'edit_pulse';
	const MANAGE = 'manage_pulse';

	public static function add(): void {
		foreach ( array( 'editor', 'administrator' ) as $role ) { $r = get_role( $role ); if ( $r ) { $r->add_cap( self::EDIT ); } }
		$admin = get_role( 'administrator' ); if ( $admin ) { $admin->add_cap( self::MANAGE ); }
		update_option( 'sspulse_caps_version', SSPULSE_VERSION );
	}
	public static function ensure(): void {
		if ( get_option( 'sspulse_caps_version' ) !== SSPULSE_VERSION ) { self::add(); }
	}
}
