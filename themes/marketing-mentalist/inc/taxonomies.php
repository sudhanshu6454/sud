<?php
/**
 * Shared taxonomies (HANDOVER.md §3). Brand/agency are relationships (inc/meta.php), not taxonomies.
 *
 * @package marketing-mentalist
 */

defined( 'ABSPATH' ) || exit;

const MM_CPTS = array( 'mm_campaign', 'mm_breakdown', 'mm_take', 'mm_list', 'post' );

function mm_register_taxonomies(): void {
	$base = array( 'show_in_rest' => true, 'hierarchical' => false );

	register_taxonomy( 'mm_industry', array( 'mm_campaign' ), $base + array(
		'labels' => mm_tax_labels( 'Industry', 'Industries' ), 'hierarchical' => true,
		'rewrite' => array( 'slug' => 'industry', 'with_front' => false ),
	) );
	register_taxonomy( 'mm_campaign_type', array( 'mm_campaign' ), $base + array(
		'labels' => mm_tax_labels( 'Campaign Type', 'Campaign Types' ),
		'rewrite' => array( 'slug' => 'campaigns/type', 'with_front' => false ),
	) );
	register_taxonomy( 'mm_principle', MM_CPTS, $base + array(
		'labels' => mm_tax_labels( 'Principle', 'Principles' ),
		'rewrite' => array( 'slug' => 'psychology', 'with_front' => false ),
	) );
	register_taxonomy( 'mm_objective', array( 'mm_campaign' ), $base + array(
		'labels' => mm_tax_labels( 'Objective', 'Objectives' ), 'show_ui' => true,
		'rewrite' => array( 'slug' => 'objective', 'with_front' => false ),
	) );
	register_taxonomy( 'mm_platform', array( 'mm_campaign' ), $base + array(
		'labels' => mm_tax_labels( 'Platform', 'Platforms' ),
		'rewrite' => array( 'slug' => 'platform', 'with_front' => false ),
	) );
	register_taxonomy( 'mm_emotion', array( 'mm_campaign' ), $base + array(
		'labels' => mm_tax_labels( 'Emotion', 'Emotions' ),
		'rewrite' => array( 'slug' => 'emotion', 'with_front' => false ),
	) );
	register_taxonomy( 'mm_market', array( 'mm_campaign' ), $base + array(
		'labels' => mm_tax_labels( 'Market', 'Markets' ),
		'rewrite' => array( 'slug' => 'market', 'with_front' => false ),
	) );
	register_taxonomy( 'mm_label', MM_CPTS, $base + array(
		'labels' => mm_tax_labels( 'Label', 'Labels' ), 'show_ui' => true,
		'rewrite' => array( 'slug' => 'label', 'with_front' => false ),
	) );
	// News/topics keep core taxonomies: category on News+Breakdown, post_tag as /topics/.
	register_taxonomy_for_object_type( 'category', 'mm_breakdown' );
	register_taxonomy_for_object_type( 'post_tag', 'mm_campaign' );
	register_taxonomy_for_object_type( 'post_tag', 'mm_breakdown' );
}
add_action( 'init', 'mm_register_taxonomies', 5 );

function mm_tax_labels( string $singular, string $plural ): array {
	return array( 'name' => $plural, 'singular_name' => $singular, 'search_items' => "Search $plural", 'all_items' => "All $plural" );
}

/** Seed the 13 principles from the brief so the taxonomy isn't empty on a fresh install. */
function mm_seed_principles(): void {
	if ( get_option( 'mm_principles_seeded' ) ) {
		return;
	}
	foreach ( array( 'Scarcity', 'Social proof', 'Loss aversion', 'Anchoring', 'FOMO', 'Choice architecture', 'Status signalling', 'Nostalgia', 'Colour psychology', 'Reciprocity', 'Decoy effect', 'Bandwagon', 'Habit formation' ) as $name ) {
		if ( ! term_exists( $name, 'mm_principle' ) ) {
			wp_insert_term( $name, 'mm_principle' );
		}
	}
	foreach ( array( 'Digital', 'Social', 'OOH', 'TV', 'Print', 'Experiential', 'Influencer', 'AI', 'Celebrity', 'Sports', 'Moment Marketing' ) as $name ) {
		if ( ! term_exists( $name, 'mm_campaign_type' ) ) {
			wp_insert_term( $name, 'mm_campaign_type' );
		}
	}
	foreach ( array( 'Automobile', 'FMCG', 'Food & Beverage', 'Quick Commerce', 'Fashion & Retail', 'Finance', 'Technology', 'Telecom', 'Travel' ) as $name ) {
		if ( ! term_exists( $name, 'mm_industry' ) ) {
			wp_insert_term( $name, 'mm_industry' );
		}
	}
	update_option( 'mm_principles_seeded', 1 );
}
add_action( 'init', 'mm_seed_principles', 20 );
