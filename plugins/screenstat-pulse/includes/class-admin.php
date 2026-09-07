<?php
/**
 * Admin page: Pulse > /wp-admin/admin.php?page=screenstat-pulse. Renders app/index.php and loads
 * the model + app as ES modules. Inter comes from the theme's self-hosted file; the plugin never
 * requests a third-party font (brand guideline §3).
 *
 * @package ScreenstatPulse
 */
defined( 'ABSPATH' ) || exit;

final class SSPulse_Admin {
	const SLUG = 'screenstat-pulse';

	public static function init(): void {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
		add_action( 'admin_head', array( __CLASS__, 'head' ) );
		add_filter( 'admin_body_class', array( __CLASS__, 'body_class' ) );
	}
	public static function menu(): void {
		add_menu_page( 'Screenstat Pulse', 'Pulse', SSPulse_Caps::EDIT, self::SLUG, array( __CLASS__, 'render' ), 'dashicons-chart-line', 26 );
	}
	private static function is_page(): bool {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		return $screen && $screen->id === 'toplevel_page_' . self::SLUG;
	}
	public static function body_class( string $c ): string { return self::is_page() ? $c . ' sspulse-page' : $c; }

	/** Theme assets when the Screenstat theme is active (fonts, logos); otherwise the plugin's copies. */
	public static function assets_map(): array {
		$theme_dir = get_template_directory(); $theme_uri = get_template_directory_uri();
		$pick = static function ( string $rel, string $fallback ) use ( $theme_dir, $theme_uri ) { return file_exists( "$theme_dir/$rel" ) ? "$theme_uri/$rel" : $fallback; };
		return array(
			'font'      => $pick( 'assets/fonts/InterVariable.woff2', '' ),
			'logoWhite' => $pick( 'assets/images/logo-white.svg', SSPULSE_URL . 'public/logo-white.svg' ),
			'mark'      => $pick( 'assets/images/mark.svg', SSPULSE_URL . 'public/mark.svg' ),
		);
	}
	public static function head(): void {
		if ( ! self::is_page() ) { return; }
		$a = self::assets_map();
		if ( $a['font'] ) {
			echo '<link rel="preload" href="' . esc_url( $a['font'] ) . '" as="font" type="font/woff2" crossorigin>' . "\n";
			echo '<style>@font-face{font-family:"Inter";src:url("' . esc_url( $a['font'] ) . '") format("woff2");font-weight:100 900;font-style:normal;font-display:swap}</style>' . "\n";
		}
	}
	public static function assets( string $hook ): void {
		if ( $hook !== 'toplevel_page_' . self::SLUG ) { return; }
		wp_enqueue_style( 'sspulse-app', SSPULSE_URL . 'app/pulse-app.css', array(), SSPULSE_VERSION );
		$cfg = array_merge( self::assets_map(), array(
			'restUrl'   => esc_url_raw( rest_url( SSPulse_Rest::NS ) ),
			'nonce'     => wp_create_nonce( 'wp_rest' ),
			'canManage' => current_user_can( SSPulse_Caps::MANAGE ),
			'user'      => wp_get_current_user()->display_name,
		) );
		wp_register_script( 'sspulse-cfg', '', array(), SSPULSE_VERSION, true );
		wp_enqueue_script( 'sspulse-cfg' );
		wp_add_inline_script( 'sspulse-cfg', 'window.SSPULSE = ' . wp_json_encode( $cfg ) . ';' );
		// ES modules: pulse-model.js is imported by pulse-app.js; the browser resolves it relative to the app URL.
		add_action( 'admin_print_footer_scripts', static function () {
			echo '<script type="module" src="' . esc_url( SSPULSE_URL . 'app/pulse-app.js?ver=' . SSPULSE_VERSION ) . '"></script>' . "\n";
		}, 100 );
	}
	public static function render(): void {
		if ( ! current_user_can( SSPulse_Caps::EDIT ) ) { wp_die( esc_html__( 'You need the edit_pulse capability to open Pulse.', 'screenstat-pulse' ) ); }
		$cfg = self::assets_map();
		include SSPULSE_DIR . 'app/index.php';
	}
}
