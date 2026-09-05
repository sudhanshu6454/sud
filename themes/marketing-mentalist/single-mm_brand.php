<?php
/**
 * Brand page: logo, about, campaigns by relationship.
 *
 * @package marketing-mentalist
 */

get_header();
require_once MM_DIR . '/inc/org-single.php';
mm_render_org_single( 'mm_brand_id' );
get_footer();
