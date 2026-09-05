<?php
/**
 * Custom post types. `post` stays the News type so autopub keeps publishing unchanged.
 *
 * @package marketing-mentalist
 */

defined( 'ABSPATH' ) || exit;

function mm_register_post_types(): void {
	$common = array( 'public' => true, 'show_in_rest' => true, 'has_archive' => true, 'menu_icon' => 'dashicons-megaphone' );

	register_post_type( 'mm_campaign', $common + array(
		'labels'       => mm_cpt_labels( 'Campaign', 'Campaigns' ),
		'supports'     => array( 'title', 'editor', 'thumbnail', 'excerpt', 'revisions', 'custom-fields' ),
		'rewrite'      => array( 'slug' => 'campaigns', 'with_front' => false ),
		'menu_icon'    => 'dashicons-megaphone',
	) );

	register_post_type( 'mm_breakdown', $common + array(
		'labels'       => mm_cpt_labels( 'Breakdown', 'Breakdowns' ),
		'supports'     => array( 'title', 'editor', 'thumbnail', 'excerpt', 'author', 'revisions', 'custom-fields' ),
		'rewrite'      => array( 'slug' => 'breakdowns', 'with_front' => false ),
		'menu_icon'    => 'dashicons-analytics',
	) );

	register_post_type( 'mm_take', $common + array(
		'labels'       => mm_cpt_labels( 'Mentalist Take', 'Mentalist Takes' ),
		'supports'     => array( 'title', 'editor', 'excerpt', 'author' ),
		'rewrite'      => array( 'slug' => 'takes', 'with_front' => false ),
		'menu_icon'    => 'dashicons-lightbulb',
	) );

	register_post_type( 'mm_brand', $common + array(
		'labels'       => mm_cpt_labels( 'Brand', 'Brands' ),
		'supports'     => array( 'title', 'editor', 'thumbnail' ),
		'rewrite'      => array( 'slug' => 'brand', 'with_front' => false ),
		'menu_icon'    => 'dashicons-star-filled',
	) );

	register_post_type( 'mm_agency', $common + array(
		'labels'       => mm_cpt_labels( 'Agency', 'Agencies' ),
		'supports'     => array( 'title', 'editor', 'thumbnail' ),
		'rewrite'      => array( 'slug' => 'agency', 'with_front' => false ),
		'menu_icon'    => 'dashicons-groups',
	) );

	register_post_type( 'mm_battle', $common + array(
		'labels'       => mm_cpt_labels( 'Brand Battle', 'Brand Battles' ),
		'supports'     => array( 'title', 'editor' ),
		'rewrite'      => array( 'slug' => 'battles', 'with_front' => false ),
		'menu_icon'    => 'dashicons-awards',
	) );

	register_post_type( 'mm_list', $common + array(
		'labels'       => mm_cpt_labels( 'Top List', 'Top Lists' ),
		'supports'     => array( 'title', 'editor', 'thumbnail', 'excerpt', 'author' ),
		'rewrite'      => array( 'slug' => 'top-lists', 'with_front' => false ),
		'menu_icon'    => 'dashicons-editor-ol',
	) );

	// Campaign submissions from the public form: private, no front-end archive.
	register_post_type( 'mm_submission', array(
		'labels'          => mm_cpt_labels( 'Submission', 'Submissions' ),
		'public'          => false,
		'show_ui'         => true,
		'show_in_menu'    => true,
		'supports'        => array( 'title' ),
		'capability_type' => 'post',
		'map_meta_cap'    => true,
		'menu_icon'       => 'dashicons-email-alt',
	) );
}
add_action( 'init', 'mm_register_post_types' );

function mm_cpt_labels( string $singular, string $plural ): array {
	return array(
		'name' => $plural, 'singular_name' => $singular, 'add_new_item' => "Add New $singular",
		'edit_item' => "Edit $singular", 'all_items' => "All $plural", 'search_items' => "Search $plural",
		'not_found' => "No $plural found",
	);
}

/**
 * Restrict Gutenberg on Campaign to core text + our blocks (HANDOVER.md §5).
 */
function mm_allowed_blocks( $allowed, $context ): array|bool {
	if ( isset( $context->post ) && 'mm_campaign' === $context->post->post_type ) {
		return array( 'core/paragraph', 'core/heading', 'core/list', 'core/list-item', 'core/image', 'core/quote', 'mm/take', 'mm/quote', 'mm/stat' );
	}
	return $allowed;
}
add_filter( 'allowed_block_types_all', 'mm_allowed_blocks', 10, 2 );
