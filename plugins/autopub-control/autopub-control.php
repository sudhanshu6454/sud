<?php
/**
 * Plugin Name: Autopub Control
 * Description: The Autopub screen in wp-admin: pause this site, turn its formats on and off, set how many news posts a cycle publishes and at which hours, and choose the subreddits it reads. Autopub picks these up on its next cycle; sites.yaml stays the default.
 * Version: 1.0.0
 * Author: Digital Sukoon
 * License: Proprietary
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'AUTOPUB_CONTROL_VERSION', '1.0.0' );
const AUTOPUB_CONTROL_OVERRIDES = 'autopub_control_overrides';   // what the owner changed here
const AUTOPUB_CONTROL_REPORT    = 'autopub_control_report';      // what autopub last said is live
const AUTOPUB_CONTROL_MAX_POSTS = 20;

function autopub_control_toggles() {
	return array(
		'paused'     => array( 'Pause autopub on this site', 'Nothing is published here, news or features, until this is turned off again.' ),
		'nostalgia'  => array( 'Ad features', "This week's viral ad, or a classic one revisited." ),
		'scorecards' => array( 'Actor scorecards', 'Box-office record cards built from Wikipedia figures.' ),
		'watchlists' => array( 'Watchlists', 'A theme, eight films, one line each, as a poster carousel.' ),
		'trailers'   => array( 'Trailers', "The studio's own trailer, in the site's frame, as the article video and a reel." ),
		'scenes'     => array( 'Scenes', "A viral scene from the rights holder's own channel, 30 seconds at most." ),
		'deepdives'  => array( 'Deep dives', 'Trivia and breakdown carousels on one film, facts from Wikipedia.' ),
		'buzz_meter' => array( 'Buzz Meter', 'The daily ranked digest of film, show and celebrity buzz.' ),
		'tags_cast'  => array( 'Tag the cast on Instagram', 'A story about one film or show tags its billed cast.' ),
	);
}

/** null (every cycle) or the sorted, distinct hours 0-23, from a list or a "9, 13, 18" string. */
function autopub_control_hours( $raw ) {
	if ( null === $raw ) {
		return null;
	}
	$items = is_array( $raw ) ? $raw : preg_split( '/[\s,]+/', (string) $raw, -1, PREG_SPLIT_NO_EMPTY );
	if ( ! $items ) {
		return null;
	}
	$hours = array();
	foreach ( $items as $h ) {
		if ( is_int( $h ) || ( is_string( $h ) && ctype_digit( $h ) ) ) {
			$h = (int) $h;
			if ( $h >= 0 && $h <= 23 ) {
				$hours[ $h ] = $h;
			}
		}
	}
	sort( $hours );
	return $hours ? array_values( $hours ) : null;
}

/** Subreddit names, without any r/ prefix, from a list or a "movies, boxoffice" string. */
function autopub_control_subs( $raw ) {
	$items = is_array( $raw ) ? $raw : preg_split( '/[\s,]+/', (string) $raw, -1, PREG_SPLIT_NO_EMPTY );
	$subs  = array();
	foreach ( (array) $items as $s ) {
		$s = preg_replace( '#^/?r/#i', '', trim( (string) $s ) );
		if ( preg_match( '/^[A-Za-z0-9_]{2,21}$/', $s ) && ! in_array( $s, $subs, true ) ) {
			$subs[] = $s;
		}
	}
	return array_slice( $subs, 0, 20 );
}

/** Only the fields this screen controls, each coerced to the type autopub expects. */
function autopub_control_clean( $raw ) {
	$out = array();
	if ( ! is_array( $raw ) ) {
		return $out;
	}
	foreach ( array_keys( autopub_control_toggles() ) as $k ) {
		if ( array_key_exists( $k, $raw ) ) {
			$out[ $k ] = (bool) $raw[ $k ];
		}
	}
	if ( array_key_exists( 'max_posts_per_run', $raw ) && is_numeric( $raw['max_posts_per_run'] ) ) {
		$out['max_posts_per_run'] = max( 0, min( AUTOPUB_CONTROL_MAX_POSTS, (int) $raw['max_posts_per_run'] ) );
	}
	if ( array_key_exists( 'news_hours', $raw ) ) {
		$out['news_hours'] = autopub_control_hours( $raw['news_hours'] );
	}
	if ( array_key_exists( 'reddit_subreddits', $raw ) ) {
		$out['reddit_subreddits'] = autopub_control_subs( $raw['reddit_subreddits'] );
	}
	return $out;
}

