<?php
/**
 * Newsletter sign-up: private subscriber CPT, or posts to an external provider if configured.
 * Same mechanism as marketing-junkies, renamed to the mm_ prefix.
 *
 * @package marketing-mentalist
 */

defined( 'ABSPATH' ) || exit;

function mm_register_subscribers(): void {
	register_post_type( 'mm_subscriber', array(
		'labels'          => array( 'name' => 'Subscribers', 'singular_name' => 'Subscriber' ),
		'public'          => false,
		'show_ui'         => true,
		'show_in_menu'    => true,
		'menu_icon'       => 'dashicons-email-alt',
		'supports'        => array( 'title' ),
		'capability_type' => 'post',
		'map_meta_cap'    => true,
	) );
}
add_action( 'init', 'mm_register_subscribers' );

function mm_newsletter_form( string $id_suffix = '' ): void {
	$action   = get_theme_mod( 'mm_newsletter_action', '' );
	$field    = $action ? ( get_theme_mod( 'mm_newsletter_field', 'EMAIL' ) ?: 'EMAIL' ) : 'mm_email';
	$input_id = 'nl-email' . ( $id_suffix ? '-' . $id_suffix : '' );
	$status   = isset( $_GET['mm_sub'] ) ? sanitize_key( wp_unslash( $_GET['mm_sub'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
	?>
	<form method="post" action="<?php echo esc_url( $action ?: admin_url( 'admin-post.php' ) ); ?>">
		<?php if ( ! $action ) : ?>
			<input type="hidden" name="action" value="mm_subscribe">
			<?php wp_nonce_field( 'mm_subscribe', 'mm_nonce' ); ?>
			<input type="hidden" name="mm_redirect" value="<?php echo esc_url( mm_current_url() ); ?>">
			<label class="screen-reader-text">Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label>
		<?php endif; ?>
		<label for="<?php echo esc_attr( $input_id ); ?>" class="screen-reader-text">Work email</label>
		<input id="<?php echo esc_attr( $input_id ); ?>" class="mm-input-boxed" type="email" name="<?php echo esc_attr( $field ); ?>" required placeholder="you@brand.com" autocomplete="email" style="width:100%;margin-bottom:8px">
		<button type="submit" class="mm-btn mm-btn-primary" style="width:100%;justify-content:space-between">Read their minds <span aria-hidden="true">→</span></button>
		<?php if ( 'ok' === $status ) : ?>
			<p class="mm-meta" role="status" style="margin-top:8px;color:var(--mm-ink)">You're in. Watch for Wednesday's email.</p>
		<?php elseif ( 'dup' === $status ) : ?>
			<p class="mm-meta" role="status" style="margin-top:8px">Already subscribed.</p>
		<?php elseif ( 'bad' === $status ) : ?>
			<p class="mm-meta" role="alert" style="margin-top:8px;color:var(--mm-signal)">That email doesn't look right.</p>
		<?php endif; ?>
	</form>
	<?php
}

function mm_current_url(): string {
	global $wp;
	return home_url( add_query_arg( array(), $wp->request ?? '' ) );
}

function mm_handle_subscribe(): void {
	$redirect = isset( $_POST['mm_redirect'] ) ? esc_url_raw( wp_unslash( $_POST['mm_redirect'] ) ) : home_url( '/' );
	$redirect = wp_validate_redirect( $redirect, home_url( '/' ) );
	$status   = 'bad';

	$nonce_ok = isset( $_POST['mm_nonce'] ) && wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['mm_nonce'] ) ), 'mm_subscribe' );
	$honeypot = ! empty( $_POST['website'] );
	$email    = isset( $_POST['mm_email'] ) ? sanitize_email( wp_unslash( $_POST['mm_email'] ) ) : '';

	if ( $nonce_ok && ! $honeypot && is_email( $email ) ) {
		$existing = get_posts( array( 'post_type' => 'mm_subscriber', 'title' => $email, 'post_status' => 'any', 'posts_per_page' => 1, 'fields' => 'ids' ) );
		if ( $existing ) {
			$status = 'dup';
		} else {
			wp_insert_post( array(
				'post_type'   => 'mm_subscriber',
				'post_title'  => $email,
				'post_status' => 'private',
				'meta_input'  => array( 'mm_source_url' => $redirect, 'mm_ip_hash' => wp_hash( $_SERVER['REMOTE_ADDR'] ?? '' ) ),
			) );
			$status = 'ok';
		}
	} elseif ( $honeypot ) {
		$status = 'ok';
	}
	wp_safe_redirect( add_query_arg( 'mm_sub', $status, $redirect ) . '#newsletter' );
	exit;
}
add_action( 'admin_post_nopriv_mm_subscribe', 'mm_handle_subscribe' );
add_action( 'admin_post_mm_subscribe', 'mm_handle_subscribe' );
