<?php
/**
 * Public "submit a campaign" form: native handler, stores an mm_submission post, emails editors.
 *
 * @package marketing-mentalist
 */

defined( 'ABSPATH' ) || exit;

const MM_SUBMIT_FIELDS = array(
	'name', 'company', 'email', 'phone', 'brand', 'agency', 'campaign_name', 'description',
	'objective', 'launch_date', 'markets', 'credits', 'live_url', 'instagram_url', 'youtube_url', 'asset_url',
);

function mm_handle_submit_campaign(): void {
	$redirect = wp_validate_redirect( wp_get_referer() ?: home_url( '/submit-campaign/' ), home_url( '/submit-campaign/' ) );
	$nonce_ok = isset( $_POST['mm_submit_nonce'] ) && wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['mm_submit_nonce'] ) ), 'mm_submit_campaign' );
	$honeypot = ! empty( $_POST['website'] );
	$email    = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
	$name     = isset( $_POST['name'] ) ? sanitize_text_field( wp_unslash( $_POST['name'] ) ) : '';
	$campaign = isset( $_POST['campaign_name'] ) ? sanitize_text_field( wp_unslash( $_POST['campaign_name'] ) ) : '';

	if ( ! $nonce_ok || $honeypot || ! is_email( $email ) || ! $name || ! $campaign ) {
		wp_safe_redirect( add_query_arg( 'mm_submit', $honeypot ? 'ok' : 'bad', $redirect ) . '#mm-submit-campaign-form' );
		exit;
	}

	$meta = array();
	foreach ( MM_SUBMIT_FIELDS as $field ) {
		$meta[ "mm_submit_$field" ] = isset( $_POST[ $field ] ) ? sanitize_textarea_field( wp_unslash( $_POST[ $field ] ) ) : '';
	}
	wp_insert_post( array(
		'post_type'   => 'mm_submission',
		'post_title'  => sprintf( '%s - %s (%s)', $campaign, $meta['mm_submit_brand'], $name ),
		'post_status' => 'private',
		'meta_input'  => $meta,
	) );

	$admin_email = get_option( 'admin_email' );
	wp_mail(
		$admin_email,
		sprintf( '[%s] New campaign submission: %s', get_bloginfo( 'name' ), $campaign ),
		"A new campaign was submitted for review.\n\n" . implode( "\n", array_map( fn( $k, $v ) => "$k: $v", array_keys( $meta ), $meta ) ) . "\n\nReview it in wp-admin under Submissions."
	);

	wp_safe_redirect( add_query_arg( 'mm_submit', 'ok', $redirect ) . '#mm-submit-campaign-form' );
	exit;
}
add_action( 'admin_post_nopriv_mm_submit_campaign', 'mm_handle_submit_campaign' );
add_action( 'admin_post_mm_submit_campaign', 'mm_handle_submit_campaign' );