/** autopub's side: read the overrides, report what is live. Its user is an editor, so editors may sync; only admins edit. */
add_action( 'rest_api_init', function () {
	$can_sync = function () {
		return current_user_can( 'edit_others_posts' );
	};
	register_rest_route( 'autopub/v1', '/settings', array(
		'methods'             => 'GET',
		'permission_callback' => $can_sync,
		'callback'            => function () {
			return array( 'overrides' => (object) autopub_control_clean( get_option( AUTOPUB_CONTROL_OVERRIDES, array() ) ) );
		},
	) );
	register_rest_route( 'autopub/v1', '/checkin', array(
		'methods'             => 'POST',
		'permission_callback' => $can_sync,
		'callback'            => function ( WP_REST_Request $req ) {
			$body = (array) $req->get_json_params();
			update_option( AUTOPUB_CONTROL_REPORT, array(
				'baseline'  => autopub_control_clean( $body['baseline'] ?? null ),
				'effective' => autopub_control_clean( $body['effective'] ?? null ),
				'at'        => time(),
			), false );
			return array( 'ok' => true );
		},
	) );
} );

add_action( 'admin_menu', function () {
	add_menu_page( 'Autopub', 'Autopub', 'manage_options', 'autopub-control', 'autopub_control_page', 'dashicons-megaphone', 3 );
} );

function autopub_control_back( $flag ) {
	wp_safe_redirect( add_query_arg( array( 'page' => 'autopub-control', $flag => 1 ), admin_url( 'admin.php' ) ) );
	exit;
}

add_action( 'admin_post_autopub_control_save', function () {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You are not allowed to change autopub settings.' ), 403 );
	}
	check_admin_referer( 'autopub_control_save' );
	$report = get_option( AUTOPUB_CONTROL_REPORT, array() );
	$base   = isset( $report['baseline'] ) && is_array( $report['baseline'] ) ? $report['baseline'] : array();
	if ( ! $base ) {
		autopub_control_back( 'waiting' );   // never guess the defaults: an unticked box would switch a live feature off
	}
	$in = isset( $_POST['autopub'] ) && is_array( $_POST['autopub'] ) ? wp_unslash( $_POST['autopub'] ) : array();
	$submitted = array();
	foreach ( array_keys( autopub_control_toggles() ) as $k ) {
		$submitted[ $k ] = ! empty( $in[ $k ] );
	}
	$submitted['max_posts_per_run'] = $in['max_posts_per_run'] ?? '';
	$submitted['news_hours']        = $in['news_hours'] ?? '';
	$submitted['reddit_subreddits'] = $in['reddit_subreddits'] ?? '';
	// store only what differs from sites.yaml, so a later change to sites.yaml still reaches this site
	$overrides = array();
	foreach ( autopub_control_clean( $submitted ) as $k => $v ) {
		if ( ! array_key_exists( $k, $base ) || $base[ $k ] !== $v ) {
			$overrides[ $k ] = $v;
		}
	}
	update_option( AUTOPUB_CONTROL_OVERRIDES, $overrides, false );
	autopub_control_back( 'saved' );
} );

add_action( 'admin_post_autopub_control_reset', function () {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You are not allowed to change autopub settings.' ), 403 );
	}
	check_admin_referer( 'autopub_control_reset' );
	delete_option( AUTOPUB_CONTROL_OVERRIDES );
	autopub_control_back( 'reset' );
} );

function autopub_control_show( $v ) {
	if ( is_bool( $v ) ) {
		return $v ? 'on' : 'off';
	}
	if ( null === $v ) {
		return 'every cycle';
	}
	if ( is_array( $v ) ) {
		return $v ? implode( ', ', $v ) : 'none';
	}
	return (string) $v;
}

