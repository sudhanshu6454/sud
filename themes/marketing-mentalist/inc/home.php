<?php
/**
 * Homepage modules: an options page standing in for ACF's Flexible Content (HANDOVER.md §4).
 * Editors toggle modules on/off and set an order number; front-page.php loops the result.
 *
 * @package marketing-mentalist
 */

defined( 'ABSPATH' ) || exit;

const MM_HOME_MODULES = array(
	'hero'             => 'Hero (this week\'s mindread)',
	'trending'         => 'Trending ticker',
	'swipe_strategy'   => 'Swipe the strategy (campaign carousel)',
	'breakdowns'       => 'Breakdowns',
	'take'             => 'Mentalist take',
	'latest_campaigns' => 'Latest campaigns + filters',
	'psychology_lab'   => 'Psychology lab + brand battle',
	'news_top_lists'   => 'News + top lists',
	'newsletter'       => 'Newsletter',
	'get_featured'     => 'Get featured (submit / advertise)',
	'archive_search'   => 'Campaign archive search',
);

function mm_home_modules(): array {
	$saved = get_option( 'mm_home_modules' );
	if ( ! is_array( $saved ) || ! $saved ) {
		return array_keys( MM_HOME_MODULES );
	}
	$order = array();
	foreach ( $saved as $key => $row ) {
		if ( ! empty( $row['enabled'] ) ) {
			$order[ $key ] = (int) ( $row['order'] ?? 0 );
		}
	}
	asort( $order );
	return array_keys( $order );
}

function mm_home_settings_page(): void {
	add_theme_page( 'Homepage Modules', 'Homepage Modules', 'edit_theme_options', 'mm-home-modules', 'mm_render_home_settings_page' );
}
add_action( 'admin_menu', 'mm_home_settings_page' );

function mm_render_home_settings_page(): void {
	if ( ! current_user_can( 'edit_theme_options' ) ) {
		return;
	}
	if ( isset( $_POST['mm_home_nonce'] ) && wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['mm_home_nonce'] ) ), 'mm_home_modules' ) ) {
		$new = array();
		$i = 0;
		foreach ( array_keys( MM_HOME_MODULES ) as $key ) {
			$new[ $key ] = array(
				'enabled' => isset( $_POST[ "enabled_$key" ] ) ? 1 : 0,
				'order'   => isset( $_POST[ "order_$key" ] ) ? (int) $_POST[ "order_$key" ] : $i,
			);
			++$i;
		}
		update_option( 'mm_home_modules', $new );
		echo '<div class="notice notice-success"><p>Saved.</p></div>';
	}
	$saved = get_option( 'mm_home_modules' );
	?>
	<div class="wrap">
		<h1>Homepage Modules</h1>
		<p>Enable, disable and order the sections of the homepage. Matches design screen 1a top to bottom.</p>
		<form method="post">
			<?php wp_nonce_field( 'mm_home_modules', 'mm_home_nonce' ); ?>
			<table class="widefat" style="max-width:640px">
				<thead><tr><th>Module</th><th style="width:90px">Enabled</th><th style="width:90px">Order</th></tr></thead>
				<tbody>
				<?php foreach ( MM_HOME_MODULES as $key => $label ) : $row = $saved[ $key ] ?? array( 'enabled' => 1, 'order' => array_search( $key, array_keys( MM_HOME_MODULES ), true ) ); ?>
					<tr>
						<td><?php echo esc_html( $label ); ?></td>
						<td><input type="checkbox" name="enabled_<?php echo esc_attr( $key ); ?>" <?php checked( ! empty( $row['enabled'] ) ); ?>></td>
						<td><input type="number" name="order_<?php echo esc_attr( $key ); ?>" value="<?php echo esc_attr( $row['order'] ?? 0 ); ?>" style="width:70px"></td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
			<p><button type="submit" class="button button-primary">Save</button></p>
		</form>
	</div>
	<?php
}
