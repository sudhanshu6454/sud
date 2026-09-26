<?php
/**
 * Theme supports, assets, meta fields and activation defaults.
 *
 * @package marketing-junkies
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Nav items in the header; created as tags on activation so the links never 404 before a story lands. */
const MJ_NAV_TAGS = array( 'Campaigns', 'Martech', 'Media', 'Agencies', 'Features' );

add_action(
	'after_setup_theme',
	static function () {
		load_theme_textdomain( 'marketing-junkies', get_theme_file_path( 'languages' ) );
		add_theme_support( 'post-thumbnails' );
		add_theme_support( 'responsive-embeds' );
		add_theme_support( 'editor-styles' );
		add_theme_support( 'html5', array( 'search-form', 'gallery', 'caption', 'style', 'script' ) );
		add_editor_style( 'assets/css/theme.css' );
		// Related cards: half the autopub 1200x630 share image, same ratio.
		add_image_size( 'mj-card', 600, 315, true );
	}
);

add_action(
	'wp_enqueue_scripts',
	static function () {
		$css = 'assets/css/theme.css';
		$js  = 'assets/js/mj.js';
		wp_enqueue_style( 'mj-theme', get_theme_file_uri( $css ), array(), (string) filemtime( get_theme_file_path( $css ) ) );
		wp_enqueue_script(
			'mj-theme',
			get_theme_file_uri( $js ),
			array(),
			(string) filemtime( get_theme_file_path( $js ) ),
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);
		wp_localize_script(
			'mj-theme',
			'mjStrings',
			array(
				'copied' => __( 'Link copied', 'marketing-junkies' ),
			)
		);
	}
);

add_action(
	'enqueue_block_editor_assets',
	static function () {
		$js = 'assets/js/editor-blocks.js';
		wp_enqueue_script(
			'mj-editor-blocks',
			get_theme_file_uri( $js ),
			array( 'wp-blocks', 'wp-element', 'wp-block-editor', 'wp-server-side-render', 'wp-i18n' ),
			(string) filemtime( get_theme_file_path( $js ) ),
			true
		);
	}
);

/** Preload the Latin font subset and, on articles, the featured image (the LCP element). */
add_action(
	'wp_head',
	static function () {
		printf(
			'<link rel="preload" href="%s" as="font" type="font/woff2" crossorigin>' . "\n",
			esc_url( get_theme_file_uri( 'assets/fonts/archivo-latin.woff2' ) )
		);
		if ( is_singular( 'post' ) && has_post_thumbnail() ) {
			$id     = get_post_thumbnail_id();
			$src    = wp_get_attachment_image_url( $id, 'full' );
			$srcset = wp_get_attachment_image_srcset( $id, 'full' );
			if ( $src ) {
				printf(
					'<link rel="preload" as="image" href="%s"%s fetchpriority="high">' . "\n",
					esc_url( $src ),
					$srcset ? ' imagesrcset="' . esc_attr( $srcset ) . '" imagesizes="(min-width: 1280px) 900px, 100vw"' : ''
				);
			}
		}
		if ( ! has_site_icon() ) {
			printf( '<link rel="icon" href="%s" sizes="512x512">' . "\n", esc_url( mj_logo_url( 'site-icon.png' ) ) );
		}
	},
	2
);

add_action(
	'init',
	static function () {
		register_post_meta(
			'post',
			'mj_sponsor_name',
			array(
				'type'              => 'string',
				'single'            => true,
				'show_in_rest'      => true,
				'description'       => __( 'Sponsor shown on sponsored articles.', 'marketing-junkies' ),
				'sanitize_callback' => 'sanitize_text_field',
				'auth_callback'     => static fn() => current_user_can( 'edit_posts' ),
			)
		);
		register_meta(
			'user',
			'mj_same_as',
			array(
				'type'              => 'string',
				'single'            => true,
				'show_in_rest'      => true,
				'sanitize_callback' => 'sanitize_textarea_field',
				'auth_callback'     => static fn() => current_user_can( 'edit_users' ),
			)
		);
	}
);

/** Posts tagged `sponsored` use the Sponsored article template without anyone picking it by hand. */
add_filter(
	'single_template_hierarchy',
	static function ( array $templates ): array {
		$post = get_queried_object();
		if ( $post instanceof WP_Post && 'post' === $post->post_type && has_tag( MJ_SPONSORED_TAG, $post ) ) {
			array_unshift( $templates, 'single-sponsored.php' );
		}
		return $templates;
	}
);

/** Author profile links (sameAs) for E-E-A-T, edited on the user profile screen. */
function mj_profile_fields( WP_User $user ): void {
	if ( ! current_user_can( 'edit_user', $user->ID ) ) {
		return;
	}
	?>
	<h2><?php esc_html_e( 'Marketing Junkies author profile', 'marketing-junkies' ); ?></h2>
	<table class="form-table" role="presentation">
		<tr>
			<th><label for="mj_same_as"><?php esc_html_e( 'Profile links (sameAs)', 'marketing-junkies' ); ?></label></th>
			<td>
				<textarea name="mj_same_as" id="mj_same_as" rows="4" class="large-text code"><?php echo esc_textarea( (string) get_user_meta( $user->ID, 'mj_same_as', true ) ); ?></textarea>
				<p class="description"><?php esc_html_e( 'One URL per line (LinkedIn, X, Muck Rack...). Shown on the author page and in the article schema.', 'marketing-junkies' ); ?></p>
			</td>
		</tr>
	</table>
	<?php
}
add_action( 'show_user_profile', 'mj_profile_fields' );
add_action( 'edit_user_profile', 'mj_profile_fields' );

function mj_save_profile_fields( int $user_id ): void {
	if ( ! current_user_can( 'edit_user', $user_id ) || ! isset( $_POST['mj_same_as'] ) ) {
		return;
	}
	check_admin_referer( 'update-user_' . $user_id );
	update_user_meta( $user_id, 'mj_same_as', sanitize_textarea_field( wp_unslash( $_POST['mj_same_as'] ) ) );
}
add_action( 'personal_options_update', 'mj_save_profile_fields' );
add_action( 'edit_user_profile_update', 'mj_save_profile_fields' );

add_action(
	'after_switch_theme',
	static function () {
		foreach ( MJ_NAV_TAGS as $name ) {
			if ( ! term_exists( $name, 'post_tag' ) ) {
				wp_insert_term( $name, 'post_tag' );
			}
		}
		if ( ! term_exists( MJ_SPONSORED_TAG, 'post_tag' ) ) {
			wp_insert_term( 'Sponsored', 'post_tag', array( 'slug' => MJ_SPONSORED_TAG ) );
		}
		mj_register_routes();
		flush_rewrite_rules();
	}
);
