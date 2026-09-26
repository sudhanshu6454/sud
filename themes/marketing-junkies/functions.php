<?php
/**
 * Marketing Junkies block theme.
 *
 * @package marketing-junkies
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'MJ_VERSION', '1.0.0' );

foreach ( array( 'helpers', 'setup', 'customizer', 'content', 'blocks', 'seo', 'discovery' ) as $mj_module ) {
	require get_theme_file_path( "inc/{$mj_module}.php" );
}
unset( $mj_module );
