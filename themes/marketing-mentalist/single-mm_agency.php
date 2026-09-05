<?php
/**
 * Agency page: logo, about, campaigns by relationship ("Clients" replaces "Agencies").
 *
 * @package marketing-mentalist
 */

get_header();
require_once MM_DIR . '/inc/org-single.php';
mm_render_org_single( 'mm_agency_ids' );
get_footer();
