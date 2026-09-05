<?php
/**
 * Editorial roles (HANDOVER.md §13). Added once on theme activation; never removed automatically
 * so demoting/removing a role in wp-admin sticks.
 *
 * @package marketing-mentalist
 */

defined( 'ABSPATH' ) || exit;

function mm_register_roles(): void {
	if ( get_option( 'mm_roles_registered' ) ) {
		return;
	}
	$editor = get_role( 'editor' );
	$editor_caps = $editor ? $editor->capabilities : array();

	add_role( 'managing_editor', 'Managing Editor', $editor_caps + array(
		'edit_others_posts' => true, 'publish_posts' => true, 'manage_categories' => true, 'edit_theme_options' => true,
	) );
	add_role( 'writer', 'Writer', array( 'read' => true, 'edit_posts' => true, 'publish_posts' => true, 'edit_published_posts' => true, 'upload_files' => true, 'delete_posts' => true ) );
	add_role( 'commercial_editor', 'Commercial Editor', array( 'read' => true, 'edit_posts' => true, 'edit_published_posts' => true, 'edit_theme_options' => true ) );
	add_role( 'seo_manager', 'SEO Manager', array( 'read' => true, 'edit_theme_options' => true, 'manage_options' => false ) );
	update_option( 'mm_roles_registered', 1 );
}
add_action( 'after_setup_theme', 'mm_register_roles' );
