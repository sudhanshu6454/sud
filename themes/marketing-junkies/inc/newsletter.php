<?php
/**
 * Newsletter sign-up: stores subscribers as a private post type unless an external form action is configured.
 *
 * @package marketing-junkies
 */

defined( 'ABSPATH' ) || exit;

function mj_register_subscribers(): void {
	register_post_type(
		'mj_subscriber',
		array(
			'labels'          => array(
				'name'          => __( 'Subscribers', 'marketing-junkies' ),
				'singular_name' => __( 'Subscriber', 'marketing-junkies' ),
			),
			'public'          => false,
			'show_ui'         => true,
			'show_in_menu'    => true,
			'menu_icon'       => 'dashicons-email-alt',
			'supports'        => array( 'title' ),
			'capability_type' => 'post',
			'map_meta_cap'    => true,
		)
	);
}
add_action( 'init', 'mj_register_subscribers' );

/**
 * Render the sign-up form (used by the sidebar block and the home band).
 */
function mj_newsletter_form( string $id_suffix = '' ): void {
	$action   = get_theme_mod( 'mj_newsletter_action', '' );
	$field    = $action ? ( get_theme_mod( 'mj_newsletter_field', 'EMAIL' ) ?: 'EMAIL' ) : 'mj_email';
	$input_id = 'nl-email' . ( $id_suffix ? '-' . $id_suffix : '' );
	$status   = isset( $_GET['mj_sub'] ) ? sanitize_key( wp_unslash( $_GET['mj_sub'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
	?>
	<form method="post" action="<?php echo esc_url( $action ?: admin_url( 'admin-post.php' ) ); ?>" class="mj-newsletter-form">
		<?php if ( ! $action ) : ?>
			<input type="hidden" name="action" value="mj_subscribe">
			<?php wp_nonce_field( 'mj_subscribe', 'mj_nonce' ); ?>
			<input type="hidden" name="mj_redirect" value="<?php echo esc_url( mj_current_url() ); ?>">
			<label class="mj-hp" aria-hidden="true">Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label>
		<?php endif; ?>
		<div>
			<label for="<?php echo esc_attr( $input_id ); ?>"><?php esc_html_e( 'Email', 'marketing-junkies' ); ?></label>
			<input id="<?php echo esc_attr( $input_id ); ?>" type="email" name="<?php echo esc_attr( $field ); ?>" required placeholder="you@agency.com" autocomplete="email">
		</div>
		<button type="submit" class="btn btn-primary btn-block"><?php esc_html_e( 'Subscribe free', 'marketing-junkies' ); ?></button>
		<?php if ( 'ok' === $status ) : ?>
			<p class="mj-notice" role="status"><?php esc_html_e( 'You are in. First issue lands tomorrow at 7 am IST.', 'marketing-junkies' ); ?></p>
		<?php elseif ( 'dup' === $status ) : ?>
			<p class="mj-notice" role="status"><?php esc_html_e( 'You are already subscribed.', 'marketing-junkies' ); ?></p>
		<?php elseif ( 'bad' === $status ) : ?>
			<p class="mj-notice" role="alert"><?php esc_html_e( 'That email address does not look right.', 'marketing-junkies' ); ?></p>
		<?php endif; ?>
	</form>
	<?php
}

function mj_current_url(): string {
	global $wp;
	return home_url( add_query_arg( array(), $wp->request ?? '' ) );
}

/**
 * Handle the built-in sign-up.
 */
function mj_handle_subscribe(): void {
	$redirect = isset( $_POST['mj_redirect'] ) ? esc_url_raw( wp_unslash( $_POST['mj_redirect'] ) ) : home_url( '/' );
	$redirect = wp_validate_redirect( $redirect, home_url( '/' ) );
	$status   = 'bad';

	$nonce_ok = isset( $_POST['mj_nonce'] ) && wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['mj_nonce'] ) ), 'mj_subscribe' );
	$honeypot = ! empty( $_POST['website'] );
	$email    = isset( $_POST['mj_email'] ) ? sanitize_email( wp_unslash( $_POST['mj_email'] ) ) : '';

	if ( $nonce_ok && ! $honeypot && is_email( $email ) ) {
		$existing = get_posts(
			array(
				'post_type'      => 'mj_subscriber',
				'title'          => $email,
				'post_status'    => 'any',
				'posts_per_page' => 1,
				'fields'         => 'ids',
			)
		);
		if ( $existing ) {
			$status = 'dup';
		} else {
			wp_insert_post(
				array(
					'post_type'   => 'mj_subscriber',
					'post_title'  => $email,
					'post_status' => 'private',
					'meta_input'  => array(
						'mj_source_url' => $redirect,
						'mj_ip_hash'    => wp_hash( $_SERVER['REMOTE_ADDR'] ?? '' ),
					),
				)
			);
			$status = 'ok';
		}
	} elseif ( $honeypot ) {
		$status = 'ok'; // Bots get a quiet success.
	}

	wp_safe_redirect( add_query_arg( 'mj_sub', $status, $redirect ) . '#newsletter' );
	exit;
}
add_action( 'admin_post_nopriv_mj_subscribe', 'mj_handle_subscribe' );
add_action( 'admin_post_mj_subscribe', 'mj_handle_subscribe' );