function autopub_control_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$report    = get_option( AUTOPUB_CONTROL_REPORT, array() );
	$base      = isset( $report['baseline'] ) && is_array( $report['baseline'] ) ? $report['baseline'] : array();
	$effective = isset( $report['effective'] ) && is_array( $report['effective'] ) ? $report['effective'] : array();
	$overrides = autopub_control_clean( get_option( AUTOPUB_CONTROL_OVERRIDES, array() ) );
	$values    = array_merge( $base, $effective, $overrides );   // what the next cycle will run on
	$at        = isset( $report['at'] ) ? (int) $report['at'] : 0;

	$note = function ( $k ) use ( $base, $overrides ) {
		if ( ! array_key_exists( $k, $base ) ) {
			return '';
		}
		$text = 'sites.yaml: ' . autopub_control_show( $base[ $k ] );
		if ( array_key_exists( $k, $overrides ) ) {
			$text .= ' &middot; <strong>changed here</strong>';
		}
		return '<p class="description">' . wp_kses( $text, array( 'strong' => array() ) ) . '</p>';
	};
	?>
	<div class="wrap">
		<h1>Autopub</h1>
		<?php if ( isset( $_GET['saved'] ) ) : ?>
			<div class="notice notice-success is-dismissible"><p>Saved. Autopub applies it on its next cycle (within the hour).</p></div>
		<?php elseif ( isset( $_GET['reset'] ) ) : ?>
			<div class="notice notice-success is-dismissible"><p>Back to the sites.yaml defaults from the next cycle.</p></div>
		<?php elseif ( isset( $_GET['waiting'] ) ) : ?>
			<div class="notice notice-warning"><p>Not saved: autopub has not checked in yet, so this screen does not know the defaults.</p></div>
		<?php endif; ?>

		<p>
			<?php if ( $at ) : ?>
				Autopub last checked in <strong><?php echo esc_html( human_time_diff( $at ) ); ?> ago</strong>.
				<?php if ( ! empty( $values['paused'] ) ) : ?><strong>This site is paused.</strong><?php endif; ?>
			<?php else : ?>
				<strong>Autopub has not checked in yet.</strong> It does so at the start of every cycle (once an hour); the settings unlock after the first one.
			<?php endif; ?>
		</p>

		<?php if ( $base ) : ?>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="autopub_control_save">
			<?php wp_nonce_field( 'autopub_control_save' ); ?>
			<table class="form-table" role="presentation">
				<?php foreach ( autopub_control_toggles() as $k => $label ) : ?>
					<?php if ( ! array_key_exists( $k, $base ) ) { continue; } ?>
					<tr>
						<th scope="row"><?php echo esc_html( $label[0] ); ?></th>
						<td>
							<label><input type="checkbox" name="autopub[<?php echo esc_attr( $k ); ?>]" value="1" <?php checked( ! empty( $values[ $k ] ) ); ?>> <?php echo esc_html( $label[1] ); ?></label>
							<?php echo $note( $k ); // phpcs:ignore WordPress.Security.EscapeOutput -- built with wp_kses above ?>
						</td>
					</tr>
				<?php endforeach; ?>
				<tr>
					<th scope="row"><label for="ap-max">News posts per cycle</label></th>
					<td>
						<input id="ap-max" type="number" min="0" max="<?php echo (int) AUTOPUB_CONTROL_MAX_POSTS; ?>" name="autopub[max_posts_per_run]" value="<?php echo esc_attr( $values['max_posts_per_run'] ?? '' ); ?>" class="small-text">
						<p class="description">How many news articles one hourly cycle may publish. The formats above have their own slots.</p>
						<?php echo $note( 'max_posts_per_run' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="ap-hours">News hours</label></th>
					<td>
						<input id="ap-hours" type="text" name="autopub[news_hours]" value="<?php echo esc_attr( isset( $values['news_hours'] ) && is_array( $values['news_hours'] ) ? implode( ', ', $values['news_hours'] ) : '' ); ?>" class="regular-text" placeholder="every cycle">
						<p class="description">Hours (0-23, India time) at which the news post may run, e.g. <code>9, 13, 18</code>. Leave empty for every cycle.</p>
						<?php echo $note( 'news_hours' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="ap-subs">Subreddits</label></th>
					<td>
						<input id="ap-subs" type="text" name="autopub[reddit_subreddits]" value="<?php echo esc_attr( implode( ', ', (array) ( $values['reddit_subreddits'] ?? array() ) ) ); ?>" class="regular-text" placeholder="none">
						<p class="description">Read for story leads only; just a post linking to a real article becomes a candidate. E.g. <code>movies, boxoffice</code>.</p>
						<?php echo $note( 'reddit_subreddits' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					</td>
				</tr>
			</table>
			<?php submit_button( 'Save' ); ?>
		</form>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="autopub_control_reset">
			<?php wp_nonce_field( 'autopub_control_reset' ); ?>
			<?php submit_button( 'Reset everything to the sites.yaml defaults', 'secondary', 'submit', false, $overrides ? array() : array( 'disabled' => 'disabled' ) ); ?>
		</form>
		<?php endif; ?>

		<p class="description" style="margin-top:2em">
			Not on this screen: the fleet-wide posting slots (carousel, reel, scorecard and the other feature hours, shared by all five sites)
			and every password and API key, which stay in the server's configuration.
		</p>
	</div>
	<?php
}
