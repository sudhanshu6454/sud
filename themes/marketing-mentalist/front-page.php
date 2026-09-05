<?php
/**
 * Homepage: loops the enabled modules from Appearance -> Homepage Modules (HANDOVER.md §4).
 *
 * @package marketing-mentalist
 */

get_header();
foreach ( mm_home_modules() as $module ) {
	$file = MM_DIR . "/template-parts/home/$module.php";
	if ( file_exists( $file ) ) {
		require $file;
	}
}
get_footer();
